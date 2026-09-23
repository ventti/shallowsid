// Optional end-to-end encrypted sync of playlists, sound presets,
// preferences and play history through Firestore's REST API (no SDK, no accounts).
//
// Local state (localStorage "shallowsid.sync"): the sync key, whether sync is
// paused on this device, the last merged snapshot (base for three-way merges)
// and the document's updateTime (used as a write precondition so two devices
// can't overwrite each other). Pausing keeps the key so resuming rejoins.
// Turning off keeps the last snapshot too, so rejoining the same key doesn't
// count the synced plays twice.
//
// The synced data also lists the devices using the key (see device-info.js),
// encrypted like the rest. Each device refreshes its own entry when it syncs,
// at most every DEVICE_REFRESH_MS so syncing doesn't write on every focus.
// Its id is kept apart ("shallowsid.device") so rejoining reuses the entry.
//
// Removing a device moves the data to a new key: this device uploads it under
// the new key and replaces the old copy with a "moved" record (format
// MOVED_VERSION) holding the new key encrypted for each device kept, with the
// public key that device lists (see sync-crypto.js). Those devices follow it
// on their next sync; the removed one can't read it and stops. Every device
// makes its key pair on its first sync with this version, so existing devices
// migrate on their own. Versions before it stop at the moved record (it's
// newer than they know) instead of reading it as empty data.
//
// Events: "status" whenever status/lastSynced/error change, "applied" after
// remote changes were merged into the local stores.

import { FIREBASE } from "./sync-config.js";
import { decryptJSON, deriveVault, encryptJSON, formatKey, generateDeviceKeys, generateKey, parseKey, unwrapKey, wrapKeyFor } from "./sync-crypto.js";
import { canonical, mergeSnapshots } from "./sync-merge.js";
import { describeDevice } from "./device-info.js";

const STORAGE_KEY = "shallowsid.sync";
const DEVICE_KEY = "shallowsid.device";
const DEVICE_REFRESH_MS = 10 * 60_000;
const FORMAT_VERSION = 1;
const MOVED_VERSION = 2;                // firestore.rules keeps these records from being changed or deleted
const MAX_MOVES = 10;                   // moved records followed in one sync
const PUSH_DELAY_MS = 3000;
const RESYNC_ON_FOCUS_MS = 30_000;
const RETENTION_DAYS = 365;             // `expireAt` for an optional Firestore TTL policy (needs billing; off for now)

const same = (a, b) => canonical(a) === canonical(b);
const pick = (snapshot, keys) => Object.fromEntries(keys.map((k) => [k, snapshot[k]]));
// What the local stores hold, applied in two steps (see syncOnce).
const SETTINGS = ["playlists", "soundPresets", "prefs"];
const HISTORY = ["plays", "recent", "playedLists"];
const sameIn = (keys, a, b) => same(pick(a, keys), pick(b, keys));

class ConflictError extends Error {}

export class SyncService extends EventTarget {
  constructor({ store, sound, config = FIREBASE, storageKey = STORAGE_KEY, device = describeDevice }) {
    super();
    this.store = store;
    this.sound = sound;
    this.config = config;
    this.storageKey = storageKey;
    this.configured = !!(config.apiKey && config.projectId);
    this.status = "off";                // off | syncing | synced | error
    this.error = null;
    this.lastSynced = null;
    this.applying = false;
    this.timer = 0;
    this.running = null;
    this.state = this.load();
    this.describeDevice = device;
    this.deviceId = this.loadDeviceId();
    const onLocalChange = () => {
      if (!this.applying && this.enabled) this.schedule();
    };
    store.addEventListener("change", onLocalChange);
    store.addEventListener("history", onLocalChange);
    sound.addEventListener("change", onLocalChange);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.enabled && Date.now() - (this.lastSynced ?? 0) > RESYNC_ON_FOCUS_MS) this.syncNow();
    });
    window.addEventListener?.("online", () => this.enabled && this.syncNow());
    if (this.enabled) this.syncNow();
  }

  get enabled() {
    return this.hasKey && !this.state.paused;
  }

  // A key is kept while paused.
  get hasKey() {
    return this.configured && !!this.state.key;
  }

  get key() {
    return this.state.key;
  }

  // Set when another device moved sync to a new key without this one.
  get removed() {
    return !!this.state.removed;
  }

  // Devices that would lose sync if `id` were removed now: they haven't
  // synced since devices got key pairs, so the new key can't be handed to them.
  leftBehind(id) {
    return this.devices.filter((d) => d.id !== id && d.id !== this.deviceId && !d.pub);
  }

  // Everyone using the key, this device first, then the most recently synced.
  get devices() {
    const list = this.state.devices ?? [];
    return [...list].sort((a, b) => (b.id === this.deviceId) - (a.id === this.deviceId) || (b.updated ?? 0) - (a.updated ?? 0));
  }

  loadDeviceId() {
    try {
      const id = localStorage.getItem(DEVICE_KEY);
      if (id) return id;
      const fresh = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, fresh);
      return fresh;
    } catch {
      return crypto.randomUUID();   // storage blocked: a new entry per session
    }
  }

  load() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey)) ?? {};
    } catch {
      return {};
    }
  }

  persist() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      // storage blocked: sync lasts for this session only
    }
  }

  setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    if (status === "synced") this.lastSynced = Date.now();
    this.dispatchEvent(new Event("status"));
  }

  // ---- user actions ------------------------------------------------------

  // Start (or restart) with a fresh key. Devices on the old key stop syncing
  // with this one; the old synced copy stays until deleted with that key.
  async turnOn() {
    this.state = { key: formatKey(generateKey()), base: null, updateTime: null };
    this.persist();
    await this.syncNow();
  }

  async resume() {
    this.state = { ...this.state, paused: false };
    this.persist();
    await this.syncNow();
  }

  // Join the data another device already syncs. Throws on a malformed key.
  async useKey(text) {
    const key = formatKey(parseKey(text));
    const base = this.state.left?.key === key ? this.state.left.base : null;
    this.state = { key, base, updateTime: null };
    this.persist();
    await this.syncNow();
  }

  pause() {
    clearTimeout(this.timer);
    this.state = { ...this.state, paused: true };
    this.persist();
    this.setStatus("off");
  }

  // Stop syncing and forget the key.
  turnOff() {
    clearTimeout(this.timer);
    this.state = this.state.key && this.state.base ? { left: { key: this.state.key, base: this.state.base } } : {};
    this.persist();
    this.setStatus("off");
  }

  // Take a device off sync for good (see the top of this file). Devices in
  // leftBehind(id) are dropped too; they need the new key entered by hand.
  async removeDevice(id) {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    await this.running;
    this.running = this.run(() => this.moveWithout(id)).finally(() => (this.running = null));
    return this.running;
  }

  async deleteRemote() {
    const vault = await this.vault();
    const res = await fetch(this.url(vault.id), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(await this.errorText(res));
    this.turnOff();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncNow(), PUSH_DELAY_MS);
  }

  // Pull, merge, apply locally, push. Serialised: concurrent calls share one run.
  syncNow() {
    if (!this.enabled) return Promise.resolve();
    clearTimeout(this.timer);
    this.running ??= this.run(() => this.syncOnce()).finally(() => (this.running = null));
    return this.running;
  }

  async run(step) {
    this.setStatus("syncing");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await step();
          this.setStatus("synced");
          return;
        } catch (err) {
          if (!(err instanceof ConflictError)) throw err;   // another device wrote first: go again
        }
      }
      throw new Error("Other devices keep changing the data; try again");
    } catch (err) {
      console.error("sync:", err);
      // fetch() rejects with a TypeError when the network is down
      this.setStatus("error", err instanceof TypeError ? "can't reach the sync server. Changes will sync when you're back online." : err.message);
    }
  }

  async syncOnce(moves = 0) {
    if (!this.state.deviceKeys) this.state = { ...this.state, deviceKeys: await generateDeviceKeys() };
    const vault = await this.vault();
    const remoteDoc = await this.pull(vault);
    if (remoteDoc?.moved) return this.follow(remoteDoc.moved, moves);
    const local = this.snapshot();
    const remote = remoteDoc?.data ?? null;
    const merged = mergeSnapshots(this.state.base, local, remote ?? local);
    // Settings apply before pushing, so edits made meanwhile aren't overwritten.
    // History waits until the push landed: a retry after a conflict would
    // otherwise count the applied plays again.
    const settingsChanged = !sameIn(SETTINGS, merged, local);
    const historyChanged = !sameIn(HISTORY, merged, local);
    if (settingsChanged) this.applySettings(merged);
    let updateTime = remoteDoc?.updateTime ?? null;
    if (!remote || !same(merged, remote)) updateTime = await this.push(vault, merged, updateTime);
    if (historyChanged) this.store.applySyncedHistory(merged, local);
    if (settingsChanged || historyChanged) this.dispatchEvent(new Event("applied"));
    // A copy: `merged` can share objects with the live stores, which later edits mutate.
    this.state = { ...this.state, base: structuredClone(merged), devices: structuredClone(merged.devices), updateTime };
    this.persist();
  }

  // Another device moved the data to a new key. The base stays: the new copy
  // started from the old one, so it still tells additions from deletions.
  async follow(handover, moves) {
    const key = moves < MAX_MOVES ? await unwrapKey(handover, this.deviceId, this.state.deviceKeys?.priv) : null;
    if (!key) {
      this.state = { removed: true };
      this.persist();
      throw new Error("Sync moved to a new key on another device, without this one. To sync again, use the key from a device that still syncs.");
    }
    this.state = { ...this.state, key, updateTime: null };
    this.persist();
    return this.syncOnce(moves + 1);
  }

  // Upload the latest data under a new key, then replace the old copy with
  // the moved record. If another device wrote in between, the new copy is
  // dropped and run() tries again.
  async moveWithout(id) {
    await this.syncOnce();
    const oldVault = await this.vault();
    const devices = this.state.base.devices.filter((d) => d.id === this.deviceId || (d.id !== id && d.pub));
    const data = { ...this.state.base, devices };
    const key = formatKey(generateKey());
    const vault = await deriveVault(parseKey(key));
    const updateTime = await this.push(vault, data, null);
    try {
      const handover = await wrapKeyFor(key, devices.filter((d) => d.id !== this.deviceId));
      await this.push(oldVault, { moved: handover }, this.state.updateTime, MOVED_VERSION);
    } catch (err) {
      await fetch(this.url(vault.id), { method: "DELETE" }).catch(() => {});
      throw err;
    }
    this.state = { ...this.state, key, base: structuredClone(data), devices: structuredClone(devices), updateTime };
    this.persist();
  }

  // ---- data ----------------------------------------------------------------

  snapshot() {
    return {
      devices: this.devicesWithSelf(),
      playlists: this.store.playlists,
      soundPresets: this.sound.presets,
      prefs: { soundActiveId: this.sound.activeId, prerender: this.sound.prerender },
      plays: { ...this.store.plays },   // a copy: plays are counted in place
      recent: this.store.recent,
      playedLists: this.store.playedLists,
    };
  }

  // This device's entry, refreshed when its description changed or it is due.
  devicesWithSelf() {
    const list = this.state.devices ?? this.state.base?.devices ?? [];
    const own = list.find((d) => d.id === this.deviceId);
    const now = { id: this.deviceId, ...this.describeDevice(), pub: this.state.deviceKeys?.pub };
    const due = !own || Date.now() - (own.updated ?? 0) > DEVICE_REFRESH_MS || !same({ ...own, updated: undefined }, now);
    if (!due) return list;
    return [...list.filter((d) => d.id !== this.deviceId), { ...now, updated: Date.now() }];
  }

  applySettings(merged) {
    this.applying = true;
    try {
      this.store.replaceAll(structuredClone(merged.playlists));
      this.sound.applySynced({ presets: structuredClone(merged.soundPresets), activeId: merged.prefs.soundActiveId, prerender: merged.prefs.prerender });
    } finally {
      this.applying = false;
    }
  }

  // ---- Firestore REST --------------------------------------------------------

  async vault() {
    if (this.vaultFor?.key !== this.state.key) this.vaultFor = { key: this.state.key, vault: await deriveVault(parseKey(this.state.key)) };
    return this.vaultFor.vault;
  }

  url(id, params = {}) {
    const q = new URLSearchParams({ key: this.config.apiKey, ...params });
    const endpoint = this.config.endpoint ?? "https://firestore.googleapis.com";   // or a Firestore emulator
    return `${endpoint}/v1/projects/${this.config.projectId}/databases/(default)/documents/vaults/${id}?${q}`;
  }

  async pull(vault) {
    const res = await fetch(this.url(vault.id));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await this.errorText(res));
    const doc = await res.json();
    const f = doc.fields ?? {};
    const version = Number(f.v?.integerValue);
    if (version > MOVED_VERSION) throw new Error("The synced data is from a newer ShallowSID; reload the page");
    const data = await decryptJSON(vault.aesKey, { c: f.c?.stringValue, iv: f.iv?.stringValue });
    if (version === MOVED_VERSION) return { moved: data.moved, updateTime: doc.updateTime };
    return { data, updateTime: doc.updateTime };
  }

  // Write with a precondition: create only if absent, update only if unchanged since we read it.
  async push(vault, data, updateTime, version = FORMAT_VERSION) {
    const box = await encryptJSON(vault.aesKey, data);
    const expireAt = new Date(Date.now() + RETENTION_DAYS * 86_400_000).toISOString();
    const precondition = updateTime ? { "currentDocument.updateTime": updateTime } : { "currentDocument.exists": "false" };
    const res = await fetch(this.url(vault.id, precondition), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          c: { stringValue: box.c },
          iv: { stringValue: box.iv },
          v: { integerValue: String(version) },
          expireAt: { timestampValue: expireAt },
        },
      }),
    });
    if (res.ok) return (await res.json()).updateTime;
    const text = await this.errorText(res);
    if (res.status === 409 || /FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND/.test(text)) throw new ConflictError(text);
    throw new Error(text);
  }

  async errorText(res) {
    try {
      const body = await res.json();
      return `${body.error?.status ?? res.status}: ${body.error?.message ?? res.statusText}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }
}

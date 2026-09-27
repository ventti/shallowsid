// Optional end-to-end encrypted sync of playlists, sound presets,
// preferences and play history through Firestore's REST API (no accounts; see firestore-fetch.js).
//
// Local state (localStorage "shallowsid.sync"): the sync key, whether sync is
// paused on this device, the last merged snapshot (base for three-way merges)
// and the document's revision `rev` (its updateTime, used as a write
// precondition so two devices can't overwrite each other, and its proof
// counter n). Pausing keeps the key so resuming rejoins.
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
// Only key holders can change or delete the synced copy: every write carries
// an owner proof derived from the key (see firestore.rules and
// live-share-core.js), and a delete must first be marked by a proven write.
// Records from before proofs (vaults/, under `legacyId`) are read-only; a
// device that hasn't used the new copy for its key yet reads the old one as
// the remote and the next push creates the new copy (`state.v2` = that key).
//
// Events: "status" whenever status/lastSynced/error change, "applied" after
// remote changes were merged into the local stores.

import { FIREBASE } from "./sync-config.js";
import { firestoreFetch } from "./firestore-fetch.js";
import { ownerHash, tokenFor } from "./live-share-core.js";
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

const revOf = (doc) => ({ updateTime: doc.updateTime, n: Number(doc.fields?.n?.integerValue ?? 0) });

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
    this.state = { key: formatKey(generateKey()), base: null, rev: null };
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
    this.state = { key, base, rev: null };
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
    for (let attempt = 0; ; attempt++) {
      const doc = await this.get(this.url(vault.id));
      if (!doc) break;
      try {
        await this.remove(vault, revOf(doc));
        break;
      } catch (err) {
        if (!(err instanceof ConflictError) || attempt >= 2) throw err;   // another device wrote first: read again
      }
    }
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
    let rev = remoteDoc?.rev ?? null;
    if (!remote || !same(merged, remote) || !rev) rev = await this.push(vault, merged, rev);
    if (historyChanged) this.store.applySyncedHistory(merged, local);
    if (settingsChanged || historyChanged) this.dispatchEvent(new Event("applied"));
    // A copy: `merged` can share objects with the live stores, which later edits mutate.
    this.state = { ...this.state, base: structuredClone(merged), devices: structuredClone(merged.devices), rev, v2: this.state.key };
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
    this.state = { ...this.state, key, rev: null };
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
    const rev = await this.push(vault, data, null);
    try {
      const handover = await wrapKeyFor(key, devices.filter((d) => d.id !== this.deviceId));
      await this.push(oldVault, { moved: handover }, this.state.rev, MOVED_VERSION);
    } catch (err) {
      await this.remove(vault, rev).catch(() => {});
      throw err;
    }
    this.state = { ...this.state, key, base: structuredClone(data), devices: structuredClone(devices), rev, v2: key };
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

  url(id, params = {}, collection = "vaults2") {
    const q = new URLSearchParams({ key: this.config.apiKey, ...params });
    const endpoint = this.config.endpoint ?? "https://firestore.googleapis.com";   // or a Firestore emulator
    return `${endpoint}/v1/projects/${this.config.projectId}/databases/(default)/documents/${collection}/${id}?${q}`;
  }

  async get(url) {
    const res = await firestoreFetch(this.config, url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await this.errorText(res));
    return res.json();
  }

  // {data | moved, rev} or null. `rev` ({updateTime, n}) is what the next
  // write must match; it is null for a legacy record, which can only be read.
  async pull(vault) {
    let doc = await this.get(this.url(vault.id));
    if (doc?.fields?.del?.booleanValue) {
      // another device deleted the data but couldn't finish: finish it
      await this.delete(vault.id);
      doc = null;
    }
    const legacy = !doc && this.state.v2 !== this.state.key;
    if (legacy) doc = await this.get(this.url(vault.legacyId, {}, "vaults"));
    if (!doc) return null;
    const f = doc.fields ?? {};
    const version = Number(f.v?.integerValue);
    if (version > MOVED_VERSION) throw new Error("The synced data is from a newer ShallowSID; reload the page");
    const data = await decryptJSON(vault.aesKey, { c: f.c?.stringValue, iv: f.iv?.stringValue });
    const rev = legacy ? null : revOf(doc);
    if (version === MOVED_VERSION) return { moved: data.moved, rev };
    return { data, rev };
  }

  // Write with a precondition: create only if absent, update only if unchanged
  // since we read it (`rev`), proving ownership with token n. Returns the new rev.
  async push(vault, data, rev, version = FORMAT_VERSION, { del = false } = {}) {
    const box = await encryptJSON(vault.aesKey, data);
    const expireAt = new Date(Date.now() + RETENTION_DAYS * 86_400_000).toISOString();
    const precondition = rev ? { "currentDocument.updateTime": rev.updateTime } : { "currentDocument.exists": "false" };
    const n = rev ? rev.n + 1 : 0;
    const fields = {
      c: { stringValue: box.c },
      iv: { stringValue: box.iv },
      v: { integerValue: String(version) },
      expireAt: { timestampValue: expireAt },
      owner: { stringValue: await ownerHash(await tokenFor(vault.writeSeed, n)) },
      n: { integerValue: String(n) },
    };
    if (rev) fields.proof = { stringValue: await tokenFor(vault.writeSeed, rev.n) };
    if (del) fields.del = { booleanValue: true };
    const res = await firestoreFetch(this.config, this.url(vault.id, precondition), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    if (res.ok) return { updateTime: (await res.json()).updateTime, n };
    const text = await this.errorText(res);
    if (res.status === 409 || /FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND/.test(text)) throw new ConflictError(text);
    throw new Error(text);
  }

  // Mark the copy deleted with a proven write, then delete it: firestore.rules
  // only allow deleting a marked copy, so the id alone can't delete one.
  async remove(vault, rev) {
    await this.push(vault, {}, rev, FORMAT_VERSION, { del: true });
    await this.delete(vault.id);
  }

  async delete(id) {
    const res = await firestoreFetch(this.config, this.url(id), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(await this.errorText(res));
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

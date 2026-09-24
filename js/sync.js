// Optional end-to-end encrypted sync of playlists, sound presets and
// preferences through Firestore's REST API (no SDK, no accounts).
//
// Local state (localStorage "shallowsid.sync"): the sync key, the last merged
// snapshot (base for three-way merges) and the document's updateTime (used as
// a write precondition so two devices can't overwrite each other).
//
// Events: "status" whenever status/lastSynced/error change, "applied" after
// remote changes were merged into the local stores.

import { FIREBASE } from "./sync-config.js";
import { decryptJSON, deriveVault, encryptJSON, formatKey, generateKey, parseKey } from "./sync-crypto.js";
import { canonical, mergeSnapshots } from "./sync-merge.js";

const STORAGE_KEY = "shallowsid.sync";
const FORMAT_VERSION = 1;
const PUSH_DELAY_MS = 3000;
const RESYNC_ON_FOCUS_MS = 30_000;
const RETENTION_DAYS = 365;             // `expireAt` for an optional Firestore TTL policy (needs billing; off for now)

const same = (a, b) => canonical(a) === canonical(b);

class ConflictError extends Error {}

export class SyncService extends EventTarget {
  constructor({ store, sound, config = FIREBASE, storageKey = STORAGE_KEY }) {
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
    const onLocalChange = () => {
      if (!this.applying && this.state.key) this.schedule();
    };
    store.addEventListener("change", onLocalChange);
    sound.addEventListener("change", onLocalChange);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.state.key && Date.now() - (this.lastSynced ?? 0) > RESYNC_ON_FOCUS_MS) this.syncNow();
    });
    window.addEventListener?.("online", () => this.state.key && this.syncNow());
    if (this.configured && this.state.key) this.syncNow();
  }

  get enabled() {
    return this.configured && !!this.state.key;
  }

  get key() {
    return this.state.key;
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

  async turnOn() {
    this.state = { key: formatKey(generateKey()), base: null, updateTime: null };
    this.persist();
    await this.syncNow();
  }

  // Join the data another device already syncs. Throws on a malformed key.
  async useKey(text) {
    const key = formatKey(parseKey(text));
    this.state = { key, base: null, updateTime: null };
    this.persist();
    await this.syncNow();
  }

  turnOff() {
    clearTimeout(this.timer);
    this.state = {};
    this.persist();
    this.setStatus("off");
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
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  async run() {
    this.setStatus("syncing");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.syncOnce();
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

  async syncOnce() {
    const vault = await this.vault();
    const remoteDoc = await this.pull(vault);
    const local = this.snapshot();
    const remote = remoteDoc?.data ?? null;
    const merged = mergeSnapshots(this.state.base, local, remote ?? local);
    if (!same(merged, local)) this.apply(merged);
    let updateTime = remoteDoc?.updateTime ?? null;
    if (!remote || !same(merged, remote)) updateTime = await this.push(vault, merged, updateTime);
    // A copy: `merged` can share objects with the live stores, which later edits mutate.
    this.state = { ...this.state, base: structuredClone(merged), updateTime };
    this.persist();
  }

  // ---- data ----------------------------------------------------------------

  snapshot() {
    return {
      playlists: this.store.playlists,
      soundPresets: this.sound.presets,
      prefs: { soundActiveId: this.sound.activeId, prerender: this.sound.prerender },
    };
  }

  apply(merged) {
    this.applying = true;
    try {
      this.store.replaceAll(structuredClone(merged.playlists));
      this.sound.applySynced({ presets: structuredClone(merged.soundPresets), activeId: merged.prefs.soundActiveId, prerender: merged.prefs.prerender });
    } finally {
      this.applying = false;
    }
    this.dispatchEvent(new Event("applied"));
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
    if (Number(f.v?.integerValue) > FORMAT_VERSION) throw new Error("The synced data is from a newer ShallowSID; reload the page");
    const data = await decryptJSON(vault.aesKey, { c: f.c?.stringValue, iv: f.iv?.stringValue });
    return { data, updateTime: doc.updateTime };
  }

  // Write with a precondition: create only if absent, update only if unchanged since we read it.
  async push(vault, data, updateTime) {
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
          v: { integerValue: String(FORMAT_VERSION) },
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

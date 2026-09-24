// Two simulated devices syncing through an in-memory fake of Firestore's REST API.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// --- browser globals the modules touch ---
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
globalThis.document = { visibilityState: "visible", addEventListener() {} };
globalThis.window = { addEventListener() {} };

// --- fake Firestore: vaults/<id> with updateTime preconditions ---
const docs = new Map();
let clock = 0;
const requests = [];
globalThis.fetch = async (url, { method = "GET", body } = {}) => {
  const u = new URL(url);
  const id = u.pathname.split("/").pop();
  requests.push({ method, id, body });
  const json = (status, obj) => ({ ok: status < 300, status, statusText: "", json: async () => obj });
  const doc = docs.get(id);
  if (method === "GET") return doc ? json(200, doc) : json(404, { error: { status: "NOT_FOUND", message: "no doc" } });
  if (method === "DELETE") { docs.delete(id); return json(200, {}); }
  const exists = u.searchParams.get("currentDocument.exists");
  const wantTime = u.searchParams.get("currentDocument.updateTime");
  if (exists === "false" && doc) return json(409, { error: { status: "ALREADY_EXISTS", message: "exists" } });
  if (wantTime && (!doc || doc.updateTime !== wantTime)) return json(400, { error: { status: "FAILED_PRECONDITION", message: "stale" } });
  const next = { name: id, fields: JSON.parse(body).fields, updateTime: `t${++clock}` };
  docs.set(id, next);
  return json(200, next);
};

const { SyncService } = await import("../js/sync.js");
const { PlaylistStore } = await import("../js/playlists.js");
const { SoundSettings } = await import("../js/sound-settings.js");

const config = { apiKey: "test-key", projectId: "test" };
function device(name) {
  // each device gets its own storage namespace
  const prefix = `${name}:`;
  const get = localStorage.getItem, set = localStorage.setItem;
  const scoped = { getItem: (k) => get(prefix + k), setItem: (k, v) => set(prefix + k, v) };
  const saved = globalThis.localStorage;
  globalThis.localStorage = scoped;
  const store = new PlaylistStore();
  const sound = new SoundSettings();
  const sync = new SyncService({ store, sound, config });
  globalThis.localStorage = saved;
  // route this device's storage calls through its namespace from now on
  for (const obj of [store, sound, sync]) {
    for (const m of ["save", "persist", "addRecent"]) {
      if (typeof obj[m] !== "function") continue;
      const orig = obj[m].bind(obj);
      obj[m] = (...a) => { const s = globalThis.localStorage; globalThis.localStorage = scoped; try { return orig(...a); } finally { globalThis.localStorage = s; } };
    }
  }
  return { store, sound, sync };
}

beforeEach(() => { storage.clear(); docs.clear(); requests.length = 0; });

test("turning on uploads only ciphertext under a 64-hex id", async () => {
  const a = device("a");
  a.store.create("Hubbard classics", [{ path: "MUSICIANS/H/Hubbard_Rob/Commando.sid", song: 1 }]);
  await a.sync.turnOn();
  assert.equal(a.sync.status, "synced");
  assert.equal(docs.size, 1);
  const [id, doc] = [...docs.entries()][0];
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(doc.fields).sort(), ["c", "expireAt", "iv", "v"]);
  assert.ok(!JSON.stringify(doc).includes("Hubbard"));
});

test("a second device joins with the key and both converge", async () => {
  const a = device("a"), b = device("b");
  a.store.create("From A");
  await a.sync.turnOn();
  b.store.create("From B");
  b.store.toggleFavorite({ path: "X.sid", song: 1 });
  await b.sync.useKey(a.sync.key.toLowerCase());
  assert.deepEqual(b.store.playlists.map((p) => p.name).sort(), ["Favorites", "From A", "From B"]);
  await a.sync.syncNow();
  assert.deepEqual(a.store.playlists.map((p) => p.name).sort(), ["Favorites", "From A", "From B"]);
  assert.ok(a.store.isFavorite({ path: "X.sid", song: 1 }));
});

test("deletions and edits propagate; concurrent writes don't clobber", async () => {
  const a = device("a"), b = device("b");
  const keep = a.store.create("Keep");
  const drop = a.store.create("Drop");
  await a.sync.turnOn();
  await b.sync.useKey(a.sync.key);
  // A deletes one and renames the other; B adds a tune — both before syncing
  a.store.remove(drop.id);
  a.store.rename(keep.id, "Kept");
  b.store.add(keep.id, { path: "Y.sid", song: 2 });
  await a.sync.syncNow();
  await b.sync.syncNow();        // B's precondition is stale: it re-pulls, merges, writes
  await a.sync.syncNow();
  for (const d of [a, b]) {
    assert.deepEqual(d.store.playlists.map((p) => p.name), ["Kept"]);         // A's rename and delete
    assert.deepEqual(d.store.playlists[0].items, [{ path: "Y.sid", song: 2 }]); // B's added tune
  }
});

test("sound presets and prefs sync; deleting the synced data works", async () => {
  const a = device("a"), b = device("b");
  a.sound.select("mos-6581r4ar-0687");
  a.sound.update({ filter6581Curve: 0.3 });
  const preset = a.sound.saveAsNew("Warm");
  a.sound.setPrerender(false);
  await a.sync.turnOn();
  await b.sync.useKey(a.sync.key);
  assert.equal(b.sound.presets[0].name, "Warm");
  assert.equal(b.sound.activeId, preset.id);
  assert.equal(b.sound.prerender, false);
  await b.sync.deleteRemote();
  assert.equal(docs.size, 0);
  assert.equal(b.sync.enabled, false);
});

test("a wrong key fails with a clear message and uploads nothing new", async () => {
  const a = device("a");
  await a.sync.turnOn();
  const b = device("b");
  await assert.rejects(b.sync.useKey("not a key"), /26 letters/);
  assert.equal(docs.size, 1);
});

test("pausing keeps the key; resuming catches up; a new key starts a new copy", async () => {
  const a = device("a"), b = device("b");
  await a.sync.turnOn();
  await b.sync.useKey(a.sync.key);
  b.sync.pause();
  assert.equal(b.sync.enabled, false);
  assert.equal(b.sync.key, a.sync.key);
  a.store.create("While paused");
  await a.sync.syncNow();
  const seen = requests.length;
  await b.sync.syncNow();
  assert.equal(requests.length, seen);            // paused: no traffic
  await b.sync.resume();
  assert.deepEqual(b.store.playlists.map((p) => p.name), ["While paused"]);
  const oldKey = b.sync.key;
  await b.sync.turnOn();
  assert.notEqual(b.sync.key, oldKey);
  assert.equal(docs.size, 2);
});

test("devices list both devices, encrypted, and a removed one comes back when it syncs", async () => {
  const a = device("a"), b = device("b");
  await a.sync.turnOn();
  await b.sync.useKey(a.sync.key);
  await a.sync.syncNow();
  assert.equal(a.sync.devices.length, 2);
  assert.equal(a.sync.devices[0].id, a.sync.deviceId);      // this device first
  assert.notEqual(a.sync.deviceId, b.sync.deviceId);
  assert.ok(!JSON.stringify([...docs.values()]).includes(b.sync.deviceId));   // ciphertext only
  a.sync.removeDevice(b.sync.deviceId);
  await a.sync.syncNow();
  assert.equal(a.sync.devices.length, 1);
  await b.sync.syncNow();       // b learns it was removed...
  await b.sync.syncNow();       // ...and, still in use, puts itself back
  await a.sync.syncNow();
  assert.equal(a.sync.devices.length, 2);
});

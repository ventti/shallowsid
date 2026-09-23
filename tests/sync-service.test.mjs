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
  if (doc?.fields.v.integerValue === "2") return json(403, { error: { status: "PERMISSION_DENIED", message: "moved" } });   // as firestore.rules
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
    for (const m of ["save", "persist", "addRecent", "addPlay", "markPlayed", "applySyncedHistory"]) {
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

test("devices list both devices, encrypted, each with a public key", async () => {
  const a = device("a"), b = device("b");
  await a.sync.turnOn();
  await b.sync.useKey(a.sync.key);
  await a.sync.syncNow();
  assert.equal(a.sync.devices.length, 2);
  assert.equal(a.sync.devices[0].id, a.sync.deviceId);      // this device first
  assert.notEqual(a.sync.deviceId, b.sync.deviceId);
  assert.ok(a.sync.devices.every((d) => d.pub));
  assert.ok(!JSON.stringify([...docs.values()]).includes(b.sync.deviceId));   // ciphertext only
});

test("removing a device moves sync to a new key the others follow and it can't", async () => {
  const a = device("a"), b = device("b"), c = device("c");
  a.store.create("Shared");
  await a.sync.turnOn();
  await b.sync.useKey(a.sync.key);
  await c.sync.useKey(a.sync.key);
  await a.sync.syncNow();
  const oldKey = a.sync.key;
  await a.sync.removeDevice(c.sync.deviceId);
  assert.equal(a.sync.status, "synced");
  assert.notEqual(a.sync.key, oldKey);
  assert.deepEqual(a.sync.devices.map((d) => d.id).sort(), [a.sync.deviceId, b.sync.deviceId].sort());
  b.store.create("From B");
  await b.sync.syncNow();         // finds the moved record, takes the new key, syncs there
  assert.equal(b.sync.key, a.sync.key);
  await a.sync.syncNow();
  assert.deepEqual(a.store.playlists.map((p) => p.name).sort(), ["From B", "Shared"]);
  await c.sync.syncNow();
  assert.equal(c.sync.hasKey, false);
  assert.equal(c.sync.removed, true);
  assert.equal(c.sync.status, "error");
  assert.deepEqual(c.store.playlists.map((p) => p.name), ["Shared"]);   // keeps what it had
  const seen = requests.length;
  await c.sync.syncNow();
  assert.equal(requests.length, seen);
  await c.sync.useKey(oldKey);     // the old key only leads to the moved record
  assert.equal(c.sync.hasKey, false);
});

test("a device on an older version (no public key) is left behind, and the move can't be undone", async () => {
  const a = device("a"), b = device("b"), c = device("c");
  await a.sync.turnOn();
  await b.sync.useKey(a.sync.key);
  await c.sync.useKey(a.sync.key);
  const oldCopy = [...docs.keys()][0];
  // b lists itself as an older version would: no public key
  b.sync.state.deviceKeys = { ...b.sync.state.deviceKeys, pub: undefined };
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.deepEqual(a.sync.leftBehind(c.sync.deviceId).map((d) => d.id), [b.sync.deviceId]);
  await a.sync.removeDevice(c.sync.deviceId);
  assert.deepEqual(a.sync.devices.map((d) => d.id), [a.sync.deviceId]);
  await b.sync.syncNow();
  assert.equal(b.sync.removed, true);
  const del = await fetch(`https://x/vaults/${oldCopy}?key=k`, { method: "DELETE" });
  assert.equal(del.status, 403);
});

test("older versions stop at a moved record instead of reading it as empty data", async () => {
  const a = device("a"), b = device("b");
  await a.sync.turnOn();
  await b.sync.useKey(a.sync.key);
  const [oldId] = [...docs.keys()];
  await a.sync.removeDevice(b.sync.deviceId);
  assert.equal(docs.get(oldId).fields.v.integerValue, "2");   // FORMAT_VERSION 1 clients throw on v > 1
});

test("play history syncs: counts add up once, recent lists interleave, rejoining doesn't double", async () => {
  const a = device("a"), b = device("b");
  const x = { path: "X.sid", song: 1 }, y = { path: "Y.sid", song: 1 };
  a.store.addPlay(x);
  a.store.addRecent(x);
  const list = a.store.create("Mix");
  a.store.markPlayed(list.id);
  await a.sync.turnOn();
  b.store.addPlay(x);
  b.store.addRecent(y);
  await b.sync.useKey(a.sync.key);
  await a.sync.syncNow();
  for (const d of [a, b]) {
    assert.deepEqual(d.store.mostPlayed().map((p) => [p.path, p.count]), [["X.sid", 2]]);
    assert.deepEqual(d.store.recent.map((r) => r.path).sort(), ["X.sid", "Y.sid"]);
    assert.deepEqual(d.store.recentPlaylists().map((p) => p.name), ["Mix"]);
  }
  b.store.addPlay(x);
  await b.sync.syncNow();
  await a.sync.syncNow();
  await a.sync.syncNow();       // nothing new: counts stay put
  assert.equal(a.store.mostPlayed()[0].count, 3);
  b.sync.turnOff();
  await b.sync.useKey(a.sync.key);
  assert.equal(b.store.mostPlayed()[0].count, 3);
});

test("a play conflicting with another device's push is counted once", async () => {
  const a = device("a"), b = device("b");
  const x = { path: "X.sid", song: 1 };
  await a.sync.turnOn();
  await b.sync.useKey(a.sync.key);
  a.store.addPlay(x);
  b.store.addPlay(x);
  await a.sync.syncNow();
  await b.sync.syncNow();       // stale precondition: b retries
  await a.sync.syncNow();
  for (const d of [a, b]) assert.equal(d.store.mostPlayed()[0].count, 2);
});

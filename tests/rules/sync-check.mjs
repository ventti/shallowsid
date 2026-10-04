// Sync and live links through the real firestore.rules in the Firestore
// emulator, so a rules change can't quietly break them. Run with
// rules-check.mjs (see there):
//   npx firebase-tools emulators:exec --only firestore --project demo-shallowsid \
//     "node tests/rules/rules-check.mjs && node tests/rules/sync-check.mjs"
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
globalThis.document = { visibilityState: "visible", addEventListener() {} };
globalThis.window = { addEventListener() {} };
globalThis.location = { origin: "https://example.test", pathname: "/" };

// The emulator evaluates a write with a currentDocument.updateTime
// precondition as a create (production doesn't), so every proven update would
// be refused. Preconditions aren't part of the rules, so send exists=true instead.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const u = new URL(url);
  if (u.searchParams.has("currentDocument.updateTime")) {
    u.searchParams.delete("currentDocument.updateTime");
    u.searchParams.set("currentDocument.exists", "true");
  }
  return realFetch(u.href, init);
};

const { SyncService } = await import("../../js/sync.js");
const { PlaylistStore } = await import("../../js/playlists.js");
const { SoundSettings } = await import("../../js/sound-settings.js");
const { LiveShare } = await import("../../js/live-share.js");

const config = { apiKey: "x", projectId: "demo-shallowsid", endpoint: "http://127.0.0.1:8089" };
const TUNE = { path: "MUSICIANS/H/Hubbard_Rob/Commando.sid", song: 1 };
const results = [];
async function step(label, fn) {
  try {
    await fn();
    results.push([label, "PASS"]);
  } catch (err) {
    results.push([label, `FAIL: ${err.message}`]);
  }
}

// Each device keeps its own storage: swap it in around every call.
function device(name) {
  const own = new Map();
  const scoped = { getItem: (k) => own.get(k) ?? null, setItem: (k, v) => own.set(k, String(v)), removeItem: (k) => own.delete(k) };
  const run = (fn) => { const saved = globalThis.localStorage; globalThis.localStorage = scoped; try { return fn(); } finally { globalThis.localStorage = saved; } };
  return run(() => {
    const store = new PlaylistStore();
    const sound = new SoundSettings();
    const sync = new SyncService({ store, sound, config, device: () => ({ os: "Test", browser: name }) });
    return { store, sound, sync, run };
  });
}
const check = (d) => assert.equal(d.sync.status, "synced", d.sync.error ?? d.sync.status);

const a = device("a"), b = device("b");
await step("turn on sync and push", async () => { await a.run(() => a.sync.turnOn()); check(a); });
await step("second device joins with the key", async () => { await b.run(() => b.sync.useKey(a.sync.key)); check(b); });
await step("a change syncs over", async () => {
  a.run(() => a.store.create("Rules check", [TUNE]));
  await a.run(() => a.sync.syncNow()); check(a);
  await b.run(() => b.sync.syncNow()); check(b);
  assert.ok(b.store.playlists.some((p) => p.name === "Rules check"));
});
await step("both devices keep writing (proof chain)", async () => {
  for (let i = 0; i < 3; i++) {
    b.run(() => b.store.create(`b${i}`));
    await b.run(() => b.sync.syncNow()); check(b);
    await a.run(() => a.sync.syncNow()); check(a);
  }
  assert.equal(a.store.playlists.length, b.store.playlists.length);
});
await step("removing a device moves sync to a new key", async () => {
  const oldKey = a.sync.key;
  await a.run(() => a.sync.syncNow());
  await a.run(() => a.sync.removeDevice(b.sync.deviceId)); check(a);
  assert.notEqual(a.sync.key, oldKey);
});
await step("delete synced data", async () => { await a.run(() => a.sync.deleteRemote()); assert.equal(a.sync.hasKey, false); });

const owner = device("owner");
const live = owner.run(() => new LiveShare({ store: owner.store, config }));
const viewer = new LiveShare({ store: new PlaylistStore(), config });
let share, pl;
await step("publish a live link", async () => {
  pl = owner.run(() => owner.store.create("Shared", [TUNE]));
  share = await owner.run(() => live.publish(pl));
  const seen = await viewer.fetch(share.id, () => true);
  assert.equal(seen.name, "Shared");
});
await step("owner updates it, viewers follow", async () => {
  owner.run(() => owner.store.rename(pl.id, "Shared v2"));
  await owner.run(() => live.publish(owner.store.get(pl.id)));
  assert.equal((await viewer.fetch(share.id, () => true)).name, "Shared v2");
});
await step("someone else can't change it", async () => {
  const thief = new LiveShare({ store: new PlaylistStore(), config });
  await assert.rejects(thief.update({ id: share.id, seed: "0".repeat(64) }, "{}"), /isn't allowed/);
});
await step("stop sharing", async () => {
  await owner.run(() => live.stop(owner.store.get(pl.id)));
  assert.deepEqual(await viewer.fetch(share.id, () => true), { deleted: true });
});

for (const [label, result] of results) console.log(`${result === "PASS" ? "ok  " : "FAIL"} ${label} -> ${result}`);
process.exit(results.some(([, r]) => r !== "PASS") ? 1 : 0);

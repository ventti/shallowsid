import { test } from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
const { PlaylistStore } = await import("../js/playlists.js");

test("has() matches the same file and subtune only", () => {
  const store = new PlaylistStore();
  const pl = store.create("Mix");
  store.add(pl.id, { path: "A/x.sid", song: 2 });
  assert.equal(store.has(pl.id, { path: "A/x.sid", song: 2 }), true);
  assert.equal(store.has(pl.id, { path: "A/x.sid", song: 1 }), false);
  assert.equal(store.has(pl.id, { path: "A/x.sid", start: 2 }), true);
  assert.equal(store.has("nope", { path: "A/x.sid", song: 2 }), false);
});

test("allowing duplicates is per playlist and persists", () => {
  const store = new PlaylistStore();
  const a = store.create("A"), b = store.create("B");
  store.setAllowDuplicates(a.id, true);
  const reloaded = new PlaylistStore();
  assert.equal(reloaded.get(a.id).allowDuplicates, true);
  assert.equal(reloaded.get(b.id).allowDuplicates, undefined);
  reloaded.setAllowDuplicates(a.id, false);
  assert.equal("allowDuplicates" in reloaded.get(a.id), false);
});

test("setting a subtune updates only that entry, persists, and emits a change", () => {
  const store = new PlaylistStore();
  const pl = store.create("Subtunes", [{ path: "MUSICIANS/A/x.sid", song: 1 }, { path: "MUSICIANS/A/x.sid", song: 1 }]);
  let changes = 0;
  store.addEventListener("change", () => changes++);
  store.setSubtune(pl.id, 1, 3);
  assert.deepEqual(pl.items.map((i) => i.song), [1, 3]);
  assert.deepEqual(new PlaylistStore().get(pl.id).items, pl.items);
  assert.equal(changes, 1);
  for (const song of [0, -1, 1.5, NaN, "2", 3]) store.setSubtune(pl.id, 1, song);
  store.setSubtune(pl.id, 20, 2);
  store.setSubtune("missing", 0, 2);
  assert.equal(changes, 1);
});

test("creating playlists never reuses a name, including case and whitespace variants", () => {
  storage.clear();
  const store = new PlaylistStore();
  const original = store.create("Mix");
  const first = store.create("  MIX  ");
  const second = store.create("Mix");
  assert.equal(original.name, "Mix");
  assert.equal(first.name, "MIX (1)");
  assert.equal(second.name, "Mix (2)");
  assert.equal(store.nameExists("  mix  "), true);
  assert.equal(store.nameExists("Mix", original.id), false);
});

test("rename refuses another playlist's name but permits changing own case", () => {
  storage.clear();
  const store = new PlaylistStore();
  const a = store.create("Mix"), b = store.create("Other");
  let changes = 0;
  store.addEventListener("change", () => changes++);
  assert.equal(store.rename(b.id, " MIX "), false);
  assert.equal(b.name, "Other");
  assert.equal(changes, 0);
  assert.equal(store.rename(a.id, "MIX"), true);
  assert.equal(a.name, "MIX");
  assert.equal(new PlaylistStore().get(b.id).name, "Other");
});

test("long duplicate names keep their suffix within the saved name limit", () => {
  storage.clear();
  const store = new PlaylistStore();
  const long = "🎵".repeat(80);
  store.create(long);
  const copy = store.create(long);
  const third = store.create(long);
  assert.ok(copy.name.endsWith(" (1)"));
  assert.ok(third.name.endsWith(" (2)"));
  assert.equal([...copy.name].length, 80);
  assert.equal(new PlaylistStore().get(copy.id).name, copy.name);
});

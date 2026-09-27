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

import { test } from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
let now = 0;
Date.now = () => ++now;   // each play a moment later than the last
const { PlaylistStore } = await import("../js/playlists.js");

test("most played sorts by count, then by last played, and persists", () => {
  const store = new PlaylistStore();
  const a = { path: "A/x.sid", song: 1 }, b = { path: "B/y.sid", song: 2 }, c = { path: "C/z.sid", song: 1 };
  store.addPlay(a);
  store.addPlay(b);
  store.addPlay(b);
  store.addPlay(c);
  assert.deepEqual(store.mostPlayed().map((p) => [p.path, p.song, p.count]), [["B/y.sid", 2, 2], ["C/z.sid", 1, 1], ["A/x.sid", 1, 1]]);
  assert.equal(store.mostPlayed(1).length, 1);
  assert.equal(new PlaylistStore().mostPlayed().length, 3);
});

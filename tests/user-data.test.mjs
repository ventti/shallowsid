import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMAT, fileName, mergeImport, parseBundle, toBundle } from "../js/user-data.js";
import { EMPTY_SNAPSHOT } from "../js/sync-merge.js";

const tune = (path, song = 1) => ({ path, song });
const A = "MUSICIANS/H/Hubbard_Rob/Commando.sid";
const B = "MUSICIANS/G/Galway_Martin/Arkanoid.sid";

const snapshot = (over = {}) => ({
  ...EMPTY_SNAPSHOT,
  devices: [{ id: "dev1", os: "macOS" }],
  playlists: [{ id: "fav", name: "Favorites", favorites: true, created: 1, items: [tune(A)] }],
  plays: { [`${A}#1`]: [5, 100] },
  recent: [{ ...tune(A), at: 100 }],
  prefs: { soundChip: "auto" },
  ...over,
});

const roundTrip = (snap, searches) => parseBundle(JSON.stringify(toBundle(snap, searches, new Date("2026-10-02T10:00:00Z"))));

test("a file holds the data and searches, not the devices", () => {
  const bundle = toBundle(snapshot(), [{ q: "hubbard" }], new Date("2026-10-02T10:00:00Z"));
  assert.equal(bundle.format, FORMAT);
  assert.equal(bundle.exported, "2026-10-02T10:00:00.000Z");
  assert.equal(bundle.data.devices, undefined);
  assert.deepEqual(bundle.searches, [{ q: "hubbard" }]);
  assert.equal(fileName(new Date("2026-10-02T10:00:00Z")), "shallowsid-data-2026-10-02.json");
});

test("a round trip keeps the data", () => {
  const { data, searches } = roundTrip(snapshot(), [{ q: "hubbard" }]);
  assert.deepEqual(data.playlists, snapshot().playlists);
  assert.deepEqual(data.plays, snapshot().plays);
  assert.deepEqual(data.devices, []);
  assert.deepEqual(searches, [{ q: "hubbard" }]);
});

test("into an empty browser, the file's data arrives as it was", () => {
  const empty = { ...EMPTY_SNAPSHOT, devices: [{ id: "new" }] };
  const merged = mergeImport(empty, roundTrip(snapshot()).data);
  assert.deepEqual(merged.playlists, snapshot().playlists);
  assert.deepEqual(merged.plays, snapshot().plays);
  assert.deepEqual(merged.recent, snapshot().recent);
  assert.deepEqual(merged.prefs, { soundChip: "auto" });
  assert.deepEqual(merged.devices, [{ id: "new" }]);   // this browser's own
});

test("importing merges, removes nothing, and twice changes nothing", () => {
  const here = snapshot({
    playlists: [{ id: "mine", name: "Mine", created: 5, items: [tune(B)] }],
    plays: { [`${A}#1`]: [7, 200], [`${B}#1`]: [1, 150] },
  });
  const file = roundTrip(snapshot()).data;
  const once = mergeImport(here, file);
  assert.deepEqual(once.playlists.map((p) => p.id).sort(), ["fav", "mine"]);
  assert.deepEqual(once.plays, { [`${A}#1`]: [7, 200], [`${B}#1`]: [1, 150] });   // the higher count, not 12
  const twice = mergeImport(once, file);
  assert.deepEqual(twice.playlists, once.playlists);
  assert.deepEqual(twice.plays, once.plays);
});

test("two Favorites become one", () => {
  const here = snapshot({ playlists: [{ id: "fav2", name: "Favorites", favorites: true, created: 9, items: [tune(B)] }] });
  const merged = mergeImport(here, roundTrip(snapshot()).data);
  const favorites = merged.playlists.filter((p) => p.favorites);
  assert.equal(favorites.length, 1);
  assert.deepEqual(favorites[0].items.map((i) => i.path).sort(), [B, A].sort());
});

test("files that aren't ShallowSID data are refused", () => {
  for (const text of ["", "not json", "[]", JSON.stringify({ format: "other", data: {} }), JSON.stringify({ format: FORMAT, version: 1 })]) {
    assert.throws(() => parseBundle(text), /isn't ShallowSID data/, text);
  }
  assert.throws(() => parseBundle(JSON.stringify({ format: FORMAT, version: 99, data: {} })), /newer ShallowSID/);
});

test("what's in a file is cleaned on the way in", () => {
  const { data } = parseBundle(JSON.stringify({
    format: FORMAT, version: 1,
    data: {
      playlists: [
        { id: 7, name: "  <b>Mix</b>\u0000 ", items: [tune(A), tune("../../etc/passwd"), "not a tune", tune(B, 2)] },
        { name: "no id" }, "junk",
      ],
      plays: { ok: [3, 10], bad: "x", neg: [-1, 0] },
      recent: [{ path: A, song: 1, at: 1 }, "junk"],
      curation: { identity: "nope" },
    },
  }));
  assert.deepEqual(data.playlists, [{ id: "7", name: "<b>Mix</b>", items: [tune(A), tune(B, 2)] }]);
  assert.deepEqual(data.plays, { ok: [3, 10] });
  assert.equal(data.recent.length, 1);
  assert.deepEqual(data.curation, { identity: null, notes: {} });
});

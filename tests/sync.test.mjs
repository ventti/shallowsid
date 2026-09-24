import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptJSON, deriveVault, encryptJSON, formatKey, generateKey, parseKey } from "../js/sync-crypto.js";
import { DEVICE_TTL_MS, foldFavorites, mergeDevices, mergeItems, mergeLists, mergePrefs, mergeSnapshots } from "../js/sync-merge.js";

test("sync keys format readably and parse back", () => {
  for (let i = 0; i < 50; i++) {
    const key = generateKey();
    const text = formatKey(key);
    assert.match(text, /^([A-Z2-9]{4}-){6}[A-Z2-9]{2}$/);
    assert.deepEqual(parseKey(text.toLowerCase().replace(/-/g, " ")), key);
  }
  assert.throws(() => parseKey("ABCD"), /26 letters/);
  assert.throws(() => parseKey("0".repeat(26)), /not part of a sync key/);
});

test("vault id is stable per key and differs between keys", async () => {
  const key = generateKey();
  const a = await deriveVault(key), b = await deriveVault(key), c = await deriveVault(generateKey());
  assert.match(a.id, /^[0-9a-f]{64}$/);
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
});

test("data round-trips encrypted, and the wrong key fails", async () => {
  const { aesKey } = await deriveVault(generateKey());
  const data = { playlists: [{ id: "x", name: "Hübbard ♥", items: Array.from({ length: 200 }, (_, i) => ({ path: `MUSICIANS/H/Hubbard_Rob/T${i}.sid`, song: 1 })) }] };
  const box = await encryptJSON(aesKey, data);
  assert.ok(!box.c.includes("Hubbard"));
  assert.deepEqual(await decryptJSON(aesKey, box), data);
  const other = await deriveVault(generateKey());
  await assert.rejects(decryptJSON(other.aesKey, box), /could not be decrypted/);
});

const pl = (id, name, updated = 0, items = []) => ({ id, name, items, updated });

test("merge keeps additions from both sides and honours deletions", () => {
  const base = [pl("a", "A"), pl("b", "B")];
  const local = [pl("a", "A"), pl("c", "C new here")];            // deleted b, added c
  const remote = [pl("a", "A"), pl("b", "B"), pl("d", "D there")]; // added d
  assert.deepEqual(mergeLists(base, local, remote).map((p) => p.id), ["a", "c", "d"]);
});

test("merge takes the changed side, or the later edit when both changed", () => {
  const base = [pl("a", "A", 1)];
  assert.equal(mergeLists(base, [pl("a", "A", 1)], [pl("a", "A2", 5)])[0].name, "A2");
  assert.equal(mergeLists(base, [pl("a", "A3", 9)], [pl("a", "A2", 5)])[0].name, "A3");
  assert.equal(mergeLists(base, [pl("a", "A3", 3)], [pl("a", "A2", 5)])[0].name, "A2");
  // edited locally while deleted remotely: the edit survives
  assert.equal(mergeLists(base, [pl("a", "A4", 7)], []).length, 1);
});

test("both sides editing one playlist keep both edits", () => {
  const t = (n) => ({ path: `T${n}.sid`, song: 1 });
  const base = [{ id: "a", name: "Old", items: [t(1), t(2)], updated: 1 }];
  const local = [{ id: "a", name: "Renamed", items: [t(1), t(2), t(3)], updated: 5 }];   // rename + add 3
  const remote = [{ id: "a", name: "Old", items: [t(2), t(4)], updated: 7 }];            // remove 1 + add 4
  const [merged] = mergeLists(base, local, remote);
  assert.equal(merged.name, "Renamed");
  assert.deepEqual(merged.items.map((i) => i.path), ["T2.sid", "T3.sid", "T4.sid"]);
  assert.equal(merged.updated, 7);
  assert.deepEqual(mergeItems([], [t(1)], [t(1), t(2)]).map((i) => i.path), ["T1.sid", "T2.sid"]);
});

test("first sync (no base) unions both sides", () => {
  const merged = mergeSnapshots(null, { playlists: [pl("a", "A")], soundPresets: [], prefs: { prerender: false } },
    { playlists: [pl("b", "B")], soundPresets: [{ id: "s", name: "Warm" }], prefs: { prerender: true, soundActiveId: "s" } });
  assert.deepEqual(merged.playlists.map((p) => p.id), ["a", "b"]);
  assert.equal(merged.soundPresets.length, 1);
  assert.deepEqual(merged.prefs, { prerender: true, soundActiveId: "s" });   // joining: the synced prefs win
});

test("prefs: a local change wins, otherwise remote", () => {
  assert.deepEqual(mergePrefs({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 3 }), { x: 2, y: 3 });
});

test("two Favorites playlists fold into one without duplicates", () => {
  const t = (n) => ({ path: `T${n}.sid`, song: 1 });
  const out = foldFavorites([
    { id: "f2", name: "Favorites", favorites: true, created: 20, items: [t(2), t(3)] },
    { id: "p", name: "Other", items: [] },
    { id: "f1", name: "Favorites", favorites: true, created: 10, items: [t(1), t(2)] },
  ]);
  assert.deepEqual(out.map((p) => p.id), ["p", "f1"]);
  assert.deepEqual(out.find((p) => p.id === "f1").items.map((i) => i.path), ["T1.sid", "T2.sid", "T3.sid"]);
});

test("devices: each side's own refresh wins, removals stick, stale ones drop off", () => {
  const now = 10 * DEVICE_TTL_MS;
  const a = { id: "a", os: "macOS", updated: now - 1000 };
  const b = { id: "b", os: "iPhone", updated: now - 2000 };
  const old = { id: "old", os: "Windows", updated: now - DEVICE_TTL_MS - 1 };
  const base = [a, b, old];
  const local = [{ ...a, updated: now }, old];          // a refreshed itself, removed b
  const remote = [a, b, old, { id: "c", os: "Android", updated: now }];   // c joined
  assert.deepEqual(mergeDevices(base, local, remote, now).map((d) => [d.id, d.updated]), [["a", now], ["c", now]]);
});

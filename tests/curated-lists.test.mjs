import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupPattern, hotTunes, listCatalog, listItemId, listItemWrite, parseCuratedLists, validListItem } from "../js/curated-core.js";

const published = () => parseCuratedLists(JSON.parse(readFileSync(new URL("../js/curated-lists.json", import.meta.url))));
const name = (collection, id) => `db/${collection}/${id}`;

test("the published file parses", () => {
  const lists = published();
  assert.ok(lists.composers.includes("Rob Hubbard"));
  assert.ok(lists.groups.includes("Side B"));
});

test("a bad file throws", () => {
  assert.throws(() => parseCuratedLists({ v: 2, composers: [], groups: [], hotTunes: { add: [], remove: [] } }));
  assert.throws(() => parseCuratedLists({ v: 1, composers: [" Rob"], groups: [], hotTunes: { add: [], remove: [] } }));
  assert.throws(() => parseCuratedLists({ v: 1, composers: [], groups: [], hotTunes: { add: ["not a path"], remove: [] } }));
  assert.throws(() => parseCuratedLists({ v: 1, composers: [], groups: [] }));
});

test("group patterns match as the old hand-written ones did", () => {
  assert.equal(groupPattern("Side B").source, String.raw`\bSide B\b`);
  assert.equal(groupPattern("Blues Muz'").source, String.raw`\bBlues Muz'`);
  assert.ok(groupPattern("Maniacs of Noise").test("1989 maniacs of noise"));
  assert.ok(!groupPattern("Side B").test("1990 Side Box"));
  assert.ok(groupPattern("A.B (C)").test("1990 A.B (C)/X"));
  assert.ok(!groupPattern("A.B").test("1990 AxB"));
});

test("Hot tunes changes add to and remove from the generated set", () => {
  const set = hotTunes(["A/a.sid", "A/b.sid"], { add: ["A/c.sid"], remove: ["A/a.sid"] });
  assert.deepEqual([...set].sort(), ["A/b.sid", "A/c.sid"]);
});

test("item keys are checked per list", () => {
  assert.ok(validListItem("composers", "Rob Hubbard"));
  assert.ok(!validListItem("composers", ""));
  assert.ok(!validListItem("nope", "Rob Hubbard"));
  assert.ok(validListItem("hot-tunes", "MUSICIANS/H/Hubbard_Rob/Commando.sid"));
  assert.ok(!validListItem("hot-tunes", "Commando"));
});

test("an item write names the list and hashes the key", async () => {
  const id = await listItemId("Rob Hubbard");
  assert.match(id, /^[0-9a-f]{64}$/);
  const w = listItemWrite(name, "c".repeat(64), "composers", id, "Rob Hubbard", true, true);
  assert.equal(w.update.name, `db/curatedLists/composers/items/${id}`);
  assert.deepEqual(w.update.fields.hidden, { booleanValue: true });
  assert.deepEqual(w.currentDocument, { exists: true });
  assert.throws(() => listItemWrite(name, "c", "hot-tunes", id, "Commando", false));
});

test("the catalog shows pending additions and removals", () => {
  const lists = { composers: ["A", "B"], groups: [], hotTunes: { add: ["X/new.sid"], remove: ["X/old.sid"] } };
  const rows = listCatalog("composers", lists, [{ key: "B", hidden: true }, { key: "C", hidden: false }, { key: "A", hidden: false }]);
  assert.deepEqual(rows.map((r) => [r.key, r.hidden, r.pending]), [["A", false, false], ["B", true, true], ["C", false, true]]);
  const base = new Set(["X/old.sid", "X/base.sid"]);
  const hot = listCatalog("hot-tunes", lists, [{ key: "X/base.sid", hidden: true }], base);
  assert.deepEqual(hot.map((r) => [r.key, r.hidden, r.pending]), [["X/base.sid", true, true], ["X/new.sid", false, false], ["X/old.sid", true, false]]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { addSearch } from "../js/search-history.js";

test("newest first, repeats move to the front", () => {
  assert.deepEqual(addSearch([{ q: "galway" }, { q: "hubbard" }], { q: "Hubbard " }), [{ q: "Hubbard" }, { q: "galway" }]);
  const tune = { path: "/A/b.sid", song: 2 };
  assert.deepEqual(addSearch([{ q: "x" }, tune], { ...tune }), [tune, { q: "x" }]);
});

test("a tune's subtunes are separate entries", () => {
  assert.equal(addSearch([{ path: "/A/b.sid", song: 1 }], { path: "/A/b.sid", song: 2 }).length, 2);
});

test("blank or malformed entries are ignored, plain strings read as queries", () => {
  assert.deepEqual(addSearch([{ q: "tel" }], { q: "   " }), [{ q: "tel" }]);
  assert.deepEqual(addSearch([], { path: "/A/b.sid" }), []);
  assert.deepEqual(addSearch([], "  rob   hubbard "), [{ q: "rob hubbard" }]);
});

test("the list is capped", () => {
  assert.deepEqual(addSearch([{ q: "b" }, { q: "c" }, { q: "d" }], { q: "a" }, 3), [{ q: "a" }, { q: "b" }, { q: "c" }]);
});

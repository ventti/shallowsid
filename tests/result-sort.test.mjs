import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSort, releaseName, releaseYear, sortResults } from "../js/result-sort.js";

const tune = (title, dir, released, extra = {}) => ({ title, dir, name: `${title}.sid`, released, author: "X", song: 1, ...extra });
const items = [
  tune("Zoids", "MUSICIANS/H/Hubbard_Rob", "1986 Martech"),
  tune("Arkanoid", "MUSICIANS/G/Galway_Martin", "1987 Imagine"),
  tune("commando", "MUSICIANS/H/Hubbard_Rob", "1985 Elite"),
  tune("Unknown Year", "DEMOS/A-F", "198? Crest"),
  tune("No Info", "GAMES/M-R", ""),
];
const titles = (list) => list.map((t) => t.title);

test("release field parsing", () => {
  assert.equal(releaseYear("1985 Elite"), 1985);
  assert.equal(releaseYear("1985-1986 Elite"), 1985);
  assert.equal(releaseYear("198? Crest"), 1989.5);
  assert.equal(releaseYear("19?? Someone"), 1999.5);
  assert.equal(releaseYear(""), Infinity);
  assert.equal(releaseName("1985-1986 Elite"), "Elite");
  assert.equal(releaseName("198? Crest"), "Crest");
});

test("each order, and reversing it", () => {
  assert.deepEqual(titles(sortResults(items, { by: "relevance" })), titles(items));
  assert.deepEqual(titles(sortResults(items, { by: "name" })), ["Arkanoid", "commando", "No Info", "Unknown Year", "Zoids"]);
  assert.deepEqual(titles(sortResults(items, { by: "name", desc: true })), ["Zoids", "Unknown Year", "No Info", "commando", "Arkanoid"]);
  assert.deepEqual(titles(sortResults(items, { by: "folder" })), ["Unknown Year", "No Info", "Arkanoid", "commando", "Zoids"]);
  assert.deepEqual(titles(sortResults(items, { by: "release" })), ["Unknown Year", "commando", "Arkanoid", "Zoids", "No Info"]);
  assert.deepEqual(titles(sortResults(items, { by: "year" })), ["commando", "Zoids", "Arkanoid", "Unknown Year", "No Info"]);
  assert.deepEqual(titles(sortResults(items, { by: "year", desc: true })), ["No Info", "Unknown Year", "Arkanoid", "Zoids", "commando"]);
});

test("stored sort values are validated", () => {
  assert.deepEqual(normalizeSort({ by: "year", desc: true }), { by: "year", desc: true });
  assert.deepEqual(normalizeSort({ by: "bogus" }), { by: "relevance", desc: false });
  assert.deepEqual(normalizeSort({ by: "relevance", desc: true }), { by: "relevance", desc: false });
  assert.deepEqual(normalizeSort(null), { by: "relevance", desc: false });
});

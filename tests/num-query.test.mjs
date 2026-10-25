import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, exactYear, fieldHint, matches, parseQuery, perSubtune } from "../js/num-query.js";

const pass = (query, values) => {
  const { filter, error } = parseQuery(query);
  assert.equal(error, null, query);
  return matches(filter, (field) => values[field] ?? null);
};

test("text fields contain anywhere and combine with numeric filters", () => {
  const query = "title=Fish release=Chips year=2038";
  const values = { title: "Big FISH Waltz", release: "2038 Chips Records", year: 2038 };
  assert.ok(pass(query, values));
  for (const field of ["title", "release", "year"]) {
    assert.ok(!pass(query, { ...values, [field]: field === "year" ? 2037 : "Other" }), field);
  }
  assert.equal(parseQuery(query).text, "");
  assert.ok(!perSubtune(parseQuery(query).filter));
  assert.equal(describe(parseQuery(query).filter), "title contains “Fish” and release contains “Chips” and year = 2038");
});

test("composer and author are aliases, with case and accent insensitive phrases", () => {
  assert.ok(pass('composer="Chris Hulsbeck"', { composer: "Chris Hülsbeck / Other" }));
  assert.ok(pass("AUTHOR='rob hubbard'", { composer: "Rob Hubbard" }));
  assert.ok(pass("composer=Hubbard&release=Thalamus|title=Fish", { composer: "Rob Hubbard", release: "1987 Thalamus" }));
  assert.ok(pass("composer=Hubbard&release=Thalamus|title=Fish", { title: "Fish and Chips" }));
  assert.ok(!pass("composer=Hubbard&release=Thalamus|title=Fish", { composer: "Rob Hubbard", release: "Other" }));
  assert.equal(parseQuery('remix composer="Rob Hubbard" bpm>120').text, "remix");
});

test("text filters support exclusion, quoted connectors, and validation", () => {
  assert.ok(pass('title="Fish & Chips"', { title: "Fish & Chips Theme" }));
  assert.ok(pass("release==Extend", { release: "2038 Extend" }));
  assert.ok(pass("release!=Extend", { release: "2038 Chips" }));
  assert.ok(!pass("release!=Extend", { release: "2038 EXTEND" }));
  assert.ok(!pass("release!=Extend", {}));
  assert.ok(!pass("release!=Extend", { release: "" }));
  assert.equal(describe(parseQuery("release!=Extend").filter), "release does not contain “Extend”");
  for (const query of ["title=", 'release=""', 'composer="   "', 'title="Fish']) assert.match(parseQuery(query).error, /needs text/, query);
  assert.match(parseQuery("title>Fish").error, /Use = or !=/);
});

test("plain words are left alone, & and | included", () => {
  assert.deepEqual(parseQuery("Rock & Roll | hubbard"), { text: "Rock & Roll | hubbard", filter: null, error: null, unknown: [] });
  assert.deepEqual(parseQuery("  "), { text: "", filter: null, error: null, unknown: [] });
});

test("every operator, with or without spaces", () => {
  assert.ok(pass("bpm=124", { bpm: 124 }) && pass("bpm == 124", { bpm: 124 }) && !pass("bpm=124", { bpm: 125 }));
  assert.ok(pass("bpm!=124", { bpm: 125 }) && !pass("bpm != 124", { bpm: 124 }));
  assert.ok(pass("bpm>124", { bpm: 125 }) && !pass("bpm > 124", { bpm: 124 }));
  assert.ok(pass("bpm<124", { bpm: 123 }) && !pass("bpm<124", { bpm: 124 }));
  assert.ok(pass("bpm>=124", { bpm: 124 }) && pass("bpm<=124", { bpm: 124 }) && !pass("bpm<=124", { bpm: 125 }));
});

test("& and spaces mean and, | means or, & first", () => {
  assert.ok(pass("bpm>=120 & bpm<130", { bpm: 125 }) && !pass("bpm>=120&bpm<130", { bpm: 130 }));
  assert.ok(pass("bpm>=120 bpm<130", { bpm: 125 }) && !pass("bpm>=120 bpm<130", { bpm: 140 }));
  assert.ok(pass("bpm=100 | bpm=150", { bpm: 150 }) && !pass("bpm=100||bpm=150", { bpm: 125 }));
  // year=1987 | (year=1988 & bpm>140)
  assert.ok(pass("year=1987 | year=1988 & bpm>140", { year: 1987, bpm: 90 }));
  assert.ok(!pass("year=1987 | year=1988 & bpm>140", { year: 1988, bpm: 90 }));
  assert.ok(pass("year=1987 | year=1988 && bpm>140", { year: 1988, bpm: 141 }));
});

test("words and comparisons mix; aliases and m:ss lengths work", () => {
  const q = parseQuery("rob hubbard tempo>140 & len<=3:30");
  assert.equal(q.text, "rob hubbard");
  assert.deepEqual(q.filter, [[{ field: "bpm", op: ">", value: 140 }, { field: "length", op: "<=", value: 210 }]]);
  assert.equal(describe(q.filter), "BPM > 140 and length ≤ 3:30");
  assert.equal(describe(parseQuery("songs>=10 | year!=1985").filter), "subtunes ≥ 10, or year ≠ 1985");
  assert.ok(perSubtune(q.filter));
  assert.ok(!perSubtune(parseQuery("year=1987 songs>2").filter));
});

test("an unknown value never matches, not even !=", () => {
  assert.ok(!pass("bpm!=124", {}));
  assert.ok(!pass("bpm<200", { bpm: null }));
});

test("bpm without an operator is a word, so titles with BPM in them are found", () => {
  for (const q of ["bpm", "150 bpm", "bpm 140", "BPM Record", "bpm140"]) assert.equal(parseQuery(q).filter, null, q);
  assert.equal(parseQuery("I Wanna 150 BPM").text, "I Wanna 150 BPM");
});

test("comparing anything but a field is text, so C=64 and 2 Hours = NOT Enough are found", () => {
  for (const q of ["C=64", "C= Prog Ref Guide", "2 Hours = NOT Enough", "Hest>/dev/null", "a<b"]) {
    const p = parseQuery(q);
    assert.equal(p.filter, null, q);
    assert.equal(p.error, null, q);
  }
  const mixed = parseQuery("c=64 remix bpm>100");
  assert.equal(mixed.text, "c=64 remix");
  assert.deepEqual(mixed.filter, [[{ field: "bpm", op: ">", value: 100 }]]);
  assert.deepEqual(parseQuery("volume>3").unknown, ["volume"]);
  assert.match(fieldHint(parseQuery("volume>3").unknown), /bpm, length, year/);
  assert.equal(fieldHint(parseQuery("bpm>3").unknown), "");
});

test("mistakes in a field's value say what's wrong", () => {
  assert.match(parseQuery("bpm>").error, /needs a number/);
  assert.match(parseQuery("length<abc").error, /needs a number or m:ss/);
});

test("only exact years count", () => {
  assert.equal(exactYear("1987 Thalamus"), 1987);
  assert.equal(exactYear("1987-1988 Ocean"), 1987);
  assert.equal(exactYear("198? Unknown"), null);
  assert.equal(exactYear(""), null);
});

test("SID features compare as 0/1 and read naturally", () => {
  const q = parseQuery("hubbard filter=1 & ringmod=1 & digi=0");
  assert.equal(q.text, "hubbard");
  assert.equal(describe(q.filter), "filter and ring mod and no digi");
  assert.ok(pass("filter=1 & ring!=1", { filter: 1, ring: 0 }));
  assert.ok(!pass("filter=1", { filter: 0 }));
  assert.ok(!pass("filter=0", {}));   // not analysed: unknown, so no match
  assert.equal(describe(parseQuery("speed>=2 | cia=1").filter), "speed ≥ 2, or CIA timer");
  assert.ok(perSubtune(parseQuery("custom=1").filter));
});


import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, exactYear, fieldHint, matches, parseQuery, perSubtune } from "../js/num-query.js";

const pass = (query, values) => {
  const { filter, error } = parseQuery(query);
  assert.equal(error, null, query);
  return matches(filter, (field) => values[field] ?? null);
};

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
  assert.deepEqual(parseQuery("speed>3").unknown, ["speed"]);
  assert.match(fieldHint(parseQuery("speed>3").unknown), /bpm, length, year/);
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

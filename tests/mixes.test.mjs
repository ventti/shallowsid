import { test } from "node:test";
import assert from "node:assert/strict";
import { MIX_SIZE, mixDefinition, mixTunes, pickMixes, weekSeed } from "../js/mixes.js";

const tune = (i, extra = {}) => ({ path: `GAMES/A/t${i}.sid`, dir: "GAMES/A", author: "Rob Hubbard", released: "1986 Ocean", start: 1, lengths: [120], multiSid: false, ...extra });
const tunes = [
  ...Array.from({ length: 80 }, (_, i) => tune(i)),
  ...Array.from({ length: 70 }, (_, i) => tune(100 + i, { dir: "DEMOS/B", author: "Jeroen Tel", released: "1989 Maniacs of Noise" })),
  ...Array.from({ length: 5 }, (_, i) => tune(200 + i, { released: "1983 Nobody", multiSid: true })),
];

test("the same seed gives the same mixes and tunes", () => {
  assert.deepEqual(pickMixes(tunes, ["Rob Hubbard"], "s").map((m) => m.id), pickMixes(tunes, ["Rob Hubbard"], "s").map((m) => m.id));
  assert.deepEqual(mixTunes("year-1986", tunes, "s"), mixTunes("year-1986", tunes, "s"));
});

test("only years and composers with enough tunes get a mix", () => {
  const ids = pickMixes(tunes, ["Rob Hubbard", "Nobody Known"], "x").map((m) => m.id);
  assert.ok(!ids.includes("year-1983"));
  assert.ok(!ids.includes("composer-Nobody Known"));
  assert.ok(ids.filter((id) => id.startsWith("year-")).length <= 2);
});

test("a mix holds matching tunes, at most MIX_SIZE", () => {
  const year = mixTunes("year-1989", tunes, "s");
  assert.equal(year.length, MIX_SIZE);
  assert.ok(year.every((t) => t.released.startsWith("1989")));
  assert.equal(mixTunes("multi-sid", tunes, "s").length, 5);
  assert.deepEqual(mixTunes("nope", tunes, "s"), []);
});

test("composer mixes are titled by the handle", () => {
  assert.equal(mixDefinition("composer-Søren Lund (Jeff)").title, "Jeff mix");
  assert.equal(mixDefinition("composer-Rob Hubbard").title, "Rob Hubbard mix");
  assert.equal(mixDefinition("composer-Rob Hubbard").composer, "Rob Hubbard");
});

test("group mixes match the released credit and need enough tunes", () => {
  const ids = pickMixes(tunes, [], "g").map((m) => m.id);
  assert.ok(ids.includes("group-Maniacs of Noise"));
  assert.ok(!ids.includes("group-Side B"));
  const group = mixTunes("group-Maniacs of Noise", tunes, "s");
  assert.equal(group.length, MIX_SIZE);
  assert.ok(group.every((t) => t.released.includes("Maniacs of Noise")));
  assert.ok(mixDefinition("group-Blues Muz'").filter({ released: "1994 SHAPE/Blues Muz'" }));
  assert.equal(mixDefinition("group-Nobody"), null);
});

test("the seed changes on Monday and holds all week", () => {
  const day = (d) => weekSeed(new Date(2026, 8, d, 12));   // September 2026: the 21st is a Monday
  assert.equal(day(21), day(27));
  assert.notEqual(day(20), day(21));
  assert.notEqual(day(27), day(28));
  assert.equal(weekSeed(new Date(2026, 8, 21, 0, 5)), weekSeed(new Date(2026, 8, 27, 23, 55)));
});

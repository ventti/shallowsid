import { test } from "node:test";
import assert from "node:assert/strict";
import { loopedEnd } from "../js/player/player.js";

const BPS = 10;
// RMS levels per 0.1 s: `seconds` of music, then the tail given.
const levels = (seconds, tail) => Float32Array.from([...Array(seconds * BPS).fill(0.1), ...tail]);

test("ends at the silence when the tune loops back before its listed length", () => {
  // Mutants (Fred Gray): fades out, then starts over ~1 s before its 4:10.
  const peaks = levels(247, [0.04, 0.02, 0.009, 0.008, 0.008, 0.009, 0.005, 0.005, 0.005, 0.16, 0.08, 0.07, 0.1]);
  assert.equal(loopedEnd(peaks, BPS, peaks.length / BPS), 247.9);
});

test("leaves a tune that plays to its end alone", () => {
  const peaks = levels(250, []);
  assert.equal(loopedEnd(peaks, BPS, 250), null);
});

test("leaves a tune that fades out to its end alone", () => {
  const peaks = levels(248, Array(20).fill(0.002));
  assert.equal(loopedEnd(peaks, BPS, 250), null);
});

test("a short break before a final hit is not a loop", () => {
  const peaks = levels(248, [0.005, 0.005, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
  assert.equal(loopedEnd(peaks, BPS, 249), null);
});

test("only the last seconds count", () => {
  const peaks = levels(10, [0.005, 0.005, 0.005, 0.005, 0.2, ...Array(50).fill(0.1)]);
  assert.equal(loopedEnd(peaks, BPS, peaks.length / BPS), null);
});

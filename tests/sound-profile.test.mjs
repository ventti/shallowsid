import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_PRESETS, DEFAULTS, DEFAULT_PRESET, filterFor, normalizeKnobs, normalizePreset, parseProfiles, sameKnobs, serializeProfiles, splitLegacy,
  toEngineConfig,
} from "../js/sound-profile.js";

const builtin = (id) => BUILTIN_PRESETS.find((p) => p.id === id);
const knobs = (id) => normalizeKnobs(builtin(id).chip, builtin(id));

test("defaults match reSIDfp's built-in filter (uCox 20e-6)", () => {
  assert.ok(Math.abs((1 + 39 * DEFAULTS.filter6581Range) * 1e-6 - 20e-6) < 1e-12);
  assert.equal(builtin(DEFAULT_PRESET[6581]).chip, "6581");
  assert.equal(builtin(DEFAULT_PRESET[8580]).chip, "8580");
});

test("built-in presets hold only their chip's knobs, filled from the defaults", () => {
  assert.deepEqual(Object.keys(knobs("csg-8580r5-1690")).sort(), ["combinedWaveforms", "digiBoost", "filter8580Curve"]);
  assert.deepEqual({ ...knobs("connoisseur-8580r5"), digiBoost: true }, knobs("csg-8580r5-1690"));
  assert.equal(knobs("connoisseur-8580r5").digiBoost, false);
});

test("chip and machine are global; each chip takes its knobs from its own preset", () => {
  const sound = { chip: "auto", machine: "auto", 6581: knobs("connoisseur-6581-r4ar"), 8580: knobs("connoisseur-8580r5") };
  const config = toEngineConfig(sound);
  assert.deepEqual(config.emulation, { sidModel: "MOS6581", forceSidModel: false, c64Model: "PAL", forceC64Model: false, digiBoost: false });
  assert.equal(config.filter.filter6581Curve, 0.14);
  assert.equal(config.filter.filter8580Curve, 0.5);
  const forced = toEngineConfig({ ...sound, chip: "8580", machine: "NTSC" }).emulation;
  assert.deepEqual(forced, { sidModel: "MOS8580", forceSidModel: true, c64Model: "NTSC", forceC64Model: true, digiBoost: false });
});

test("combined waveforms follow the chip that plays", () => {
  const sound = { chip: "auto", 6581: { combinedWaveforms: "STRONG" }, 8580: { combinedWaveforms: "WEAK" } };
  assert.equal(filterFor(toEngineConfig(sound), "MOS8580").combinedWaveforms, "WEAK");
  assert.equal(filterFor(toEngineConfig(sound), "UNKNOWN").combinedWaveforms, "STRONG");
  assert.equal(filterFor(toEngineConfig({ ...sound, chip: "6581" }), "MOS8580").combinedWaveforms, "STRONG");
});

test("bad input is clamped or replaced by defaults", () => {
  const s = normalizePreset({ chip: "6582", filter6581Curve: 7, filter6581Range: "x", combinedWaveforms: "strong", old6581Caps: "yes" });
  assert.equal(s.chip, "6581");
  assert.equal(s.filter6581Curve, 1);
  assert.equal(s.filter6581Range, DEFAULTS.filter6581Range);
  assert.equal(s.combinedWaveforms, "STRONG");
  assert.equal(s.old6581Caps, false);
});

test("old presets split by chip; Auto ones become one of each", () => {
  const old = { id: "x", name: "Warm", chip: "auto", machine: "PAL", filter6581Curve: 0.3, filter8580Curve: 0.7, digiBoost: false };
  const [p6581, p8580] = splitLegacy(old);
  assert.deepEqual([p6581.id, p6581.name, p6581.filter6581Curve], ["x-6581", "Warm (6581)", 0.3]);
  assert.deepEqual([p8580.id, p8580.name, p8580.filter8580Curve, p8580.digiBoost], ["x-8580", "Warm (8580)", 0.7, false]);
  assert.equal(splitLegacy({ ...old, chip: "8580" }).length, 1);
});

test("profiles round-trip through export/import, and old files still import", () => {
  const mine = [{ name: "Warm 6581", chip: "6581", ...DEFAULTS, filter6581Curve: 0.3, old6581Caps: true }];
  const back = parseProfiles(serializeProfiles(mine));
  assert.equal(back.length, 1);
  assert.equal(back[0].name, "Warm 6581");
  assert.ok(sameKnobs("6581", back[0], mine[0]));
  assert.throws(() => parseProfiles("[]"), /No sound profiles/);
  assert.equal(parseProfiles('{"chip":"8580"}', "file")[0].name, "file");
  const v1 = JSON.stringify({ kind: "shallowsid-sound-profile", version: 1, profiles: [{ name: "Old", chip: "auto" }] });
  assert.deepEqual(parseProfiles(v1).map((p) => `${p.name}/${p.chip}`), ["Old (6581)/6581", "Old (8580)/8580"]);
});

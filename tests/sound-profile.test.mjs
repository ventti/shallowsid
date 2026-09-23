import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_PRESETS, DEFAULTS, normalizeSettings, parseProfiles, sameSettings, serializeProfiles, toEngineConfig } from "../js/sound-profile.js";

test("defaults match reSIDfp's built-in filter (uCox 20e-6)", () => {
  assert.ok(Math.abs((1 + 39 * DEFAULTS.filter6581Range) * 1e-6 - 20e-6) < 1e-12);
  assert.equal(BUILTIN_PRESETS.find((p) => p.id === "follow-tune").chip, "auto");
});

test("chip and machine map to forced or tune-driven engine settings", () => {
  assert.deepEqual(toEngineConfig({ chip: "auto", machine: "auto" }).emulation, {
    sidModel: "MOS6581", forceSidModel: false, c64Model: "PAL", forceC64Model: false, digiBoost: true,
  });
  const forced = toEngineConfig({ chip: "8580", machine: "NTSC", digiBoost: false }).emulation;
  assert.deepEqual(forced, { sidModel: "MOS8580", forceSidModel: true, c64Model: "NTSC", forceC64Model: true, digiBoost: false });
});

test("bad input is clamped or replaced by defaults", () => {
  const s = normalizeSettings({ chip: "6582", filter6581Curve: 7, filter6581Range: "x", combinedWaveforms: "strong", old6581Caps: "yes" });
  assert.equal(s.chip, "auto");
  assert.equal(s.filter6581Curve, 1);
  assert.equal(s.filter6581Range, DEFAULTS.filter6581Range);
  assert.equal(s.combinedWaveforms, "STRONG");
  assert.equal(s.old6581Caps, false);
});

test("profiles round-trip through export/import", () => {
  const mine = [{ name: "Warm 6581", ...DEFAULTS, chip: "6581", filter6581Curve: 0.3, old6581Caps: true }];
  const back = parseProfiles(serializeProfiles(mine));
  assert.equal(back.length, 1);
  assert.equal(back[0].name, "Warm 6581");
  assert.ok(sameSettings(back[0], mine[0]));
  assert.throws(() => parseProfiles("[]"), /No sound profiles/);
  assert.equal(parseProfiles('{"chip":"8580"}', "file")[0].name, "file");
});

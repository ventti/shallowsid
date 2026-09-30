import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
const { SoundSettings } = await import("../js/sound-settings.js");

const KEY = "shallowsid.sound";
beforeEach(() => storage.clear());

test("starts on Auto with the default preset of each chip", () => {
  const s = new SoundSettings();
  assert.equal(s.chip, "auto");
  assert.deepEqual(s.selected, { 6581: "mos-6581r4ar-0687", 8580: "csg-8580r5-1690" });
});

test("settings saved before the chip split migrate", () => {
  const presets = [{ id: "w", name: "Warm", chip: "auto", machine: "NTSC", filter6581Curve: 0.3, filter8580Curve: 0.7 }];
  storage.set(KEY, JSON.stringify({ activeId: "w", presets, draft: { chip: "6581" } }));
  const s = new SoundSettings();
  assert.deepEqual(s.presets.map((p) => p.id), ["w-6581", "w-8580"]);
  assert.deepEqual(s.selected, { 6581: "w-6581", 8580: "w-8580" });
  assert.equal(s.chip, "auto");
  assert.equal(s.machine, "NTSC");
  assert.equal(s.current[8580].filter8580Curve, 0.7);

  storage.set(KEY, JSON.stringify({ activeId: "csg-8580r5-1690" }));
  assert.equal(new SoundSettings().chip, "8580");
});

test("editing a built-in makes a draft for that chip only", () => {
  const s = new SoundSettings();
  s.update("8580", { digiBoost: false });
  assert.equal(s.isEdited("8580"), true);
  assert.equal(s.isEdited("6581"), false);
  const saved = s.saveAsNew("8580", "No boost");
  assert.equal(saved.chip, "8580");
  assert.equal(s.selected[8580], saved.id);
  s.remove(saved.id);
  assert.equal(s.selected[8580], "csg-8580r5-1690");
});

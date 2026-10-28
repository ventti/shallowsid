import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AppearanceSettings, DEFAULT_HUE, accentRgb } from "../js/appearance.js";

const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
const KEY = "shallowsid.appearance";
beforeEach(() => storage.clear());

test("starts with the original lavender; changes and reset survive reload", () => {
  const settings = new AppearanceSettings();
  assert.equal(settings.hue, DEFAULT_HUE);
  assert.deepEqual(accentRgb(settings.hue), [169, 156, 255]);
  let changes = 0;
  settings.addEventListener("change", () => changes++);
  settings.setHue(180);
  assert.equal(new AppearanceSettings().hue, 180);
  assert.deepEqual(settings.syncPrefs, { accentHue: 180 });
  settings.setHue(180);
  assert.equal(changes, 1);
  settings.setHue(DEFAULT_HUE);
  assert.equal(new AppearanceSettings().hue, DEFAULT_HUE);
});

test("invalid saved or synced hues are ignored; older data keeps the current choice", () => {
  for (const value of [null, "180", -1, 361, 1.5, {}, []]) {
    storage.set(KEY, JSON.stringify({ accentHue: value }));
    assert.equal(new AppearanceSettings().hue, DEFAULT_HUE);
    const settings = new AppearanceSettings();
    settings.setHue(120);
    settings.applySynced({ accentHue: value });
    settings.applySynced({});
    assert.equal(settings.hue, 120);
  }
  storage.set(KEY, "broken JSON");
  assert.equal(new AppearanceSettings().hue, DEFAULT_HUE);
});

test("blocked storage still allows changes for this session", (t) => {
  const original = globalThis.localStorage;
  t.after(() => { globalThis.localStorage = original; });
  globalThis.localStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  const settings = new AppearanceSettings();
  settings.setHue(60);
  assert.equal(settings.hue, 60);
});

test("every hue remains readable on cards and with dark button text", () => {
  const luminance = (rgb) => rgb.map((v) => v / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const surface = luminance([34, 29, 49]), text = luminance([22, 19, 31]);
  for (let hue = 0; hue <= 360; hue++) {
    const rgb = accentRgb(hue);
    assert.ok(rgb.every((v) => Number.isInteger(v) && v >= 156 && v <= 255));
    assert.ok((luminance(rgb) + 0.05) / (surface + 0.05) >= 4.5, `hue ${hue} on cards`);
    assert.ok((luminance(rgb.map((v) => v * 0.88)) + 0.05) / (text + 0.05) >= 4.5, `hue ${hue} pressed button`);
  }
  assert.deepEqual(accentRgb(0), [255, 156, 156]);
  assert.deepEqual(accentRgb(120), [156, 255, 156]);
  assert.deepEqual(accentRgb(240), [156, 156, 255]);
  assert.deepEqual(accentRgb(360), accentRgb(0));
});

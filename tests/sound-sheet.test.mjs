import { test } from "node:test";
import assert from "node:assert/strict";
import { SoundSheet } from "../js/sound-sheet.js";

test("Sound settings preview and reachability follow page visibility", (t) => {
  const elements = new Map([
    "sound-sheet", "sound-import-input", "sound-revert",
  ].map((id) => [id, new EventTarget()]));
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => elements.get(id) };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const settings = Object.assign(new EventTarget(), { engine: "residfp", u64Host: "" });
  let pings = 0;
  const adjusting = [];
  const sheet = new SoundSheet(settings);
  sheet.render = () => {};
  sheet.startPinging = () => { pings++; };
  sheet.addEventListener("adjusting", e => adjusting.push(e.detail));

  settings.u64Host = "192.168.1.64";
  settings.dispatchEvent(new Event("change"));
  assert.equal(pings, 0);

  sheet.open();
  assert.equal(pings, 1);
  assert.equal(sheet.isOpen, true);
  assert.deepEqual(adjusting, [true]);
  sheet.open(); // A sync refresh must not restart preview or reachability checks.
  assert.equal(pings, 1);
  assert.deepEqual(adjusting, [true]);

  settings.u64Host = "192.168.1.65";
  settings.dispatchEvent(new Event("change"));
  assert.equal(pings, 2);

  sheet.close();
  assert.equal(sheet.isOpen, false);
  assert.deepEqual(adjusting, [true, false]);
  settings.u64Host = "192.168.1.66";
  settings.dispatchEvent(new Event("change"));
  assert.equal(pings, 2);
  sheet.close();
  assert.deepEqual(adjusting, [true, false]);
  sheet.open();
  assert.equal(pings, 3);
  assert.deepEqual(adjusting, [true, false, true]);
  sheet.close();
});

test("engine changes hide irrelevant settings and preserve reSIDfp edits", () => {
  const settings = {
    engine: "residfp", chip: "auto", machine: "auto", prerender: true,
    anyEdited: true, presets: [{ id: "mine" }],
    presetsFor: () => ({ builtin: [], mine: [] }),
    knobs: () => ({ filter6581Curve: 0.5, filter6581Range: 0.5, filter8580Curve: 0.5 }),
  };
  const sheet = Object.assign(Object.create(SoundSheet.prototype), {
    settings, root: {}, revertButton: {},
  });
  sheet.render();
  assert.match(sheet.root.innerHTML, /Combined waveforms/);
  assert.match(sheet.root.innerHTML, /sound-import/);
  assert.match(sheet.root.innerHTML, /sound-export/);
  assert.equal(sheet.revertButton.hidden, false);

  settings.engine = "sidlite";
  sheet.render();
  assert.doesNotMatch(sheet.root.innerHTML, /Combined waveforms|Filter curve|Filter range|Old capacitors|Digi boost|presets|Preset|sound-import|sound-export/);
  for (const control of ['data-setting="engine"', 'data-setting="chip"', 'data-setting="machine"', 'id="sound-prerender"']) {
    assert.ok(sheet.root.innerHTML.includes(control), control);
  }
  assert.equal(sheet.revertButton.hidden, true);

  settings.engine = "u64";
  sheet.render();
  assert.match(sheet.root.innerHTML, /sound-u64-host/);
  assert.doesNotMatch(sheet.root.innerHTML, /Combined waveforms|data-setting="chip"|sound-prerender/);
  assert.equal(sheet.revertButton.hidden, true);

  settings.engine = "residfp";
  sheet.render();
  assert.match(sheet.root.innerHTML, /Combined waveforms/);
  assert.match(sheet.root.innerHTML, /sound-import/);
  assert.equal(sheet.revertButton.hidden, false);
  assert.equal(settings.anyEdited, true);
});

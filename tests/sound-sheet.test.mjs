import { test } from "node:test";
import assert from "node:assert/strict";
import { SoundSheet } from "../js/sound-sheet.js";

test("Sound sheet opens and reopens while reachability checks follow visibility", (t) => {
  const elements = new Map([
    "sound-modal", "sound-sheet", "sound-import-input", "sound-revert", "sound-done",
  ].map((id) => [id, new EventTarget()]));
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => elements.get(id) };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const settings = Object.assign(new EventTarget(), { engine: "residfp", u64Host: "" });
  const modal = elements.get("sound-modal");
  let presentations = 0, pings = 0;
  modal.present = () => { presentations++; };
  const sheet = new SoundSheet(settings);
  sheet.render = () => {};
  sheet.startPinging = () => { pings++; };

  sheet.open();
  assert.equal(presentations, 1);
  settings.u64Host = "192.168.1.64";
  settings.dispatchEvent(new Event("change"));
  assert.equal(pings, 0);

  modal.dispatchEvent(new Event("didPresent"));
  assert.equal(pings, 1);
  settings.u64Host = "192.168.1.65";
  settings.dispatchEvent(new Event("change"));
  assert.equal(pings, 2);

  modal.dispatchEvent(new Event("willDismiss"));
  settings.u64Host = "192.168.1.66";
  settings.dispatchEvent(new Event("change"));
  assert.equal(pings, 2);
  sheet.open();
  assert.equal(presentations, 2);
});

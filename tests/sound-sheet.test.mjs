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

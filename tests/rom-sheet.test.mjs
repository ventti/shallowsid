import { test } from "node:test";
import assert from "node:assert/strict";
import { RomSheet } from "../js/rom-sheet.js";

test("empty ROM rows offer file and URL choices without changing data on cancel", (t) => {
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const listeners = {};
  let pickerOpened = 0;
  let menu;
  const root = {
    addEventListener: (event, handler) => { listeners[event] = handler; },
    querySelector: () => ({ click: () => { pickerOpened++; } }),
  };
  globalThis.document = {
    getElementById: () => root,
    createElement: () => ({ addEventListener() {}, present() {} }),
    body: { appendChild: (el) => { menu = el; } },
  };
  const sheet = new RomSheet({}, () => assert.fail("Opening a menu must not change ROMs"));
  const urls = [];
  sheet.fromUrl = (type) => urls.push(type);
  sheet.render();
  assert.equal((root.innerHTML.match(/Add ROM…/g) ?? []).length, 3);
  assert.doesNotMatch(root.innerHTML, /Not added/);
  for (const type of ["basic", "kernal", "chargen"]) {
    listeners.click({ target: { closest: () => ({ dataset: { romAction: "add", type } }) } });
    assert.deepEqual(menu.buttons.map((b) => b.text), ["Choose File…", "Load from URL…", "Cancel"]);
    assert.equal(menu.buttons[2].role, "cancel");
    assert.equal(sheet.type, undefined);
    menu.buttons[0].handler();
    assert.equal(sheet.type, type);
    menu.buttons[1].handler();
    sheet.type = undefined;
  }
  assert.equal(pickerOpened, 3);
  assert.deepEqual(urls, ["basic", "kernal", "chargen"]);
  assert.deepEqual(sheet.entries, {});

  sheet.entries.basic = { name: "Long <ROM> & name.bin" };
  sheet.busy = true;
  sheet.render("Could not load ROM");
  assert.match(root.innerHTML, /Long &lt;ROM&gt; &amp; name.bin/);
  assert.match(root.innerHTML, /data-rom-action="file"[^>]*disabled/);
  assert.match(root.innerHTML, /data-rom-action="url"[^>]*disabled/);
  assert.match(root.innerHTML, /data-rom-action="remove"[^>]*disabled/);
  assert.match(root.innerHTML, /data-rom-action="add"[^>]*disabled/);
  assert.match(root.innerHTML, /role="alert">Could not load ROM/);
  menu = null;
  listeners.click({ target: { closest: () => ({ dataset: { romAction: "add", type: "kernal" } }) } });
  assert.equal(menu, null);
});

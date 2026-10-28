import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncSheet } from "../js/sync-sheet.js";

test("data import and export work with Sync off, on or paused, above deletion", async (t) => {
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  for (const state of [{ hasKey: false }, { hasKey: true, enabled: true }, { hasKey: true, enabled: false }]) {
    const root = new EventTarget();
    globalThis.document = { getElementById: () => root };
    const sync = Object.assign(new EventTarget(), { devices: [], key: "test-key", status: "synced", ...state });
    let imports = 0, exports = 0;
    const sheet = new SyncSheet(sync, {
      onOpen() {},
      onImportData: () => { imports++; },
      onExportData: async () => { exports++; return "cancelled"; },
    });
    sheet.showQR = () => {};
    sheet.render();
    assert.match(root.innerHTML, /Import User Data/);
    assert.match(root.innerHTML, /Export User Data/);
    assert.ok(root.innerHTML.indexOf('id="sync-import"') < root.innerHTML.indexOf('id="sync-export"'));
    if (state.hasKey) assert.ok(root.innerHTML.indexOf('id="sync-export"') < root.innerHTML.indexOf('id="sync-delete"'));
    else assert.doesNotMatch(root.innerHTML, /id="sync-delete"/);
    for (const id of ["sync-import", "sync-export"]) {
      await sheet.onClick({ target: { closest: (selector) => selector === "[data-device]" ? null : { id } } });
    }
    assert.equal(imports, 1);
    assert.equal(exports, 1);
    assert.equal(sync.hasKey, state.hasKey);
    assert.equal(sync.enabled, state.enabled);
  }
});

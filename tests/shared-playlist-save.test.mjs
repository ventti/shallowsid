import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const item = (n) => ({ path: `MUSICIANS/A/Tune_${n}.sid`, song: 1 });


test("shared playlist saves use the same import conflict flow and respect cancellation", async () => {
  const elements = new Map();
  const shared = { name: "Mix", items: [item(1)] };
  const context = vm.createContext({
    dom: { title: {}, view: {} }, esc: (s) => s,
    resolveItems: (items) => items, showList() {},
    $(id) {
      if (!elements.has(id)) elements.set(id, { addEventListener(_event, handler) { this.click = handler; } });
      return elements.get(id);
    },
    async saveImportedPlaylist(name, items) { context.received = { name, items }; return context.saved; },
    go(hash) { context.destination = hash; },
  });
  vm.runInContext(source.slice(source.indexOf('function showShared('), source.indexOf('let renderedRoute')), context);
  context.showShared(shared, '');
  await elements.get('share-save').click();
  assert.equal(context.received.name, shared.name);
  assert.equal(context.received.items, shared.items);
  assert.equal(context.destination, undefined, 'cancel leaves the shared preview open');
  context.saved = { id: 'merged' };
  await elements.get('share-save').click();
  assert.equal(context.destination, '#/playlist/merged');
});

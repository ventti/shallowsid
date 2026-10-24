import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionSheet } from '../js/ui.js';

for (const initial of [false, true]) {
  test(`menu toggle shows saved ${initial ? 'enabled' : 'disabled'} state and stays open when changed`, () => {
    const attributes = new Map();
    const changes = [];
    const button = { setAttribute: (key, value) => attributes.set(key, value) };
    globalThis.document = {
      body: { appendChild() {} },
      createElement: () => ({
        addEventListener() {}, present() {},
        querySelector: () => button,
      }),
    };
    const sheet = actionSheet('Playlist', [{
      text: 'Allow duplicates',
      toggle: { checked: initial, onChange: value => changes.push(value) },
    }]);
    const option = sheet.buttons[0];
    assert.equal(option.htmlAttributes.role, 'switch');
    assert.equal(option.htmlAttributes['aria-checked'], String(initial));
    assert.equal(option.handler(), false);
    assert.equal(attributes.get('aria-checked'), String(!initial));
    assert.equal(option.handler(), false);
    assert.equal(attributes.get('aria-checked'), String(initial));
    assert.deepEqual(changes, [!initial, initial]);
  });
}

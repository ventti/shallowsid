import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prompt } from '../js/ui.js';

test('name validation keeps the prompt open and allows correcting the name', async () => {
  let alert;
  const events = new Map();
  globalThis.document = {
    body: { appendChild() {} },
    createElement() {
      alert = { addEventListener: (name, fn) => events.set(name, fn), present() {} };
      return alert;
    },
  };
  const result = prompt('New playlist', { validate: name => name === 'Mix' ? 'Choose another name.' : null });
  const save = alert.buttons[1].handler;
  assert.equal(save({ value: 'Mix' }), false);
  assert.equal(alert.message, 'Choose another name.');
  assert.notEqual(save({ value: 'Other' }), false);
  events.get('didDismiss')();
  assert.equal(await result, 'Other');
});

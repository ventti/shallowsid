import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playlistImportSheet } from '../js/playlist-import-sheet.js';

// Exercise sheet decisions without Ionic or a browser; no stored playlists are edited here.
function open(existing, incoming, index = new Map()) {
  let dialog;
  globalThis.document = {
    body: { append() {} },
    createElement() {
      const events = new Map();
      dialog = {
        open: false, innerHTML: '',
        addEventListener(name, fn) { events.set(name, fn); },
        showModal() { this.open = true; }, close() { this.open = false; }, remove() {},
        setAttribute() {}, querySelector() { return null; },
        click(action, row = 0) { events.get('click')({ target: { closest: () => ({ dataset: { action, row: String(row) } }) } }); },
        choose(value, row = 0) { events.get('ionChange')({ target: { dataset: { mergeSegment: `choice-${row}` } }, detail: { value } }); },
        order(value) { events.get('ionChange')({ target: { dataset: { mergeSegment: 'order' } }, detail: { value } }); },
        escape() { events.get('cancel')({ preventDefault() {} }); },
      };
      return dialog;
    },
  };
  const target = { id: 'existing', name: 'Mix', items: existing, created: 1, share: { id: 'link' } };
  const result = playlistImportSheet([target], { name: 'Mix', items: incoming }, index);
  return { dialog, result, target };
}
const tune = (path, song = 1) => ({ path, song });

test('shows several differences with subtune numbers in segmented controls', async () => {
  const { dialog, result } = open([tune('A', 2), tune('B', 3)], [tune('A', 5), tune('B', 4)]);
  dialog.click('review');
  assert.match(dialog.innerHTML, /2 differences/);
  assert.match(dialog.innerHTML, /data-merge-segment="choice-0"/);
  assert.match(dialog.innerHTML, /data-merge-segment="choice-1"/);
  assert.match(dialog.innerHTML, /Current<small>Subtune 2/);
  assert.match(dialog.innerHTML, /Imported<small>Subtune 5/);
  assert.match(dialog.innerHTML, /Keep both/);
  dialog.choose('new', 0); dialog.choose('both', 1);
  dialog.click('save');
  assert.deepEqual((await result).items, [tune('A', 5), tune('B', 3), tune('B', 4)]);
});

test('changes stay staged and retain the original contents for concurrent edit checks', async () => {
  const { dialog, result, target } = open([tune('A', 2)], [tune('A', 5)]);
  dialog.click('review'); dialog.choose('new');
  assert.deepEqual(target.items, [tune('A', 2)]);
  target.items[0].song = 3;
  dialog.click('save');
  const saved = await result;
  assert.deepEqual(saved.items, [tune('A', 5)]);
  assert.equal(saved.original[0].song, 2);
  assert.equal(saved.target.share.id, 'link');
});

test('apply to remaining respects explicit decisions and only affects the same kind', async () => {
  const { dialog, result } = open([tune('A'), tune('B'), tune('C')], [tune('D')]);
  dialog.click('review');
  dialog.choose('keep', 1); // Keep this explicit decision even when applying Remove from above.
  dialog.choose('remove', 0); dialog.click('remaining', 0);
  dialog.choose('add', 3); dialog.click('save');
  assert.deepEqual((await result).items, [tune('B'), tune('D')]);
});

test('Back returns to the opening page and retains review decisions', async () => {
  const { dialog, result } = open([tune('A')], [tune('B')]);
  dialog.click('review'); dialog.choose('remove', 0); dialog.choose('add', 1);
  assert.match(dialog.innerHTML, /Save Changes/);
  assert.doesNotMatch(dialog.innerHTML, /data-action="next"/);
  dialog.click('back');
  assert.match(dialog.innerHTML, /Playlist already exists/);
  dialog.click('review');
  assert.match(dialog.innerHTML, /data-merge-segment="choice-0" value="remove"/);
  assert.match(dialog.innerHTML, /data-merge-segment="choice-1" value="add"/);
  dialog.choose('keep', 0); dialog.choose('skip', 1); dialog.click('save');
  assert.deepEqual((await result).items, [tune('A')]);
});

test('song order uses a two-way segment and applies the selected order', async () => {
  const { dialog, result } = open([tune('A'), tune('B')], [tune('B'), tune('A')]);
  dialog.click('review');
  assert.match(dialog.innerHTML, /Review Changes/);
  assert.doesNotMatch(dialog.innerHTML, /0 differences/);
  dialog.click('back');
  assert.match(dialog.innerHTML, /Playlist already exists/);
  dialog.click('review');
  assert.match(dialog.innerHTML, /data-merge-segment="order"/);
  dialog.order('new'); dialog.click('save');
  assert.deepEqual((await result).items, [tune('B'), tune('A')]);
});

test('identical playlists skip the empty review and can still be cancelled', async () => {
  const { dialog, result, target } = open([tune('A')], [tune('A')]);
  dialog.click('review');
  assert.match(dialog.innerHTML, /Review Changes/);
  assert.doesNotMatch(dialog.innerHTML, /0 differences/);
  dialog.escape();
  assert.equal(await result, null);
  assert.deepEqual(target.items, [tune('A')]);
});

test('replacement requires Save and Back returns to the opening sheet', async () => {
  const { dialog, result, target } = open([tune('A')], [tune('B')]);
  dialog.click('new');
  assert.deepEqual(target.items, [tune('A')]);
  dialog.click('back'); assert.match(dialog.innerHTML, /Playlist already exists/);
  dialog.click('new'); dialog.click('save');
  assert.deepEqual((await result).items, [tune('B')]);
});

test('cancel discards decisions and Save as New Playlist requests a separate copy', async () => {
  const cancelled = open([tune('A')], [tune('B')]);
  cancelled.dialog.click('review'); cancelled.dialog.choose('remove'); cancelled.dialog.escape();
  assert.equal(await cancelled.result, null);
  assert.deepEqual(cancelled.target.items, [tune('A')]);
  const copied = open([tune('A')], [tune('B')]);
  copied.dialog.click('copy');
  assert.deepEqual(await copied.result, { kind: 'copy' });
});

test('opening sheet omits zero counts and competing global actions', async () => {
  const { dialog, result } = open([tune('A', 2)], [tune('A', 5), tune('B')]);
  assert.match(dialog.innerHTML, /1 added · 1 subtune change/);
  assert.doesNotMatch(dialog.innerHTML, /0 removed|Keep existing|Keep all tunes/);
  assert.match(dialog.innerHTML, /Replace Playlist/);
  assert.match(dialog.innerHTML, /Save as New Playlist/);
  dialog.escape(); await result;
});


test('order choice is omitted when both orders produce the same playlist', async () => {
  const { dialog, result } = open([tune('A', 2)], [tune('A', 3), tune('B')]);
  dialog.click('review');
  assert.doesNotMatch(dialog.innerHTML, /data-merge-segment="order"/);
  dialog.escape(); await result;
});

test('order choice includes added tunes inserted between current tunes', async () => {
  const { dialog, result } = open([tune('A'), tune('C')], [tune('A'), tune('B'), tune('C')]);
  dialog.click('review');
  assert.match(dialog.innerHTML, /Current order/);
  assert.match(dialog.innerHTML, /Imported order/);
  dialog.order('new'); dialog.click('save');
  assert.deepEqual((await result).items, [tune('A'), tune('B'), tune('C')]);
});

test('review shows tune metadata and hides paths unless titles and composers collide', async () => {
  globalThis.self = { PixelAvatar: { svg: () => '<svg></svg>', rng: () => () => 0.5 } };
  const index = new Map([
    ['A', { path: 'A', title: 'Alpha', author: 'Composer', released: '1985', songs: 3 }],
    ['B', { path: 'B', title: 'Beta', author: 'Composer', songs: 1 }],
  ]);
  const { dialog, result } = open([tune('A', 2)], [tune('B')], index);
  dialog.click('review');
  assert.match(dialog.innerHTML, /Composer · 1985/);
  assert.match(dialog.innerHTML, /#2\/3/);
  assert.doesNotMatch(dialog.innerHTML, /class="merge-path">A</);
  dialog.escape(); await result;
  index.get('B').title = 'Alpha';
  const ambiguous = open([tune('A')], [tune('B')], index);
  ambiguous.dialog.click('review');
  assert.match(ambiguous.dialog.innerHTML, /class="merge-path">A</);
  assert.match(ambiguous.dialog.innerHTML, /class="merge-path">B</);
  ambiguous.dialog.escape(); await ambiguous.result;
});

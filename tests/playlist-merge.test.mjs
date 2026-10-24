import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePlaylists, mergedItems, nameKey, nextPlaylistName, sameItems } from '../js/playlist-merge.js';
const tune = (path, song = 1) => ({ path, song });

test('names ignore whitespace and case, and copies get an unused suffix', () => {
  assert.equal(nameKey('  My   MIX '), nameKey('my mix'));
  assert.equal(nextPlaylistName('Mix', [{ name: 'Mix' }]), 'Mix (1)');
  assert.equal(nextPlaylistName('Mix', [{ name: 'mix (1)' }, { name: 'Mix (2)' }]), 'Mix (3)');
  assert.equal(nextPlaylistName('Mix', [{ name: 'Mix (2)' }]), 'Mix (1)');
});

test('exact matches include order, subtunes and repeated occurrences', () => {
  const a = tune('A'), b = tune('B');
  assert.ok(sameItems([a, b], [a, b]));
  assert.ok(!sameItems([a, b], [b, a]));
  assert.ok(!sameItems([a], [tune('A', 2)]));
  const diff = comparePlaylists([a, a], [a]);
  assert.equal(diff.differences.length, 1);
  assert.equal(diff.differences[0].kind, 'removed');
  assert.deepEqual(mergedItems(diff.rows, new Map([[diff.differences[0], 'keep']])), [a, a]);
});

test('exact subtunes match before pairing changed subtunes', () => {
  const old = [tune('A', 1), tune('A', 2)];
  const incoming = [tune('A', 2), tune('A', 3)];
  const diff = comparePlaylists(old, incoming);
  assert.equal(diff.differences.length, 1);
  const row = diff.differences[0];
  assert.equal(row.kind, 'subtune');
  assert.equal(row.existing.song, 1);
  assert.equal(row.incoming.song, 3);
  assert.deepEqual(mergedItems(diff.rows, new Map([[row, 'new']]), 'new'), incoming);
  assert.deepEqual(mergedItems(diff.rows, new Map([[row, 'both']])), [old[0], incoming[1], old[1]]);
});

test('mixed decisions and order retain the chosen occurrences', () => {
  const a = tune('A'), b = tune('B'), c = tune('C'), d = tune('D');
  const diff = comparePlaylists([a, b, c], [c, a, d]);
  assert.ok(diff.orderChanged);
  const choices = new Map(diff.differences.map(row => [row, row.kind === 'added' ? 'add' : 'keep']));
  assert.deepEqual(mergedItems(diff.rows, choices), [a, b, c, d]);
  assert.deepEqual(mergedItems(diff.rows, choices, 'new'), [c, a, d, b]);
  for (const row of diff.differences) choices.set(row, row.kind === 'added' ? 'add' : 'remove');
  assert.deepEqual(mergedItems(diff.rows, choices, 'new'), [c, a, d]);
  assert.deepEqual(mergedItems([], new Map()), []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { matchZip, sidHash, zipSids } from '../js/zip-playlist.js';
import { decodeRow } from '../js/index-store.js';
import { nameFromFileName } from '../js/playlist-format.js';

function archive(entries, method = 8) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name), payload = method === 8 ? deflateRawSync(data) : data;
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50); l.writeUInt16LE(method, 8);
    l.writeUInt32LE(payload.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(payload.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, n, payload); central.push(c, n); offset += l.length + n.length + payload.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return new Blob([Buffer.concat([...locals, dir, end])]);
}

test('full SHA-1 base64 fingerprint and catalogue column', async () => {
  assert.equal(await sidHash(new TextEncoder().encode('abc')), 'qZk+NkcGgWq6PiVxeFDCbJzQ2J0=');
  const row = [0, 'test.sid', '', 0, '', 1, 1, 0, [], [], [], [], 'hash'];
  assert.equal(decodeRow(row, 0, [''], ['']).hash, 'hash');
  assert.equal(nameFromFileName('My tunes.zip'), 'My tunes');
});
for (const method of [0, 8]) test(`ZIP matches renamed files locally, compression ${method}`, async () => {
  const data = Buffer.from('PSID example');
  const index = { tunes: [{ path: 'MUSICIANS/test.sid', start: 3, hash: await sidHash(data) }] };
  const file = archive([['renamed.sid', data], ['missing.sid', Buffer.from('other')], ['notes.txt', data], ['__MACOSX/._test.sid', data]], method);
  assert.deepEqual(await matchZip(file, index), { items: [{ path: 'MUSICIANS/test.sid', song: 3 }], skipped: 1 });
});

test('invalid ZIP and stale catalogue fail without creating items', async () => {
  await assert.rejects(async () => { for await (const entry of zipSids(new Uint8Array(30))) void entry; }, /Invalid/);
  await assert.rejects(matchZip(new Blob([]), { tunes: [] }), /catalogue/);
});

test('identical catalogue files prefer the ZIP path, then catalogue order', async () => {
  const data = Buffer.from('PSID duplicate'), hash = await sidHash(data);
  const tunes = [{ path: 'A/one.sid', start: 1, hash }, { path: 'B/two.sid', start: 2, hash }];
  assert.deepEqual((await matchZip(archive([['collection/B/two.sid', data], ['renamed.sid', data]]), { tunes })).items,
    [{ path: 'B/two.sid', song: 2 }, { path: 'A/one.sid', song: 1 }]);
});

test('unsupported compression and oversized archives are rejected', async () => {
  const index = { tunes: [{ hash: 'test' }] };
  await assert.rejects(matchZip(archive([['test.sid', Buffer.from('x')]], 99), index), /compression/);
  await assert.rejects(matchZip({ size: 129 * 1024 * 1024 }, index), /too large/);
});

for (const magic of ['PSID', 'RSID']) test(`${magic}: metadata edits match; playback and music edits do not`, async () => {
  const original = Buffer.alloc(160);
  original.write(magic);
  original.writeUInt16BE(0x7c, 6);
  original.writeUInt16BE(3, 14);
  const edited = Buffer.from(original);
  edited.fill(65, 0x16, 0x76);
  const hash = await sidHash(original);
  assert.equal(await sidHash(edited), hash);
  // Hashing must not change the bytes supplied by the caller.
  assert.equal(edited[0x16], 65);
  for (const offset of [4, 6, 8, 10, 12, 14, 16, 18, 0x76, 0x7c, 159]) {
    const changed = Buffer.from(edited);
    changed[offset] ^= 1;
    assert.notEqual(await sidHash(changed), hash, `offset ${offset}`);
  }
  const index = { tunes: [{ path: 'MUSICIANS/Test/song.sid', start: 2, hash }] };
  assert.deepEqual(await matchZip(archive([['renamed.sid', edited]]), index),
    { items: [{ path: 'MUSICIANS/Test/song.sid', song: 2 }], skipped: 0 });
});

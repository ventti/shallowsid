import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionId, definitionWrite, parseVocab } from '../js/tags-core.js';
import { TagService } from '../js/tags.js';

globalThis.localStorage = { getItem: () => null };
const config = { apiKey: 'x', projectId: 'test' };
const service = (role) => {
  const s = new TagService({ config, fetchJSON: async () => ({ groups: [], retired: [] }) });
  s.state = { cid: 'a'.repeat(64), role };
  return s;
};

test('definition IDs are stable valid slugs and create-only writes', () => {
  assert.equal(definitionId('Électro / House!'), 'electro-house');
  assert.equal(definitionId('a'.repeat(40)).length, 24);
  const d = { id: 'new', label: 'New', group: 'Style', description: 'A new sound.' };
  const w = definitionWrite((c,id) => c + '/' + id, 'a'.repeat(64), d);
  assert.deepEqual(w.currentDocument, { exists: false });
  assert.equal(w.update.name, 'tagDefinitions/new');
});

test('ordinary users and curators never fetch definitions during init', async () => {
  for (const role of [null, 'curator']) {
    const s = service(role);
    let reads = 0;
    s.refreshCurator = async () => null;
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () => { reads++; throw new Error('unexpected database read'); };
    try {
      await s.init();
      await assert.rejects(s.definitions(), /Only admins/);
      assert.equal(reads, 0);
    } finally { globalThis.fetch = oldFetch; }
  }
});

test('admin definition reads cache and manual refresh reads again', async () => {
  const s = service('admin');
  let reads = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { reads++; return new Response(JSON.stringify({ documents: [] })); };
  try {
    await Promise.all([s.definitions(), s.definitions()]);
    await s.definitions();
    assert.equal(reads, 1);
    await s.definitions(true);
    assert.equal(reads, 2);
    s.step = async () => {};
    const added = await s.addDefinition('New Sound', 'Sound', 'A new sound.');
    assert.equal(reads, 2);
    assert.equal((await s.definitions())[0].id, added.id);
    assert.equal(s.vocab.byId.has(added.id), false);
    await assert.rejects(s.addDefinition('New Sound', 'Sound', 'Again.'), /already exists/);
    s.vocab = parseVocab({ retired: ['retired'], groups: [] });
    await assert.rejects(s.addDefinition('Retired', 'Style', 'Again.'), /already exists/);
  } finally { globalThis.fetch = oldFetch; }
});

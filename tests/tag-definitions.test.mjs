import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionId, definitionWrite, parseVocab, tagCatalog } from '../js/tags-core.js';
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

test('catalog lists published and pending tags; edits stay pending until published', () => {
  const vocab = parseVocab({ groups: [{ name: 'Style', tags: [{ id: 'acid', label: 'Acid' }, { id: 'funk', label: 'Funk', description: 'Groovy.' }] }] });
  const rows = tagCatalog(vocab, [
    { id: 'funk', label: 'Funk', group: 'Style', description: 'Groovy.' },
    { id: 'acid', label: 'Acid', group: 'Style', description: 'Squelchy.' },
    { id: 'new', label: 'New', group: 'Mood', description: 'Fresh.' },
  ]);
  const by = Object.fromEntries(rows.map(t => [t.id, t]));
  assert.deepEqual(rows.map(t => t.id), ['acid', 'funk', 'new']);
  assert.deepEqual([by.acid.published, by.acid.pending, by.acid.description], [true, true, 'Squelchy.']);
  assert.deepEqual([by.funk.published, by.funk.pending], [true, false]);
  assert.deepEqual([by.new.published, by.new.pending], [false, true]);
  assert.equal(tagCatalog(vocab, []).every(t => !t.pending), true);
});

test('admin edits published and pending tags', async () => {
  const s = service('admin');
  s.vocab = parseVocab({ groups: [{ name: 'Style', tags: [{ id: 'acid', label: 'Acid' }] }] });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ documents: [] }));
  const writes = [];
  s.step = async (w) => writes.push(...await w());
  try {
    await s.editDefinition('acid', 'Acid ', 'Sound', 'Squelchy.');
    assert.deepEqual(writes[0].currentDocument, { exists: false });
    await s.editDefinition('acid', 'Acid', 'Style', 'Squelchier.');
    assert.deepEqual(writes[1].currentDocument, { exists: true });
    assert.equal((await s.definitions()).length, 1);
    assert.equal((await s.definitions())[0].description, 'Squelchier.');
    await s.editDefinition('acid', 'Acid', 'Style', '');
    assert.equal((await s.definitions())[0].description, '');
    const added = await s.addDefinition('No Words', 'Mood', ' ');
    assert.equal(added.description, '');
    await assert.rejects(s.editDefinition('missing', 'Missing', 'Style', 'No.'), /doesn't exist/);
  } finally { globalThis.fetch = oldFetch; }
});

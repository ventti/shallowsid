import copy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from sync_tag_vocab import merge, check_changes


def doc(tag_id='zz-new-tag', **changes):
    fields = {k: {'stringValue': v} for k,v in dict(label='ZZ New Tag', group='Style', description='A new sound.', by='a'*64).items()}
    fields['at'] = {'timestampValue': '2026-10-18T00:00:00Z'}
    fields.update(changes)
    return {'name': 'projects/test/tagDefinitions/' + tag_id, 'fields': fields}


class VocabTests(unittest.TestCase):
    def setUp(self):
        self.vocab = json.loads((Path(__file__).resolve().parents[1] / 'js/tags-vocab.json').read_text())

    def test_addition_idempotent(self):
        result = merge(self.vocab, [doc()])
        check_changes(self.vocab, result)
        self.assertEqual(merge(result, [doc()]), result)
        self.assertEqual(self.vocab['groups'][0]['tags'][0]['id'], 'acid')

    def test_reject_conflicts_and_invalid_definitions(self):
        for document in [doc('BAD'), doc(group={'stringValue':'Other'}), doc(description={'stringValue':' '}), doc(extra={'stringValue':'x'}), doc(by={'stringValue':'not-an-admin-id'}), doc(at={'timestampValue':'bad'})]:
            with self.subTest(document=document), self.assertRaises(ValueError):
                merge(self.vocab, [document])
        self.vocab['retired'] = ['zz-new-tag']
        with self.assertRaises(ValueError):
            merge(self.vocab, [doc()])

    def test_edit_existing_tag(self):
        result = merge(self.vocab, [doc('acid', label={'stringValue': 'Acid'}, description={'stringValue': 'Squelchy filter lines.'})])
        check_changes(self.vocab, result)
        self.assertEqual(result['groups'][0]['tags'][0], {'id': 'acid', 'label': 'Acid', 'description': 'Squelchy filter lines.'})
        self.assertEqual(merge(result, [doc('acid', label={'stringValue': 'Acid'}, description={'stringValue': 'Squelchy filter lines.'})]), result)

    def test_description_optional(self):
        result = merge(self.vocab, [doc(description={'stringValue': ''}), doc('acid', label={'stringValue': 'Acid House Old'}, description={'stringValue': ''})])
        check_changes(self.vocab, result)
        tags = {t['id']: t for g in result['groups'] for t in g['tags']}
        self.assertEqual(tags['zz-new-tag'], {'id': 'zz-new-tag', 'label': 'ZZ New Tag'})
        self.assertEqual(tags['acid'], {'id': 'acid', 'label': 'Acid House Old'})

    def test_edit_moves_tag_to_other_category(self):
        result = merge(self.vocab, [doc('acid', label={'stringValue': 'Acid'}, group={'stringValue': 'Sound'})])
        check_changes(self.vocab, result)
        self.assertNotIn('acid', [t['id'] for t in result['groups'][0]['tags']])
        self.assertIn('acid', [t['id'] for g in result['groups'] if g['name'] == 'Sound' for t in g['tags']])

    def test_reject_invalid_edits_removals_retired_changes(self):
        for change in ['bad-edit', 'remove', 'retire']:
            other = copy.deepcopy(self.vocab)
            if change == 'bad-edit': other['groups'][0]['tags'][0]['label'] = ' '
            if change == 'remove': other['groups'][0]['tags'].pop()
            if change == 'retire': other['retired'].append('new-retired')
            with self.subTest(change=change), self.assertRaises(ValueError):
                check_changes(self.vocab, other)

    def test_empty_export_noop(self):
        # Existing source order is alphabetical.
        self.assertEqual(merge(self.vocab, []), self.vocab)

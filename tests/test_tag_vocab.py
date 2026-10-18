import copy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from sync_tag_vocab import merge, check_additions


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
        check_additions(self.vocab, result)
        self.assertEqual(merge(result, [doc()]), result)
        self.assertEqual(self.vocab['groups'][0]['tags'][0]['id'], 'acid')

    def test_reject_conflicts_and_invalid_definitions(self):
        for document in [doc('acid'), doc('BAD'), doc(group={'stringValue':'Other'}), doc(description={'stringValue':''}), doc(extra={'stringValue':'x'}), doc(by={'stringValue':'not-an-admin-id'}), doc(at={'timestampValue':'bad'})]:
            with self.subTest(document=document), self.assertRaises(ValueError):
                merge(self.vocab, [document])
        self.vocab['retired'] = ['zz-new-tag']
        with self.assertRaises(ValueError):
            merge(self.vocab, [doc()])

    def test_reject_edits_removals_retired_changes(self):
        for change in ['edit', 'remove', 'retire']:
            other = copy.deepcopy(self.vocab)
            if change == 'edit': other['groups'][0]['tags'][0]['label'] = 'changed'
            if change == 'remove': other['groups'][0]['tags'].pop()
            if change == 'retire': other['retired'].append('new-retired')
            with self.subTest(change=change), self.assertRaises(ValueError):
                check_additions(self.vocab, other)

    def test_empty_export_noop(self):
        # Existing source order is alphabetical.
        self.assertEqual(merge(self.vocab, []), self.vocab)

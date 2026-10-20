import hashlib
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from sync_curated_lists import check, check_changes, hot_tunes_base, merge

REPO = Path(__file__).resolve().parents[1]
BASE = {'MUSICIANS/A/a.sid', 'MUSICIANS/B/b.sid'}


def doc(list_name, key, hidden=False, **changes):
    fields = {'key': {'stringValue': key}, 'hidden': {'booleanValue': hidden}, 'by': {'stringValue': 'a' * 64},
              'at': {'timestampValue': '2026-10-20T00:00:00Z'}}
    fields.update(changes)
    doc_id = hashlib.sha256(key.encode()).hexdigest()
    return {'name': f'projects/p/databases/(default)/documents/curatedLists/{list_name}/items/{doc_id}', 'fields': fields}


def lists(**changes):
    return {'v': 1, 'composers': ['Rob Hubbard'], 'groups': ['Side B'], 'hotTunes': {'add': [], 'remove': []}, **changes}


class CuratedListTests(unittest.TestCase):
    def test_published_file_is_valid(self):
        check(json.loads((REPO / 'js/curated-lists.json').read_text()), hot_tunes_base())

    def test_add_and_remove(self):
        result = merge(lists(), [doc('composers', 'Ben Daglish'), doc('composers', 'Rob Hubbard', True), doc('groups', 'Vibrants')], BASE)
        check_changes(lists(), result, BASE)
        self.assertEqual(result['composers'], ['Ben Daglish'])
        self.assertEqual(result['groups'], ['Side B', 'Vibrants'])

    def test_hot_tunes_changes(self):
        result = merge(lists(), [doc('hot-tunes', 'MUSICIANS/C/c.sid'), doc('hot-tunes', 'MUSICIANS/A/a.sid', True)], BASE)
        self.assertEqual(result['hotTunes'], {'add': ['MUSICIANS/C/c.sid'], 'remove': ['MUSICIANS/A/a.sid']})
        # Putting them back undoes the changes.
        again = merge(result, [doc('hot-tunes', 'MUSICIANS/C/c.sid', True), doc('hot-tunes', 'MUSICIANS/A/a.sid')], BASE)
        self.assertEqual(again['hotTunes'], {'add': [], 'remove': []})

    def test_merge_is_idempotent(self):
        docs = [doc('composers', 'Ben Daglish'), doc('hot-tunes', 'MUSICIANS/B/b.sid', True)]
        once = merge(lists(), docs, BASE)
        self.assertEqual(merge(once, docs, BASE), once)

    def test_reject_invalid_items(self):
        bad = [
            doc('composers', ' Rob'),
            doc('hot-tunes', 'Commando'),
            doc('composers', 'X', extra={'stringValue': 'x'}),
            doc('composers', 'X', by={'stringValue': 'not-an-admin'}),
            doc('composers', 'X', at={'timestampValue': 'bad'}),
            doc('composers', 'X', hidden={'stringValue': 'yes'}),
            {**doc('composers', 'X'), 'name': doc('composers', 'X')['name'].replace('/composers/', '/other/')},
            {**doc('composers', 'X'), 'name': doc('composers', 'X')['name'][:-64] + '0' * 64},
        ]
        for document in bad:
            with self.subTest(document=document), self.assertRaises(ValueError):
                merge(lists(), [document], BASE)

    def test_check_rejects_bad_files(self):
        for data in [
            lists(v=2),
            lists(extra=[]),
            lists(composers=['B', 'A']),
            lists(composers=['A', 'A']),
            lists(groups=[' Side B']),
            lists(hotTunes={'add': ['MUSICIANS/A/a.sid'], 'remove': []}),
            lists(hotTunes={'add': [], 'remove': ['MUSICIANS/C/c.sid']}),
            lists(hotTunes={'add': []}),
        ]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                check(data, BASE)


if __name__ == '__main__':
    unittest.main()

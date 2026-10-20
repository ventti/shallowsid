#!/usr/bin/env python3
"""Publish admin changes to the curated lists (Firestore curatedLists) into js/curated-lists.json.

Usage:
  python3 tools/sync_curated_lists.py              read Firestore and update the file
  python3 tools/sync_curated_lists.py --check      only check the file (for hand edits)
  python3 tools/sync_curated_lists.py --before F   check the file against an older version F

With FIRESTORE_EMULATOR_HOST set, it reads the emulator (tools/dev.sh runs one
for --project demo-shallowsid).
"""
import argparse
import copy
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LISTS = ('composers', 'groups', 'hot-tunes')
MAX_KEY = 200
TUNE_PATH = re.compile(r'[A-Z_]+/.+\.sid')
CURATOR_ID = re.compile(r'[0-9a-f]{64}')


def hot_tunes_base(path=REPO / 'js' / 'hot-tunes.js'):
    """The generated Hot tunes paths in js/hot-tunes.js."""
    return set(re.findall(r'"([^"]+\.sid)"', Path(path).read_text()))


def valid_key(list_name, key):
    return (isinstance(key, str) and 1 <= len(key) <= MAX_KEY and key.strip() == key
            and (list_name != 'hot-tunes' or TUNE_PATH.fullmatch(key) is not None))


def check(lists, base):
    """Raise ValueError unless `lists` is a valid curated-lists.json."""
    if not isinstance(lists, dict) or set(lists) != {'v', 'composers', 'groups', 'hotTunes'} or lists['v'] != 1:
        raise ValueError('Unexpected keys or version')
    hot = lists['hotTunes']
    if not isinstance(hot, dict) or set(hot) != {'add', 'remove'}:
        raise ValueError('hotTunes must have only add and remove')
    for name, list_name, items in (('composers', 'composers', lists['composers']), ('groups', 'groups', lists['groups']),
                                   ('hotTunes.add', 'hot-tunes', hot['add']), ('hotTunes.remove', 'hot-tunes', hot['remove'])):
        if not isinstance(items, list) or not all(valid_key(list_name, k) for k in items):
            raise ValueError(f'Invalid item in {name}')
        if items != sorted(set(items)):
            raise ValueError(f'{name} must be sorted, with no duplicates')
    if set(hot['add']) & base:
        raise ValueError('hotTunes.add has a tune that is already in js/hot-tunes.js')
    if set(hot['remove']) - base:
        raise ValueError('hotTunes.remove has a tune that is not in js/hot-tunes.js')


def item(doc):
    """(list, key, hidden) from a curatedLists/<list>/items/<id> document."""
    parts = doc['name'].split('/')
    if len(parts) < 4 or parts[-4] != 'curatedLists' or parts[-2] != 'items' or parts[-3] not in LISTS:
        raise ValueError('Unexpected document path')
    list_name, doc_id = parts[-3], parts[-1]
    fields = doc.get('fields', {})
    if set(fields) != {'key', 'hidden', 'by', 'at'}:
        raise ValueError('Unexpected item fields')
    key = fields['key'].get('stringValue')
    hidden = fields['hidden'].get('booleanValue')
    if not CURATOR_ID.fullmatch(fields['by'].get('stringValue') or ''):
        raise ValueError('Invalid creator')
    datetime.fromisoformat(fields['at'].get('timestampValue', '').replace('Z', '+00:00'))
    if not valid_key(list_name, key) or not isinstance(hidden, bool):
        raise ValueError('Invalid item key or hidden flag')
    if hashlib.sha256(key.encode()).hexdigest() != doc_id:
        raise ValueError('Item ID must be sha256(key)')
    return list_name, key, hidden


def merge(lists, documents, base):
    """Apply the admin items (additions and removals) to the published lists."""
    result = copy.deepcopy(lists)
    composers, groups = set(result['composers']), set(result['groups'])
    add, remove = set(result['hotTunes']['add']), set(result['hotTunes']['remove'])
    for doc in documents:
        list_name, key, hidden = item(doc)
        if list_name == 'hot-tunes':
            # A tune in the generated list is taken out with `remove`; any
            # other tune is put in with `add`.
            if hidden:
                add.discard(key)
                if key in base:
                    remove.add(key)
            else:
                remove.discard(key)
                if key not in base:
                    add.add(key)
        else:
            target = composers if list_name == 'composers' else groups
            (target.discard if hidden else target.add)(key)
    result.update(composers=sorted(composers), groups=sorted(groups), hotTunes={'add': sorted(add), 'remove': sorted(remove)})
    return result


def check_changes(before, after, base):
    """The new file must be valid, with the same version as before."""
    check(after, base)
    if before.get('v') != after.get('v'):
        raise ValueError('Version changed')


def write(path, lists):
    path.write_text(json.dumps(lists, ensure_ascii=False, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--lists', default='js/curated-lists.json')
    parser.add_argument('--hot-tunes', default=str(REPO / 'js' / 'hot-tunes.js'))
    parser.add_argument('--project', help='Firebase project (default: the one in js/sync-config.js)')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--check', action='store_true', help='Only check the file')
    group.add_argument('--before', help='Check the file against this older version instead of reading Firestore')
    args = parser.parse_args()
    path = Path(args.lists)
    lists = json.loads(path.read_text())
    base = hot_tunes_base(args.hot_tunes)
    try:
        if args.check:
            check(lists, base)
            return
        if args.before:
            check_changes(json.loads(Path(args.before).read_text()), lists, base)
            return
        from firestore_admin import Firestore
        db = Firestore(args.project)
        documents = [doc for name in LISTS for doc in db.list(f'curatedLists/{name}/items')]
        after = merge(lists, documents, base)
        check_changes(lists, after, base)
    except ValueError as err:
        raise SystemExit(f'{path}: {err}')
    if after != lists:
        write(path, after)


if __name__ == '__main__':
    main()

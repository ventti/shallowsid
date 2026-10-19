#!/usr/bin/env python3
"""Publish Firestore tag definitions (additions and edits) into the vocabulary."""
import argparse
import copy
import json
import re
from datetime import datetime
from pathlib import Path
from build_rules import accepted_ids, TAG_ID
from firestore_admin import Firestore, value

GROUPS = ('Style', 'Mood', 'Use', 'Sound')


def merge(vocab, documents):
    result = copy.deepcopy(vocab)
    accepted_ids(result)
    groups = {g['name']: g for g in result['groups']}
    if set(groups) != set(GROUPS) or len(groups) != len(result['groups']):
        raise ValueError('Unexpected vocabulary categories')
    existing = {t['id']: (g['name'], t) for g in result['groups'] for t in g['tags']}
    seen = set()
    for doc in documents:
        tag_id = doc['name'].rsplit('/', 1)[-1]
        fields = doc.get('fields', {})
        if set(fields) != {'label', 'group', 'description', 'by', 'at'}:
            raise ValueError('Unexpected definition fields')
        if not re.fullmatch(r'[0-9a-f]{64}', value(fields['by']) or ''):
            raise ValueError('Invalid creator')
        datetime.fromisoformat(fields['at'].get('timestampValue', '').replace('Z', '+00:00'))
        d = {k: value(fields[k]) for k in ('label', 'group', 'description')}
        if not TAG_ID.fullmatch(tag_id) or tag_id in seen or d['group'] not in GROUPS:
            raise ValueError('Invalid or duplicate definition ID/category')
        seen.add(tag_id)
        for key, minimum, maximum in (('label', 1, 80), ('description', 0, 500)):
            if not isinstance(d[key], str) or not minimum <= len(d[key]) <= maximum or d[key].strip() != d[key]:
                raise ValueError('Invalid definition text')
        # An empty description is left out, as in the rest of the vocabulary.
        tag = {'id': tag_id, 'label': d['label'], **({'description': d['description']} if d['description'] else {})}
        if tag_id in result.get('retired', []):
            raise ValueError('Retired ID cannot be reused')
        if tag_id in existing:
            group, old = existing[tag_id]
            if (group, old) == (d['group'], tag):
                continue
            # An edit: the ID stays, the name, description and category change.
            groups[group]['tags'].remove(old)
        groups[d['group']]['tags'].append(tag)
    for group in result['groups']:
        group['tags'].sort(key=lambda tag: (tag['label'].casefold(), tag['id']))
    return result


def check_changes(before, after):
    """Allow additions and edits. Reject removals, retired changes, and unexpected metadata."""
    accepted_ids(before)
    accepted_ids(after)
    if {k: v for k, v in before.items() if k != 'groups'} != {k: v for k, v in after.items() if k != 'groups'}:
        raise ValueError('Vocabulary metadata changed')
    if [g['name'] for g in before['groups']] != [g['name'] for g in after['groups']]:
        raise ValueError('Categories changed')
    old_tags = {(g['name'], t['id']): t for g in before['groups'] for t in g['tags']}
    for old, new in zip(before['groups'], after['groups']):
        if new['tags'] != sorted(new['tags'], key=lambda t: (t['label'].casefold(), t['id'])):
            raise ValueError('Tags must be alphabetical')
        if {k: v for k, v in old.items() if k != 'tags'} != {k: v for k, v in new.items() if k != 'tags'}:
            raise ValueError('Category metadata changed')
        for tag in new['tags']:
            if old_tags.get((new['name'], tag['id'])) != tag:
                if set(tag) not in ({'id', 'label'}, {'id', 'label', 'description'}) or not all(isinstance(tag[k], str) and tag[k].strip() and len(tag[k]) <= n for k,n in [('label',80),('description',500)] if k in tag):
                    raise ValueError('Invalid new or edited tag')
    after_ids = {t['id'] for g in after['groups'] for t in g['tags']}
    if any(i not in after_ids for _, i in old_tags):
        raise ValueError('Existing tags removed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vocab', default='js/tags-vocab.json')
    parser.add_argument('--before', help='Check additions against this JSON instead of reading Firestore')
    args = parser.parse_args()
    path = Path(args.vocab)
    before = json.loads(path.read_text())
    if args.before:
        check_changes(json.loads(Path(args.before).read_text()), before)
        return
    after = merge(before, Firestore().list('tagDefinitions'))
    check_changes(before, after)
    if after != before:
        path.write_text(json.dumps(after, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()

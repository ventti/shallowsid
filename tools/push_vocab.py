#!/usr/bin/env python3
"""Copy the tag ids from js/tags-vocab.json to Firestore's config/vocab.

firestore.rules accept only ids listed there. Run it after changing the
vocabulary, before deploying the app that shows the new tags. Removing a tag
here doesn't untag tunes; the app just stops showing it.

Usage:
  tools/push_vocab.py [--project ID]
"""

import argparse
import json
import re

from firestore_admin import REPO, Firestore, s

TAG_ID = re.compile(r"^[a-z0-9-]{1,24}$")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", help="Firebase project (default: from js/sync-config.js)")
    args = parser.parse_args()
    vocab = json.loads((REPO / "js" / "tags-vocab.json").read_text())
    ids = [t["id"] for g in vocab["groups"] for t in g["tags"]]
    bad = [i for i in ids if not TAG_ID.match(i)]
    if bad or len(set(ids)) != len(ids):
        raise SystemExit(f"Bad or repeated tag ids: {bad or 'duplicates'}")
    Firestore(args.project).patch("config", "vocab", {"ids": {"arrayValue": {"values": [s(i) for i in ids]}}})
    print(f"config/vocab: {len(ids)} tags")


if __name__ == "__main__":
    main()

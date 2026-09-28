#!/usr/bin/env python3
"""Export every tune tag from Firestore into <out>/data/tags-index.json.

The app reads this file for tag pages and search, so browsing tags costs no
database reads. Format: {"v": 1, "tunes": {path: {song: [tag ids]}}}, song 0
being the whole tune. Tags cleared by curators are left out.

Usage:
  tools/export_tags.py --out _site [--project ID]
"""

import argparse
import json
from pathlib import Path

from firestore_admin import Firestore, value


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=".", help="site folder (default: .)")
    parser.add_argument("--project", help="Firebase project (default: from js/sync-config.js)")
    args = parser.parse_args()
    tunes = {}
    for doc in Firestore(args.project).list("tags"):
        f = doc.get("fields", {})
        path, song, tags = value(f.get("p")), value(f.get("s")), value(f.get("t")) or []
        if isinstance(path, str) and isinstance(song, int) and tags:
            tunes.setdefault(path, {})[str(song)] = tags
    out = Path(args.out) / "data" / "tags-index.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"v": 1, "tunes": tunes}, separators=(",", ":"), sort_keys=True))
    print(f"{out}: {sum(len(v) for v in tunes.values())} tagged tunes and subtunes")


if __name__ == "__main__":
    main()

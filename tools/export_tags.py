#!/usr/bin/env python3
"""Export every tune tag and BPM from Firestore into <out>/data/tags-index.json.

The app reads this file for tag pages, search and Now Playing, so browsing
costs no database reads. Format:
{"v": 1, "tunes": {path: {song: [tag ids]}}, "bpm": {path: {song: bpm}}},
song 0 being the whole tune. Tags and BPMs cleared by curators are left out.

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
    tunes, bpm = {}, {}
    for doc in Firestore(args.project).list("tags"):
        f = doc.get("fields", {})
        path, song, tags, b = value(f.get("p")), value(f.get("s")), value(f.get("t")) or [], value(f.get("b"))
        if not (isinstance(path, str) and isinstance(song, int)):
            continue
        if tags:
            tunes.setdefault(path, {})[str(song)] = tags
        if isinstance(b, int):
            bpm.setdefault(path, {})[str(song)] = b
    out = Path(args.out) / "data" / "tags-index.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"v": 1, "tunes": tunes, "bpm": bpm}, separators=(",", ":"), sort_keys=True))
    print(f"{out}: {sum(len(v) for v in tunes.values())} tagged tunes and subtunes, {sum(len(v) for v in bpm.values())} with a BPM")


if __name__ == "__main__":
    main()

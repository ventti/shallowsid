#!/usr/bin/env python3
"""Match a CSDb-style top list ("Title by Group<TAB>score...") to HVSC songs
from data/index.json and write an .m3u8 playlist.

Usage:
  python3 tools/top_to_m3u8.py top1000.txt -o top1000.m3u8
  python3 tools/top_to_m3u8.py top1000.txt --base https://hvsc.c64.org/download/C64Music/
  python3 tools/top_to_m3u8.py top1000.txt --js js/hot-tunes.js   # also feed the Hot tunes mix
"""

import argparse
import difflib
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FUZZY_CUTOFF = 0.85        # first-pass fuzzy threshold
LOOSE_CUTOFF = 0.6         # second pass, group confirmation always required


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", s.lower())
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


def parse_line(line):
    fields = [f.strip() for f in line.split("\t")]
    if fields[0].isdigit():  # optional leading rank column
        fields = fields[1:]
    head = fields[0]
    if " by " not in head:
        return head, []
    title, groups = head.rsplit(" by ", 1)
    return title, [norm(g) for g in groups.split(",") if norm(g)]


def load_index(path):
    idx = json.loads(path.read_text())
    by_title = {}
    for f in idx["files"]:
        dir_i, name, title, author_i, released = f[0], f[1], f[2], f[3], f[4]
        start, lengths = f[6], f[8]
        entry = {
            "path": f"{idx['dirs'][dir_i]}/{name}",
            "title": title,
            "author": idx["authors"][author_i],
            "context": norm(f"{released} {idx['authors'][author_i]}"),
            "seconds": lengths[start - 1] if lengths and start <= len(lengths) else -1,
        }
        by_title.setdefault(norm(title), []).append(entry)
    return by_title


def pick(candidates, groups):
    def score(c):
        return sum(g in c["context"] for g in groups)
    return max(candidates, key=score)


NOISE = {"cover", "remix", "remake", "tribute", "soundtrack", "ost", "edit", "version",
         "theme", "tune", "music", "mix", "the", "a", "of", "and"}


def variants(key):
    """Title plus looser forms: without "Artist - " prefix / " - Mix" suffix and noise words."""
    out = {key}
    parts = [p.strip() for p in re.split(r"\s+-\s+", key) if p.strip()]
    out.update(parts)
    for v in list(out):
        core = " ".join(w for w in v.split()
                        if w not in NOISE and not re.fullmatch(r"(19|20)\d\d|\dk\d\d", w))
        if core:
            out.add(core)
    return {norm(v) for v in out if norm(v)}


def significant(s):
    return {w for w in s.split() if w not in NOISE and len(w) > 2}


def match(title, groups, by_title, titles):
    key = norm(title)
    if key in by_title:
        return pick(by_title[key], groups)
    raw_parts = re.split(r"\s+-\s+", title)
    keys = variants(" - ".join(norm(p) for p in raw_parts))
    for k in sorted(keys, key=len, reverse=True):  # most specific first
        if k in by_title:
            hits = [c for c in by_title[k] if any(g in c["context"] for g in groups)]
            if hits:
                return pick(hits, groups)
    close = set()
    for k in keys:
        close.update(difflib.get_close_matches(k, titles, n=20, cutoff=LOOSE_CUTOFF))
        words = set(k.split())
        close.update(t for t in titles if len(t) > 3 and
                     (set(t.split()) <= words or words <= set(t.split())))
    sig = significant(key)
    # Fuzzy matches need a group confirmation and at least one shared significant word.
    confirmed = [c for t in close for c in by_title[t]
                 if any(g in c["context"] for g in groups)
                 and (not sig or sig & significant(norm(c["title"])) or
                      difflib.SequenceMatcher(None, key, norm(c["title"])).ratio() > 0.85)]
    if not confirmed:
        return None
    return max(confirmed, key=lambda c: (sum(g in c["context"] for g in groups),
                                          max(difflib.SequenceMatcher(None, k, norm(c["title"])).ratio()
                                              for k in keys)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("toplist", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=None)
    ap.add_argument("--index", type=Path, default=ROOT / "data" / "index.json")
    ap.add_argument("--base", default=None,
                    help="URL/path prefix for entries (default: relative path to ./hvsc)")
    ap.add_argument("--js", type=Path, default=None,
                    help="also write the matched HVSC paths as a JS module (for the Hot tunes mix)")
    args = ap.parse_args()

    out = args.out or args.toplist.with_suffix(".m3u8")
    base = args.base or os.path.relpath(ROOT / "hvsc", out.resolve().parent) + "/"
    by_title = load_index(args.index)
    titles = list(by_title)

    lines, misses, paths = ["#EXTM3U"], [], []
    for raw in args.toplist.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        title, groups = parse_line(raw)
        m = match(title, groups, by_title, titles)
        if not m:
            misses.append(f"{title} by {', '.join(groups)}")
            continue
        lines.append(f"#EXTINF:{m['seconds']},{m['author']} - {m['title']}")
        lines.append(base + m["path"])
        paths.append(m["path"])

    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if args.js:
        body = ",\n".join(f"  {json.dumps(p, ensure_ascii=False)}" for p in dict.fromkeys(paths))
        args.js.write_text(f"// Generated by tools/top_to_m3u8.py from {args.toplist.name}; do not edit.\n"
                           f"export const HOT_TUNES = new Set([\n{body},\n]);\n", encoding="utf-8")
    total = len(lines) // 2 + len(misses)
    print(f"{out}: matched {total - len(misses)}/{total}", file=sys.stderr)
    for miss in misses:
        print(f"  unmatched: {miss}", file=sys.stderr)


if __name__ == "__main__":
    main()

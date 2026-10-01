#!/usr/bin/env python3
"""Pick out the BPM estimates a human should check, and score estimates against human ones.

  review.py todo bpm.jsonl -o review          # review.m3u8 + review.txt
  review.py compare bpm.jsonl human.txt       # how close the estimates are

`todo` takes every subtune whose status isn't "ok", "short" or "silent" (see bpm.py):
the two estimators disagree, confidence is low, or rendering failed.
review.m3u8 imports into the app as a playlist; each entry names both guesses.
review.txt is the worksheet: one "path:song bpm" line per subtune, prefilled
with the main estimate. Fix the numbers you hear differently and keep the file.

`compare` reads the same "path:song bpm" lines (paths relative to the HVSC
root, or absolute) and reports each estimate as exact, x2, /2 or wrong.
"""
import argparse, json, re, sys
from pathlib import Path

TOLERANCE = 0.04    # within 4 % of the human BPM counts as a match
RATIOS = ((1, "exact"), (2, "x2"), (0.5, "/2"), (1.5, "x3/2"), (2 / 3, "x2/3"))


def hvsc_path(path):
    """A path relative to the HVSC root: MUSICIANS/..., GAMES/... or DEMOS/..."""
    m = re.search(r"(?:^|/)((?:MUSICIANS|GAMES|DEMOS)/.+)$", path)
    return m.group(1) if m else path


def load_rows(jsonl):
    rows = {}
    for line in open(jsonl):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        rows[(hvsc_path(r["path"]), r["song"])] = r
    return rows


def load_human(path):
    human = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"(.*?\.sid)(?::(\d+))?\s+(\d+(?:\.\d+)?)", line, re.I)
        if not m:
            sys.exit(f"{path}: can't read {line!r}")
        human[(hvsc_path(m.group(1)), int(m.group(2) or 1))] = float(m.group(3))
    return human


def todo(a):
    rows = load_rows(a.jsonl)
    picked = sorted((k, r) for k, r in rows.items() if r.get("status") not in ("ok", "silent", "short"))
    m3u = ["#EXTM3U", "#PLAYLIST:BPM review"]
    sheet = ["# path:song bpm   (prefilled with the main estimate; the percival guess is in the comment)"]
    for (path, song), r in picked:
        guess = f"{r['bpm']} or {r['percival']}" if "bpm" in r else "error"
        label = f"{Path(path).stem.replace('_', ' ')} #{song}: {r.get('status', 'error')} {guess}"
        m3u += [f"#EXTINF:-1,{label}", f"#EXTSID:subtune={song}", f"hvsc/{path}"]
        sheet.append(f"{path}:{song} {r.get('bpm', '?')}   # {r.get('status', 'error')}, percival {r.get('percival', '?')}")
    Path(a.out + ".m3u8").write_text("\n".join(m3u) + "\n")
    Path(a.out + ".txt").write_text("\n".join(sheet) + "\n")
    counts = {}
    for r in rows.values():
        counts[r.get("status", "error")] = counts.get(r.get("status", "error"), 0) + 1
    print(f"{len(picked)} of {len(rows)} subtunes to review ({counts}): {a.out}.m3u8, {a.out}.txt")


def verdict(estimate, human):
    for k, name in RATIOS:
        if abs(estimate - human * k) <= human * k * TOLERANCE:
            return name
    return "wrong"


def compare(a):
    rows, human = load_rows(a.jsonl), load_human(a.human)
    tally = {}
    print(f"{'tune':44}{'human':>7}{'bpm':>6}{'perc':>6}{'conf':>6}  {'status':8}bpm / percival")
    for key, h in human.items():
        r = rows.get(key)
        if not r or "bpm" not in r:
            print(f"{key[0]}:{key[1]}  no estimate")
            continue
        v, vp = verdict(r["bpm"], h), verdict(r["percival"], h)
        tally[v] = tally.get(v, 0) + 1
        name = f"{Path(key[0]).stem}:{key[1]}"
        print(f"{name:44}{h:7g}{r['bpm']:6}{r['percival']:6}{r['confidence']:6.2f}  {r['status']:8}{v} / {vp}")
    print("bpm:", tally)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("todo"); t.add_argument("jsonl"); t.add_argument("-o", "--out", default="review")
    c = sub.add_parser("compare"); c.add_argument("jsonl"); c.add_argument("human")
    a = ap.parse_args()
    {"todo": todo, "compare": compare}[a.cmd](a)


if __name__ == "__main__":
    main()

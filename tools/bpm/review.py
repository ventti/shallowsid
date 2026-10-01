#!/usr/bin/env python3
"""Turn bpm.py's results into the tempo estimates that ship with the site.

  review.py todo                # tools/bpm/review.txt + review.m3u8: the ones to listen to
  review.py publish             # results + your answers -> tools/bpm/estimates.tsv; commit that
  review.py compare human.txt   # how close the estimates are to "path:song bpm" lines
  review.py compare curators    # ... or to the BPMs curators have set in the app

estimates.tsv holds one "path, song, bpm, source" line per subtune, sorted:
source "auto" is an estimate both estimators agreed on (status ok), "checked"
one you answered in review.txt. bpm 0 means no clear tempo. build_index.py puts
it in the catalogue, so a commit makes it show in the app as "~124 BPM".

Curators' BPMs (and their 0 for "none") always win in the app, so `todo` leaves
out subtunes they've set, read from the site's tags-index.json (--curated for
another copy, --curated none to ignore it). Answers you've checked are never
overwritten by later runs; automatic ones follow the latest results.
"""
import argparse, json, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results.jsonl"
ESTIMATES = HERE / "estimates.tsv"
REVIEW = HERE / "review"                 # .txt and .m3u8
CURATED = "https://ventti.github.io/shallowsid/data/tags-index.json"
TOLERANCE = 0.04    # within 4 % of the human BPM counts as a match
RATIOS = ((1, "exact"), (2, "x2"), (0.5, "/2"), (1.5, "x3/2"), (2 / 3, "x2/3"))
ANSWER = re.compile(r"^(\S+?\.sid):(\d+)\s+(\?|-|\d+)(?:\s|$)", re.I)


def hvsc_path(path):
    """A path relative to the HVSC root: MUSICIANS/..., GAMES/... or DEMOS/..."""
    m = re.search(r"(?:^|/)((?:MUSICIANS|GAMES|DEMOS)/.+)$", path)
    return m.group(1) if m else path


def load_results(path):
    rows = {}
    if not Path(path).exists():
        sys.exit(f"{path}: no results yet; run tools/bpm/bpm.py on a folder first")
    for line in open(path):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        rows[(hvsc_path(r["path"]), r["song"])] = r
    return rows


def load_estimates():
    """{(path, song): (bpm, source)}"""
    out = {}
    if ESTIMATES.exists():
        for line in ESTIMATES.read_text().splitlines():
            if line and not line.startswith("#"):
                path, song, bpm, source = line.split("\t")
                out[(path, int(song))] = (int(bpm), source)
    return out


def save_estimates(estimates):
    lines = ["# path\tsong\tbpm\tsource (auto: from tools/bpm/bpm.py, checked: by ear; bpm 0 = no clear tempo)"]
    lines += [f"{p}\t{s}\t{b}\t{src}" for (p, s), (b, src) in sorted(estimates.items())]
    ESTIMATES.write_text("\n".join(lines) + "\n")


def load_curated(source):
    """{path: {song: bpm}} that curators set (song 0 = whole tune), or {} when skipped."""
    if source == "none":
        return {}
    try:
        if re.match(r"https?://", source):
            with urllib.request.urlopen(source, timeout=30) as res:
                data = json.load(res)
        else:
            data = json.loads(Path(source).read_text())
    except Exception as e:
        print(f"warning: no curator BPMs from {source} ({e}); none are left out", file=sys.stderr)
        return {}
    return {p: {int(s): b for s, b in songs.items()} for p, songs in (data.get("bpm") or {}).items()}


def is_curated(curated, path, song):
    songs = curated.get(path, {})
    return song in songs or 0 in songs


def load_answers(path):
    """{(path, song): bpm} for the lines of a worksheet that have been answered; - is 0."""
    out = {}
    if not Path(path).exists():
        return out
    for line in Path(path).read_text().splitlines():
        m = ANSWER.match(line.strip())
        if m and m.group(3) != "?":
            out[(hvsc_path(m.group(1)), int(m.group(2)))] = 0 if m.group(3) == "-" else int(m.group(3))
    return out


def todo(a):
    rows, estimates, curated = load_results(a.results), load_estimates(), load_curated(a.curated)
    sheet = REVIEW.with_suffix(".txt")
    unpublished = {k: v for k, v in load_answers(sheet).items() if estimates.get(k) != (v, "checked")}
    if unpublished and not a.force:
        sys.exit(f"{sheet} has {len(unpublished)} answers not published yet: run `review.py publish` first (or --force to drop them)")
    skipped = {"curated": 0, "checked": 0}
    picked = []
    for key, r in sorted(rows.items()):
        if r.get("status") in ("ok", "silent", "short"):
            continue
        if is_curated(curated, *key):
            skipped["curated"] += 1
        elif estimates.get(key, (0, ""))[1] == "checked":
            skipped["checked"] += 1
        else:
            picked.append((key, r))
    m3u = ["#EXTM3U", "#PLAYLIST:BPM review"]
    lines = ["# Replace ? with the BPM you hear, or - for no clear tempo. Leave ? to skip.",
             "# Then run tools/bpm/review.py publish and commit tools/bpm/estimates.tsv."]
    for (path, song), r in picked:
        guess = f"{r['bpm']} or {r['percival']}" if "bpm" in r else "no estimate"
        m3u += [f"#EXTINF:-1,{Path(path).stem.replace('_', ' ')} #{song}: {guess}", f"#EXTSID:subtune={song}", f"hvsc/{path}"]
        why = r.get("status") or f"error: {r.get('error', '?')[:60]}"
        lines.append(f"{path}:{song} ?   # {why}: {guess}" + (f", confidence {r['confidence']}" if "confidence" in r else ""))
    REVIEW.with_suffix(".m3u8").write_text("\n".join(m3u) + "\n")
    sheet.write_text("\n".join(lines) + "\n")
    print(f"{len(picked)} subtunes to listen to ({skipped['curated']} set by curators and {skipped['checked']} checked already left out):\n"
          f"  {sheet}\n  {REVIEW.with_suffix('.m3u8')} (import it as a playlist in the app)")


def publish(a):
    rows, estimates = load_results(a.results), load_estimates()
    before = dict(estimates)
    # Automatic estimates follow the latest results; checked ones stay.
    for key, r in rows.items():
        if estimates.get(key, (0, ""))[1] == "checked":
            continue
        if r.get("status") == "ok":
            estimates[key] = (r["bpm"], "auto")
        else:
            estimates.pop(key, None)
    for key, bpm in load_answers(REVIEW.with_suffix(".txt")).items():
        estimates[key] = (bpm, "checked")
    save_estimates(estimates)
    added = sum(k not in before for k in estimates)
    changed = sum(k in before and before[k] != v for k, v in estimates.items())
    removed = sum(k not in estimates for k in before)
    checked = sum(src == "checked" for _, src in estimates.values())
    print(f"{ESTIMATES}: {len(estimates)} subtunes ({checked} checked by ear); {added} new, {changed} changed, {removed} removed.\n"
          "Commit it to show them in the app after the next deploy.")


def verdict(estimate, human):
    for k, name in RATIOS:
        if abs(estimate - human * k) <= human * k * TOLERANCE:
            return name
    return "wrong"


def compare(a):
    rows = load_results(a.results)
    if a.truth == "curators":
        # A curator's whole-tune BPM counts for single-subtune files only.
        truth = {(p, s or 1): b for p, songs in load_curated(a.curated).items() for s, b in songs.items() if b}
    else:
        truth = {}
        for line in Path(a.truth).read_text().splitlines():
            m = re.match(r"(\S+?\.sid)(?::(\d+))?\s+(\d+)", line.strip(), re.I)
            if m and not line.startswith("#"):
                truth[(hvsc_path(m.group(1)), int(m.group(2) or 1))] = int(m.group(3))
    tally = {}
    print(f"{'tune':44}{'human':>7}{'bpm':>6}{'perc':>6}{'conf':>6}  {'status':8}bpm / percival")
    for key, h in sorted(truth.items()):
        r = rows.get(key)
        if not r or "bpm" not in r:
            continue
        v, vp = verdict(r["bpm"], h), verdict(r["percival"], h)
        tally[v] = tally.get(v, 0) + 1
        print(f"{Path(key[0]).stem + ':' + str(key[1]):44}{h:7}{r['bpm']:6}{r['percival']:6}{r['confidence']:6.2f}  {r['status']:8}{v} / {vp}")
    print(f"{sum(tally.values())} compared:", tally)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-r", "--results", default=str(RESULTS), help="bpm.py's results (default: tools/bpm/results.jsonl)")
    ap.add_argument("--curated", default=CURATED, help="tags-index.json with curators' BPMs: URL, file or none (default: the site's)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("todo", help="write the worksheet and playlist of subtunes to listen to")
    t.add_argument("--force", action="store_true", help="overwrite a worksheet with answers not published yet")
    sub.add_parser("publish", help="update estimates.tsv from the results and your answers")
    c = sub.add_parser("compare", help="score the estimates against known BPMs")
    c.add_argument("truth", help='a file of "path:song bpm" lines, or "curators"')
    a = ap.parse_args()
    {"todo": todo, "publish": publish, "compare": compare}[a.cmd](a)


if __name__ == "__main__":
    main()

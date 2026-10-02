#!/usr/bin/env python3
"""Find each SID subtune's play speed and whether it uses filter, ring modulation and sync.

Each worker keeps a trace-server.mjs running, which plays a subtune on
c64lite.mjs, a minimal C64 (6502, CIA timers, raster interrupt; no SID sound),
with every SID register write traced. From the registers it gets:
  speed       play calls per video frame: 1 single speed, 2, 4, ... multispeed
              (counted from the interrupt that plays the tune; 1.2 is a 60 Hz tune on PAL),
              from the median interval, so a stray call doesn't skew it
  timing      blank when in step with the screen (the speed, 1, 2, ..., says it all:
              a raster interrupt, a PSID's play once a frame, main code waiting for a line);
              cia: by a CIA timer, at the rate the tune sets;
              custom: no steady call rate: delay loops in the player, cycle counting
              in main code, or a timer it keeps changing.
              features.tsv and -v show a cia tune's speed only when it's a whole
              multiple of the frame rate (1, 2, 4, ... within 1 %); an odd rate is
              just "cia". custom has no speed. (results.jsonl keeps it, and hz.)
  filter      share of the time some voice goes through the filter, with a mode on
  ring, sync  share of the time some voice has ring modulation (on its triangle)
              or hard sync on
  digi        $D418, or the SID from an NMI, written over 1000 times a second: samples
Every run ends by writing tools/sidfeatures/features.tsv, one line per
subtune, also when stopped with Ctrl-C. The raw results go to results.jsonl,
and subtunes already in it are skipped, so running again resumes; --force
redoes them.

Needs only Node (20 or later); no packages.

Usage:
  tools/sidfeatures/features.py                      # all of HVSC (the repo's hvsc/)
  tools/sidfeatures/features.py MUSICIANS/H/Hubbard_Rob   # or just some folders or .sid files
  tools/sidfeatures/features.py --list tunes.txt     # lines of "path[:song]"
Options: -v  -o OUT.jsonl  --workers N  --seconds 180  --limit N  --force  --index data/index.json

Each subtune is played for its length from the catalogue, at most --seconds.
Row status: ok, digi (sample playback only, so no play speed), check (no
speed found: mostly sound effects too short to time, and the odd tune needing
a cycle-exact C64), silent (no SID writes at all), basic (an RSID tune that's a
BASIC program: c64lite has no BASIC ROM, so it's labelled but not measured).
"""
import argparse, json, os, signal, subprocess, sys, time
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "bpm"))
import bpm   # noqa: E402  the job list, resuming and progress are the same as there

RESULTS = HERE / "results.jsonl"
USED = 0.01     # a feature counts as used when it's on for at least 1 % of the time

_server = None
_opts = None

def _init(opts):
    global _opts
    _opts = opts
    signal.signal(signal.SIGINT, signal.SIG_IGN)   # Ctrl-C is the main process's to handle
    _start_server()

def _start_server():
    global _server
    env = {k: v for k, v in os.environ.items() if k != "NODE_OPTIONS"}
    _server = subprocess.Popen(["node", str(HERE / "trace-server.mjs")], cwd=HERE, env=env,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               start_new_session=True)   # out of reach of Ctrl-C; exits when its stdin closes

def work(job):
    path, song, length = job
    t0 = time.perf_counter()
    row = {"path": bpm.hvsc_path(path), "song": song, "length": length}
    # Songlengths lists the length to the end or the first loop; past that there is nothing new.
    seconds = _opts["seconds"] if length is None else min(_opts["seconds"], length + 1)
    try:
        _server.stdin.write((json.dumps({"path": path, "song": song, "seconds": seconds}) + "\n").encode())
        _server.stdin.flush()
        line = _server.stdout.readline()
        if not line:
            raise EOFError("trace server exited")
        row.update(json.loads(line))
    except (EOFError, BrokenPipeError) as e:
        _start_server()
        row["error"] = f"trace: {e}"
    row["secs"] = round(time.perf_counter() - t0, 2)
    return row

def whole(speed):
    """speed rounded to a whole number of calls a frame, if within 1 % of one; else None."""
    n = round(speed)
    return n if n >= 1 and abs(speed - n) <= 0.01 * n else None

def shown_speed(r):
    """The speed as features.tsv and -v show it: always in step with the screen, only whole
    multiples for a CIA timer, never for custom timing. None when there's none to show."""
    if r.get("status") != "ok" or "speed" not in r or r.get("timing") == "custom":
        return None
    return whole(r["speed"]) if r.get("timing") == "cia" else r["speed"]

def used(r, feature):
    return r.get(feature, 0) >= USED

def describe(r, n, total):
    """One line for --verbose: when, which subtune, its speed and features."""
    when = time.strftime("%Y-%m-%d %H:%M:%S")
    tune = f"{r['path']} #{r['song']}"
    if "error" in r:
        what = f"error   {r['error'][:80]}"
    elif r.get("status") == "basic":
        what = "basic  (a BASIC program; not measured)"
    else:
        speed = "" if shown_speed(r) is None else f"{shown_speed(r)}x"
        flags = [f for f in ("filter", "ring", "sync", "digi") if r.get(f) is True or used(r, f)]
        what = f"{r['status']:6} {speed:6} {r.get('timing', ''):6} {' '.join(flags)}"
    return f"{when}  {n:>{len(str(total))}}/{total}  {tune}  {what}  {r['secs']:.1f}s"

def load_rows(out):
    rows = []
    if os.path.exists(out):
        for line in open(out):
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue    # a line cut short by a stopped run
    return rows

def write_tsv(out):
    """features.tsv, next to the results: one line per subtune with a result, sorted. speed is blank
    when no steady rate was found, for custom timing and for an odd CIA rate (see shown_speed); the
    features are 1 or 0, and blank for
    BASIC tunes (basic 1), which aren't measured."""
    rows = {(r["path"], r["song"]): r for r in load_rows(out) if "error" not in r and r.get("status") != "silent"}
    lines = ["# path\tsong\tspeed\ttiming\tfilter\tring\tsync\tdigi\tbasic (from tools/sidfeatures/features.py; "
             "speed = play calls a frame; timing = cia, custom, or blank: in step with the screen)"]
    for (path, song), r in sorted(rows.items()):
        timing = r.get("timing", "")
        speed = "" if shown_speed(r) is None else shown_speed(r)
        if r["status"] == "basic":
            flags = ["", "", "", "", 1]
        else:
            flags = [int(used(r, f)) for f in ("filter", "ring", "sync")] + [int(r.get("digi", False)), 0]
        lines.append("\t".join(map(str, [path, song, speed, timing, *flags])))
    tsv = Path(out).with_name("features.tsv")
    tsv.write_text("\n".join(lines) + "\n")
    multi = sum(1 for r in rows.values() if (shown_speed(r) or 0) >= 1.5)
    basic = sum(1 for r in rows.values() if r["status"] == "basic")
    timings = {t: sum(1 for r in rows.values() if r.get("timing") == t) for t in ("cia", "custom")}
    print(f"{tsv}: {len(rows)} subtunes, {multi} multispeed, {basic} BASIC; timing {timings}", file=sys.stderr)

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("paths", nargs="*", help="folders (searched with their subfolders) or .sid files (default: all of hvsc/)")
    ap.add_argument("-o", "--out", default=str(RESULTS), help="results, added to on every run (default: tools/sidfeatures/results.jsonl)")
    ap.add_argument("--list", help='a file of "path[:song]" lines instead of paths')
    ap.add_argument("--workers", type=int, default=bpm.cores(), help=f"processes (default: one per core, {bpm.cores()} here)")
    ap.add_argument("--seconds", type=float, default=180, help="most of each subtune to play (default: 180)")
    ap.add_argument("--limit", type=int, help="stop after this many subtunes")
    ap.add_argument("--force", action="store_true", help="redo subtunes already in the results")
    ap.add_argument("-v", "--verbose", action="store_true", help="a line per subtune: time, tune, speed and features")
    ap.add_argument("--index", type=Path, default=bpm.INDEX, help="catalogue with the song lengths")
    a = ap.parse_args()
    if not a.paths and not a.list:
        if not (bpm.REPO / "hvsc").is_dir():
            sys.exit(f"No HVSC in {bpm.REPO / 'hvsc'}. Get it with: tools/fetch_hvsc.py --dest {bpm.REPO / 'hvsc'}")
        a.paths = [str(bpm.REPO / "hvsc")]
    stopped = analyse(a)
    write_tsv(a.out)
    if stopped:
        sys.exit(130)

def analyse(a):
    """Analyse what's not done yet; True if stopped with Ctrl-C."""
    jobs = []
    if a.list:
        for line in Path(a.list).read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            p, _, s = line.split()[0].partition(":")
            p = str(bpm.find(p))
            jobs += [(p, int(s))] if s else bpm.subtunes(p)
    for arg in a.paths:
        p = bpm.find(arg)
        files = sorted(p.rglob("*.sid")) if p.is_dir() else [p]
        jobs += [j for f in files for j in bpm.subtunes(str(f))]
    jobs = list(dict.fromkeys(jobs))    # a file given twice, or inside a folder also given

    # A subtune counts as done once it has a row without an error; errors are retried.
    rows = load_rows(a.out)
    done = {(r["path"], r["song"]) for r in rows if "error" not in r}
    lengths = bpm.load_lengths(a.index)
    jobs = [(p, s, lengths.get((bpm.hvsc_path(p), s))) for p, s in jobs if a.force or (bpm.hvsc_path(p), s) not in done]
    if a.limit is not None:
        jobs = jobs[:a.limit]
    print(f"{len(jobs)} subtunes to do, {len(done)} already done, {a.workers} workers -> {a.out}", file=sys.stderr)

    # Drop the old rows of what's about to be redone, so each subtune keeps one row.
    redo = {(bpm.hvsc_path(p), s) for p, s, _ in jobs}
    if any((r["path"], r["song"]) in redo for r in rows):
        bpm.rewrite(a.out, [r for r in rows if (r["path"], r["song"]) not in redo])

    t0, n = time.perf_counter(), 0
    progress = bpm.Progress(len(jobs), t0)
    signal.signal(signal.SIGTERM, bpm._stop)
    pool = Pool(a.workers, initializer=_init, initargs=({"seconds": a.seconds},))
    try:
        with open(a.out, "a") as f:
            for r in pool.imap_unordered(work, jobs, chunksize=2):
                n += 1
                f.write(json.dumps(r) + "\n")
                f.flush()
                if a.verbose:
                    progress.clear()
                    print(describe(r, n, len(jobs)), file=sys.stderr, flush=True)
                progress.show(n)
    except KeyboardInterrupt:
        pool.terminate(); pool.join()
        progress.clear()
        print(f"stopped after {bpm.clock(time.perf_counter() - t0)}: {n} subtunes done this run. "
              "Run the same command to continue.", file=sys.stderr)
        return True
    pool.close(); pool.join()
    progress.clear()
    print(f"done: {n} subtunes in {bpm.clock(time.perf_counter() - t0)}", file=sys.stderr)
    return False

if __name__ == "__main__":
    main()

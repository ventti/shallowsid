#!/usr/bin/env python3
"""Estimate the BPM of every subtune of SID files, one process per core.

Work is split per subtune. Each worker keeps a render-server.mjs (SIDLite)
running, renders a window of each subtune straight into memory and runs
essentia on it. Results append to a JSONL file, and subtunes already in it are
skipped, so a stopped run (Ctrl-C) resumes; --force redoes them.

Setup (once, in tools/bpm):
  npm install
  uv venv -p 3.12 .venv && VIRTUAL_ENV=.venv uv pip install -r requirements.txt

Usage (it runs itself with tools/bpm/.venv when that's set up):
  tools/bpm/bpm.py FOLDER...               # every .sid under each folder, subfolders too
  tools/bpm/bpm.py hvsc/MUSICIANS/H/Hubbard_Rob Commando.sid
  tools/bpm/bpm.py MUSICIANS/H/Hubbard_Rob # paths not found here are tried under hvsc/
  tools/bpm/bpm.py --list tunes.txt        # lines of "path[:song] [bpm]"
Results go to tools/bpm/results.jsonl (-o to change it), so runs on different
folders, from anywhere, add up and none is done twice. review.py then turns
them into tools/bpm/estimates.tsv, which ships with the site.
Progress shows as done/total, time elapsed and left; --verbose adds a line
per subtune.
Options: -v  -o OUT.jsonl  --workers N  --seconds 70  --skip 10  --limit N  --force  --index data/index.json

Subtunes under 30 s by the catalogue's song lengths are marked "short" and
not rendered. Each row's status: ok (both estimators agree, confidently),
double (one is double the other), check (anything else), short, silent.
tools/bpm/review.py picks out the ones for a human to check.
"""
import argparse, json, os, re, signal, struct, subprocess, sys, time
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
VENV_PYTHON = HERE / ".venv" / "bin" / "python"
RESULTS = HERE / "results.jsonl"
RATE = 44100            # essentia's rhythm extractors assume 44.1 kHz
SILENT_RMS = 0.002      # a window quieter than this has no tune to measure
MIN_CONFIDENCE = 1.0    # essentia: below 1 its beat tracking is poor (the scale tops out at 5.32)
BPM_RANGE = (40, 250)   # outside this it has locked onto effects or noise, not a beat
AGREE = 0.04            # the two estimators agree when within 4 % of each other
MIN_SECONDS = 30        # shorter subtunes are effects, jingles and snippets, not worth a tempo
INDEX = REPO / "data" / "index.json"   # song lengths, from tools/build_index.py

_server = None
_opts = None

def _init(opts):
    global _server, _opts
    _opts = opts
    signal.signal(signal.SIGINT, signal.SIG_IGN)   # Ctrl-C is the main process's to handle
    import essentia
    essentia.log.warningActive = False
    essentia.log.infoActive = False
    _start_server()

def _start_server():
    global _server
    env = {k: v for k, v in os.environ.items() if k != "NODE_OPTIONS"}
    _server = subprocess.Popen(["node", str(HERE / "render-server.mjs")], cwd=HERE, env=env,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               start_new_session=True)   # out of reach of Ctrl-C; exits when its stdin closes

def _read_exact(n):
    buf = _server.stdout.read(n)
    if len(buf) != n:
        raise EOFError("render server exited")
    return buf

def _estimate(pcm, skip):
    import numpy as np
    import essentia.standard as es
    audio = pcm.astype(np.float32) / 32768.0
    body = audio[int(skip * RATE):]
    # Short tunes may have ended before the skip; measure from the start then.
    if len(body) < 5 * RATE or np.sqrt(np.mean(body ** 2)) < SILENT_RMS:
        body = audio
    rms = float(np.sqrt(np.mean(body ** 2)))
    if rms < SILENT_RMS:
        return {"status": "silent", "rms": round(rms, 5)}
    bpm, beats, conf, _, _ = es.RhythmExtractor2013(method="multifeature")(body)
    percival = es.PercivalBpmEstimator(sampleRate=RATE)(body)
    return {"bpm": round(float(bpm)), "status": status(bpm, conf, percival), "confidence": round(float(conf), 3),
            "percival": round(float(percival)), "beats": len(beats), "rms": round(rms, 5)}

def status(bpm, conf, percival):
    """ok: both estimators agree, confidently. double: one is double the other,
    so a human picks. check: anything else worth a listen."""
    if not BPM_RANGE[0] <= bpm <= BPM_RANGE[1] or percival <= 0:
        return "check"
    ratio = bpm / percival
    if abs(ratio - 1) <= AGREE:
        return "ok" if conf >= MIN_CONFIDENCE else "check"
    if abs(ratio / 2 - 1) <= AGREE or abs(ratio * 2 - 1) <= AGREE:
        return "double"
    return "check"

def work(job):
    path, song, length = job
    import numpy as np
    t0 = time.perf_counter()
    row = {"path": path, "song": song, "length": length}
    if length is not None and length < MIN_SECONDS:
        row.update(status="short", secs=0.0)
        return row
    try:
        # Songlengths lists the length to the end or the first loop; past that there is nothing new.
        seconds = _opts["seconds"] if length is None else min(_opts["seconds"], length + 1)
        req = {"path": path, "song": song, "seconds": seconds, "sampleRate": RATE}
        _server.stdin.write((json.dumps(req) + "\n").encode()); _server.stdin.flush()
        (n,) = struct.unpack("<I", _read_exact(4))
        head = json.loads(_read_exact(n))
        if "error" in head:
            row["error"] = head["error"]
        else:
            pcm = np.frombuffer(_read_exact(head["samples"] * 2), dtype="<i2")
            try:
                row.update(_estimate(pcm, _opts["skip"]))
            except Exception as e:
                row["error"] = f"essentia: {e}"
    except (EOFError, BrokenPipeError) as e:
        _start_server()
        row["error"] = f"render: {e}"
    row["secs"] = round(time.perf_counter() - t0, 2)
    return row

def subtunes(path):
    """Every subtune of a file, from the song count in its PSID/RSID header."""
    head = Path(path).read_bytes()[:16]
    return [(path, s) for s in range(1, max(1, int.from_bytes(head[14:16], "big")) + 1)]

def _stop(signum, frame):
    raise KeyboardInterrupt   # a kill stops as cleanly as Ctrl-C

def load_lengths(index):
    """{(path relative to the HVSC root, song): seconds} from the app's catalogue, if it's built."""
    if not index.exists():
        print(f"no {index}: every subtune is rendered in full, short ones too", file=sys.stderr)
        return {}
    d = json.loads(index.read_text())
    col = {name: i for i, name in enumerate(d["fields"])}
    out = {}
    for f in d["files"]:
        rel = f"{d['dirs'][f[col['dir']]]}/{f[col['name']]}"
        for song, seconds in enumerate(f[col["lengths"]], 1):
            out[(rel, song)] = seconds
    return out

def hvsc_path(path):
    m = re.search(r"(?:^|/)((?:MUSICIANS|GAMES|DEMOS)/.+)$", path)
    return m.group(1) if m else path

def use_venv():
    """Run again with tools/bpm/.venv's Python if this one hasn't got essentia."""
    try:
        import essentia  # noqa: F401
        return
    except ImportError:
        pass
    if VENV_PYTHON.exists() and Path(sys.executable).resolve() != VENV_PYTHON.resolve():
        os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), __file__, *sys.argv[1:]])
    sys.exit(f"essentia isn't installed. Set up once, in {HERE}:\n"
             "  uv venv -p 3.12 .venv && VIRTUAL_ENV=.venv uv pip install -r requirements.txt")

def find(arg):
    """A path as given, or else under the repo's hvsc/ (so MUSICIANS/... works from anywhere)."""
    p = Path(arg)
    if not p.exists() and (REPO / "hvsc" / arg).exists():
        p = REPO / "hvsc" / arg
    if not p.exists():
        sys.exit(f"{arg}: no such file or folder")
    return p.resolve()

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("paths", nargs="*", help="folders (searched with their subfolders) or .sid files")
    ap.add_argument("-o", "--out", default=str(RESULTS), help="results, added to on every run (default: tools/bpm/results.jsonl)")
    ap.add_argument("--list", help='a file of "path[:song] [bpm]" lines instead of paths')
    ap.add_argument("--workers", type=int, default=os.cpu_count(), help="processes (default: one per core)")
    ap.add_argument("--seconds", type=float, default=70, help="how much of each subtune to render (default: 70)")
    ap.add_argument("--skip", type=float, default=10, help="seconds of intro left out of the estimate (default: 10)")
    ap.add_argument("--limit", type=int, help="stop after this many subtunes")
    ap.add_argument("--force", action="store_true", help="redo subtunes already in the results")
    ap.add_argument("-v", "--verbose", action="store_true", help="a line per subtune: time, tune, status and BPM")
    ap.add_argument("--index", type=Path, default=INDEX, help="catalogue with the song lengths")
    a = ap.parse_args()
    if not a.paths and not a.list:
        ap.error("give a folder, a .sid file or --list")
    if not (HERE / "node_modules" / "libsidplayfp-wasm").exists():
        sys.exit(f"The renderer isn't installed: run npm install in {HERE}")
    use_venv()

    jobs = []
    if a.list:
        for line in Path(a.list).read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # Anything after the path, such as a known BPM to compare with, is ignored.
            p, s = re.match(r"(.*?\.sid)(?::(\d+))?(?:\s.*)?$", line, re.I).groups()
            p = str(find(p))
            jobs += [(p, int(s))] if s else subtunes(p)
    for arg in a.paths:
        p = find(arg)
        files = sorted(p.rglob("*.sid")) if p.is_dir() else [p]
        jobs += [j for f in files for j in subtunes(str(f))]
    jobs = list(dict.fromkeys(jobs))    # a file given twice, or inside a folder also given

    # A subtune counts as done once it has a row without an error; errors are retried.
    rows = []
    if os.path.exists(a.out):
        for line in open(a.out):
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue    # a line cut short by a stopped run
    done = {(r["path"], r["song"]) for r in rows if "error" not in r}
    lengths = load_lengths(a.index)
    jobs = [(p, s, lengths.get((hvsc_path(p), s))) for p, s in jobs if a.force or (p, s) not in done]
    if a.limit:
        jobs = jobs[:a.limit]
    print(f"{len(jobs)} subtunes to do, {len(done)} already done, {a.workers} workers -> {a.out}", file=sys.stderr)

    # Drop the old rows of what's about to be redone, so each subtune keeps one row.
    redo = {(p, s) for p, s, _ in jobs}
    if any((r["path"], r["song"]) in redo for r in rows):
        tmp = a.out + ".tmp"
        with open(tmp, "w") as f:
            f.writelines(json.dumps(r) + "\n" for r in rows if (r["path"], r["song"]) not in redo)
        os.replace(tmp, a.out)

    opts = {"seconds": a.seconds, "skip": a.skip}
    t0, n = time.perf_counter(), 0
    progress = Progress(len(jobs), t0)
    signal.signal(signal.SIGTERM, _stop)
    pool = Pool(a.workers, initializer=_init, initargs=(opts,))
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
        print(f"stopped after {clock(time.perf_counter() - t0)}: {n} subtunes saved to {a.out} this run. "
              "Run the same command to continue.", file=sys.stderr)
        sys.exit(130)
    pool.close(); pool.join()
    progress.clear()
    print(f"done: {n} subtunes in {clock(time.perf_counter() - t0)}", file=sys.stderr)

def clock(seconds):
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02}:{s:02}" if h else f"{m}:{s:02}"

def describe(r, n, total):
    """One line for --verbose: when, which subtune, its status and BPM."""
    when = time.strftime("%Y-%m-%d %H:%M:%S")
    tune = f"{hvsc_path(r['path'])} #{r['song']}"
    if "error" in r:
        what = f"error   {r['error'][:80]}"
    elif "bpm" in r:
        what = f"{r['status']:7} {r['bpm']:3} BPM (percival {r['percival']}, confidence {r['confidence']:.2f})"
    elif r.get("status") == "short":
        what = f"short   {r.get('length')} s"
    else:
        what = r.get("status", "?")
    return f"{when}  {n:>{len(str(total))}}/{total}  {tune}  {what}  {r['secs']:.1f}s"

class Progress:
    """done/total, elapsed and left: kept on one line in a terminal, a line every
    30 s (and at 25/50/75 %) when the output goes to a file."""

    def __init__(self, total, t0):
        self.total, self.t0 = total, t0
        self.tty = sys.stderr.isatty()
        self.last = t0
        self.quarter = 0
        self.shown = False

    def line(self, n):
        elapsed = time.perf_counter() - self.t0
        left = elapsed / n * (self.total - n) if n else 0
        pct = 100 * n / self.total if self.total else 100
        return f"{n}/{self.total} ({pct:.0f}%)  {clock(elapsed)} elapsed, ~{clock(left)} left"

    def show(self, n):
        now = time.perf_counter()
        if self.tty:
            if now - self.last >= 0.2 or n == self.total:
                print("\r\033[K" + self.line(n), end="", file=sys.stderr, flush=True)
                self.last, self.shown = now, True
            return
        quarter = 4 * n // self.total if self.total else 4
        if now - self.last >= 30 or quarter > self.quarter:
            print(self.line(n), file=sys.stderr, flush=True)
            self.last, self.quarter = now, quarter

    def clear(self):
        """Wipe the terminal line before other output."""
        if self.tty and self.shown:
            print("\r\033[K", end="", file=sys.stderr, flush=True)
            self.shown = False

if __name__ == "__main__":
    main()

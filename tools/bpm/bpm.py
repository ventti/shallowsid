"""Estimate the BPM of every subtune of SID files, one process per core.

Work is split per subtune. Each worker keeps a render-server.mjs (SIDLite)
running, renders a window of each subtune straight into memory and runs
essentia on it. Results append to a JSONL file, and subtunes already in it are
skipped, so a stopped run resumes.

Setup (once, in tools/bpm):
  npm install
  uv venv -p 3.12 .venv && VIRTUAL_ENV=.venv uv pip install -r requirements.txt

Usage:
  .venv/bin/python bpm.py OUT.jsonl ROOT_DIR          # every .sid under ROOT_DIR
  .venv/bin/python bpm.py OUT.jsonl --list tunes.txt  # lines of "path[:song] [bpm]"
Options: --workers N  --seconds 70  --skip 10  --limit N
"""
import argparse, json, os, re, struct, subprocess, sys, time
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
RATE = 44100            # essentia's rhythm extractors assume 44.1 kHz
SILENT_RMS = 0.002      # a window quieter than this has no tune to measure
MIN_CONFIDENCE = 1.0    # essentia: below 1 its beat tracking is poor (the scale tops out at 5.32)
BPM_RANGE = (40, 250)   # outside this it has locked onto effects or noise, not a beat

_server = None
_opts = None

def _init(opts):
    global _server, _opts
    _opts = opts
    import essentia
    essentia.log.warningActive = False
    essentia.log.infoActive = False
    _start_server()

def _start_server():
    global _server
    env = {k: v for k, v in os.environ.items() if k != "NODE_OPTIONS"}
    _server = subprocess.Popen(["node", str(HERE / "render-server.mjs")], cwd=HERE, env=env,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE)

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
        return {"silent": True, "rms": round(rms, 5)}
    bpm, beats, conf, _, _ = es.RhythmExtractor2013(method="multifeature")(body)
    percival = es.PercivalBpmEstimator(sampleRate=RATE)(body)
    reliable = conf >= MIN_CONFIDENCE and BPM_RANGE[0] <= bpm <= BPM_RANGE[1]
    return {"bpm": round(float(bpm)), "reliable": bool(reliable), "confidence": round(float(conf), 3),
            "percival": round(float(percival)), "beats": len(beats), "rms": round(rms, 5)}

def work(job):
    path, song = job
    import numpy as np
    t0 = time.perf_counter()
    row = {"path": path, "song": song}
    try:
        req = {"path": path, "song": song, "seconds": _opts["seconds"], "sampleRate": RATE}
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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("root", nargs="?")
    ap.add_argument("--list")
    ap.add_argument("--workers", type=int, default=os.cpu_count())
    ap.add_argument("--seconds", type=float, default=70)
    ap.add_argument("--skip", type=float, default=10)
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()

    if a.list:
        jobs = []
        for line in Path(a.list).read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # Anything after the path, such as a known BPM to compare with, is ignored.
            p, s = re.match(r"(.*?\.sid)(?::(\d+))?(?:\s.*)?$", line, re.I).groups()
            p = str(Path(p).resolve())
            jobs += [(p, int(s))] if s else subtunes(p)
    else:
        jobs = [j for p in sorted(Path(a.root).resolve().rglob("*.sid")) for j in subtunes(str(p))]

    done = set()
    if os.path.exists(a.out):
        for line in open(a.out):
            try:
                r = json.loads(line)
            except ValueError:
                continue    # a line cut short by a stopped run
            done.add((r["path"], r["song"]))
    jobs = [j for j in jobs if j not in done]
    if a.limit:
        jobs = jobs[:a.limit]
    print(f"{len(jobs)} subtunes to do, {len(done)} already done, {a.workers} workers", file=sys.stderr)

    opts = {"seconds": a.seconds, "skip": a.skip}
    t0, n = time.perf_counter(), 0
    with open(a.out, "a") as f, Pool(a.workers, initializer=_init, initargs=(opts,)) as pool:
        for r in pool.imap_unordered(work, jobs, chunksize=2):
            n += 1
            f.write(json.dumps(r) + "\n")
            f.flush()
            if n % 200 == 0:
                rate = n / (time.perf_counter() - t0)
                print(f"{n} subtunes, {rate:.1f}/s", file=sys.stderr)
    print(f"done: {n} subtunes in {time.perf_counter() - t0:.0f}s", file=sys.stderr)

if __name__ == "__main__":
    main()

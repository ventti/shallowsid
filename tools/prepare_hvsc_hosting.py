#!/usr/bin/env python3
"""Prepare HVSC for Firebase Hosting. The Firebase CLI gzips each upload at level 9.

Keep original .sid paths: HTTP content negotiation handles gzip transparently.
Copy only SID files and the collection's DOCUMENTS, never application secrets.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import time


def needs_deploy(local, remote):
    if remote.get("hvsc_version", 0) > local["hvsc_version"]:
        raise ValueError("Refusing to replace a newer HVSC release with an older one")
    # Gzip byte totals can vary between zlib versions; compare actual content
    # and configuration, rather than rebuilding for a statistics-only change.
    return any(remote.get(key) != local[key]
               for key in ("hvsc_version", "fingerprint", "hosting_config"))


def prepare(source, out, version, workers=None):
    source, out = source.resolve(), out.resolve()
    if source == out or source in out.parents or out in source.parents:
        raise ValueError("Source and output must be separate directories")
    files = sorted(p for p in source.rglob("*") if p.is_file() and (
        p.suffix.lower() == ".sid" or p.relative_to(source).parts[0] == "DOCUMENTS"))
    sid_count = sum(p.suffix.lower() == ".sid" for p in files)
    if not sid_count:
        raise ValueError("No SID files found; refusing to prepare an empty deployment")
    # Only replace an output this tool previously created, or an empty folder.
    if out.exists() and any(out.iterdir()):
        if not (out / "manifest.json").exists():
            raise ValueError("Output is not a previously prepared HVSC hosting directory")
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    def copy_file(path):
        relative = path.relative_to(source)
        data = path.read_bytes()
        if path.suffix.lower() == ".sid" and data[:4] not in (b"PSID", b"RSID"):
            raise ValueError(f"Invalid SID header: {relative}")
        dest = out / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        packed = gzip.compress(data, compresslevel=9, mtime=0)
        return relative.as_posix(), hashlib.sha256(data).hexdigest(), len(data), len(packed)

    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers or os.cpu_count() or 1) as pool:
        entries = list(pool.map(copy_file, files))
    fingerprint = hashlib.sha256(json.dumps(
        [(name, digest) for name, digest, _, _ in entries], separators=(",", ":")
    ).encode()).hexdigest()
    manifest = {
        "hvsc_version": version,
        "fingerprint": fingerprint,
        "sid_files": sid_count,
        "files": len(entries),
        "original_bytes": sum(e[2] for e in entries),
        "gzip_bytes": sum(e[3] for e in entries),
        "hosting_config": hashlib.sha256(json.dumps(json.loads(
            (Path(__file__).resolve().parent.parent / "firebase.json").read_text()
        )["hosting"], sort_keys=True).encode()).hexdigest(),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({**manifest, "elapsed_seconds": round(time.perf_counter() - start, 2)}, indent=2))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("_hvsc-source"))
    parser.add_argument("--out", type=Path, default=Path("_hvsc-hosting"))
    parser.add_argument("--version", type=int)
    args = parser.parse_args()
    version = args.version
    if version is None:
        version = int((args.source / ".hvsc-version").read_text().strip())
    if version < 1:
        parser.error("HVSC version must be positive")
    prepare(args.source, args.out, version)


if __name__ == "__main__":
    main()

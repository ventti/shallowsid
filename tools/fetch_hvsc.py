#!/usr/bin/env python3
"""Download the latest complete HVSC and unpack its C64Music folder.

The app streams tunes from hvsc.c64.org; a local copy served as <site>/hvsc/
is only a fallback. Needs `7z` (or `bsdtar`).

Usage:
  python3 tools/fetch_hvsc.py                      # -> ./hvsc
  python3 tools/fetch_hvsc.py --dest ~/.cache/shallowsid/_site/hvsc
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

VERSION_API = "https://www.hvsc.c64.org/api/v1/version"
FALLBACK_VERSION = {"version": 85, "complete": {"url": "https://hvsc.brona.dk/HVSC/HVSC_85-all-of-them.7z"}}
DEFAULT_CACHE = Path.home() / ".cache" / "shallowsid"


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def latest_version():
    """{'version': 85, 'complete': {'url': ...}} from the HVSC site."""
    try:
        with urllib.request.urlopen(VERSION_API, timeout=20) as resp:
            return json.load(resp)
    except Exception as err:  # the API is undocumented; don't let it break builds
        log(f"version API failed ({err}), falling back to HVSC #{FALLBACK_VERSION['version']}")
        return FALLBACK_VERSION


def download(url, dest):
    if dest.exists():
        log(f"using cached {dest}")
        return
    log(f"downloading {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=60) as resp, open(part, "wb") as out:
        shutil.copyfileobj(resp, out, length=1 << 20)
    part.rename(dest)


def extract(archive, dest):
    log(f"extracting {archive.name}")
    tool = shutil.which("7z") or shutil.which("7za") or shutil.which("7zz")
    if tool:
        subprocess.run([tool, "x", "-y", f"-o{dest}", str(archive)], check=True, stdout=subprocess.DEVNULL)
    else:
        subprocess.run(["bsdtar", "-xf", str(archive), "-C", str(dest)], check=True)


def fetch_hvsc(dest, cache=DEFAULT_CACHE, keep_archive=False):
    """Replace `dest` with the latest C64Music folder. Returns the HVSC version."""
    info = latest_version()
    url = info["complete"]["url"]
    archive = Path(cache).expanduser() / url.rsplit("/", 1)[1]
    download(url, archive)
    dest = Path(dest).expanduser()
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dest.parent) as tmp:
        extract(archive, Path(tmp))
        music = next((p for p in [Path(tmp) / "C64Music", *Path(tmp).glob("*/C64Music")] if p.is_dir()), None)
        if music is None:
            sys.exit(f"no C64Music folder in {archive}")
        if dest.exists():
            shutil.rmtree(dest)
        music.rename(dest)
    (dest / ".hvsc-version").write_text(f"{info['version']}\n")
    if not keep_archive:
        archive.unlink()
    log(f"HVSC #{info['version']} unpacked to {dest}")
    return info["version"]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dest", default="hvsc", help="where to put the C64Music contents (default: ./hvsc)")
    parser.add_argument("--cache", default=str(DEFAULT_CACHE), help="download dir for the .7z")
    parser.add_argument("--keep-archive", action="store_true", help="keep the downloaded .7z for next time")
    args = parser.parse_args()
    fetch_hvsc(args.dest, args.cache, args.keep_archive)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build ShallowSID's song catalogue (data/index.json) from HVSC.

Parses every PSID/RSID header, joins song lengths from
DOCUMENTS/Songlengths.md5 and writes a compact columnar index. Songs are not
copied: the app streams them from hvsc.c64.org.

Uses <out>/hvsc (see fetch_hvsc.py) when it exists; otherwise downloads the
latest HVSC into a temp dir and deletes it afterwards.

Usage:
  python3 tools/build_index.py                       # -> ./data/index.json
  python3 tools/build_index.py --subset MUSICIANS/H/Hubbard_Rob
  python3 tools/build_index.py --out _site --keep-archive
"""

import argparse
import hashlib
import json
import re
import struct
import sys
import tempfile
from pathlib import Path

from fetch_hvsc import DEFAULT_CACHE, fetch_hvsc

# PSID/RSID header layout (big-endian), see HVSC DOCUMENTS/SID_file_format.txt
HEADER_MIN_LEN = 0x76
OFFSET_TITLE, OFFSET_AUTHOR, OFFSET_RELEASED = 0x16, 0x36, 0x56
FIELD_LEN = 32

# Bits of the per-file flags column in index.json
FLAG_RSID = 1 << 0
FLAG_CLOCK_SHIFT = 1          # 2 bits: 0 unknown, 1 PAL, 2 NTSC, 3 both
FLAG_MODEL_SHIFT = 3          # 2 bits: 0 unknown, 1 6581, 2 8580, 3 both
FLAG_MULTI_SID = 1 << 5

TIME_RE = re.compile(r"(\d+):(\d+)(?:\.(\d+))?")


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def parse_time(token):
    """'3:05.5' -> seconds (float), following libsidplayfp's SidDatabase rules."""
    m = TIME_RE.match(token)
    if not m:
        return None
    minutes, seconds, frac = m.groups()
    total = int(minutes) * 60 + int(seconds)
    if frac:
        total += int(frac) / (10 ** len(frac))
    return total


def parse_songlengths(path):
    """Return (by_path, by_md5) maps of per-subtune lengths in whole seconds."""
    by_path, by_md5 = {}, {}
    current_path = None
    for line in path.read_text(encoding="latin-1").splitlines():
        line = line.strip()
        if line.startswith(";"):
            current_path = line[1:].strip().lstrip("/")
        elif "=" in line and not line.startswith("["):
            md5, times = line.split("=", 1)
            lengths = [round(t) for t in (parse_time(tok) for tok in times.split()) if t is not None]
            by_md5[md5.strip().lower()] = lengths
            if current_path:
                by_path[current_path] = lengths
            current_path = None
    return by_path, by_md5


def text_field(data, offset):
    return data[offset:offset + FIELD_LEN].split(b"\0", 1)[0].decode("latin-1").strip()


def parse_header(data):
    """Parse a PSID/RSID header. Returns None for anything that isn't one."""
    if len(data) < HEADER_MIN_LEN or data[:4] not in (b"PSID", b"RSID"):
        return None
    version, data_offset = struct.unpack_from(">HH", data, 0x04)
    songs, start_song = struct.unpack_from(">HH", data, 0x0E)
    flags = FLAG_RSID if data[:4] == b"RSID" else 0
    if version >= 2 and len(data) >= 0x7C:
        (header_flags,) = struct.unpack_from(">H", data, 0x76)
        flags |= ((header_flags >> 2) & 0b11) << FLAG_CLOCK_SHIFT
        flags |= ((header_flags >> 4) & 0b11) << FLAG_MODEL_SHIFT
        second_sid, third_sid = data[0x7A], data[0x7B]
        if second_sid or (version >= 4 and third_sid):
            flags |= FLAG_MULTI_SID
    return {
        "title": text_field(data, OFFSET_TITLE),
        "author": text_field(data, OFFSET_AUTHOR),
        "released": text_field(data, OFFSET_RELEASED),
        "songs": max(songs, 1),
        "start": min(max(start_song, 1), max(songs, 1)),
        "flags": flags,
    }


class Interner:
    """Deduplicates repeated strings (dirs, authors) into an index table."""

    def __init__(self):
        self.values, self.index = [], {}

    def __call__(self, value):
        if value not in self.index:
            self.index[value] = len(self.values)
            self.values.append(value)
        return self.index[value]


def build_index(music_root, subset, version):
    lengths_file = music_root / "DOCUMENTS" / "Songlengths.md5"
    by_path, by_md5 = parse_songlengths(lengths_file) if lengths_file.exists() else ({}, {})
    log(f"song lengths for {len(by_md5)} tunes")

    scan_root = music_root / subset if subset else music_root
    dirs, authors, files = Interner(), Interner(), []
    for sid_path in sorted(scan_root.rglob("*.sid")):
        data = sid_path.read_bytes()
        header = parse_header(data)
        if header is None:
            log(f"skipping non-SID {sid_path}")
            continue
        rel = sid_path.relative_to(music_root).as_posix()
        lengths = by_path.get(rel) or by_md5.get(hashlib.md5(data).hexdigest()) or []
        rel_dir, name = rel.rsplit("/", 1) if "/" in rel else ("", rel)
        files.append([
            dirs(rel_dir), name, header["title"], authors(header["author"]), header["released"],
            header["songs"], header["start"], header["flags"], lengths,
        ])
    index = {
        "v": version,
        "fields": ["dir", "name", "title", "author", "released", "songs", "start", "flags", "lengths"],
        "dirs": dirs.values,
        "authors": authors.values,
        "files": files,
    }
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=".", help="site root to write data/index.json into (default: .)")
    parser.add_argument("--subset", help="only index this C64Music sub-path, e.g. MUSICIANS/H/Hubbard_Rob")
    parser.add_argument("--music-root", help="unpacked C64Music folder (default: <out>/hvsc if it exists)")
    parser.add_argument("--cache", default=str(DEFAULT_CACHE), help="download dir for the .7z")
    parser.add_argument("--keep-archive", action="store_true", help="keep the downloaded .7z (for CI caching)")
    args = parser.parse_args()

    out = Path(args.out)
    music_root = Path(args.music_root).expanduser() if args.music_root else out / "hvsc"
    if music_root.is_dir():
        index = build_index(music_root, args.subset, read_version(music_root))
    else:
        with tempfile.TemporaryDirectory() as tmp:
            music_root = Path(tmp) / "C64Music"
            version = fetch_hvsc(music_root, args.cache, args.keep_archive)
            index = build_index(music_root, args.subset, version)

    (out / "data").mkdir(parents=True, exist_ok=True)
    index_path = out / "data" / "index.json"
    index_path.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"wrote {index_path} ({len(index['files'])} tunes, {index_path.stat().st_size // 1024} KiB)")


def read_version(music_root):
    marker = music_root / ".hvsc-version"
    return int(marker.read_text()) if marker.exists() else 0


if __name__ == "__main__":
    main()

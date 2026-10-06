#!/usr/bin/env python3
"""Check a live HVSC deployment against local bytes, gzip delivery and CORS."""

import argparse
import gzip
import json
from pathlib import Path
import urllib.parse
import urllib.request
import urllib.error


def verify(base, root):
    local = json.loads((root / "manifest.json").read_text())
    with urllib.request.urlopen(base.rstrip("/") + "/manifest.json", timeout=60) as response:
        remote = json.load(response)
    if remote != local:
        raise ValueError("Live manifest does not match the prepared collection")
    with urllib.request.urlopen(base.rstrip("/") + "/", timeout=60) as response:
        if response.geturl() != "https://sid.extend.fi/":
            raise ValueError("Hosting root did not redirect to the app")
    try:
        urllib.request.urlopen(base.rstrip("/") + "/__hvsc_missing_redirect_check__", timeout=60)
    except urllib.error.HTTPError as error:
        if error.code != 404 or error.read() != (root / "404.html").read_bytes():
            raise ValueError("Missing paths did not serve the redirecting 404 page") from error
    else:
        raise ValueError("Missing paths must retain HTTP 404 status")
    print("Verified root redirect and custom 404 redirect page")
    # Sample each collection section, including nested musician paths.
    samples = [next(iter(sorted((root / section).rglob("*.sid"))), None)
               for section in ("MUSICIANS", "GAMES", "DEMOS")]
    if not any(samples):
        raise ValueError("No SID files to verify")
    for path in filter(None, samples):
        relative = path.relative_to(root).as_posix()
        request = urllib.request.Request(
            base.rstrip("/") + "/" + urllib.parse.quote(relative, safe="/"),
            headers={"Accept-Encoding": "gzip", "Origin": "https://sid.extend.fi"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
            if response.headers.get("Content-Encoding") != "gzip":
                raise ValueError(f"Not served gzip-compressed: {relative}")
            if response.headers.get("Access-Control-Allow-Origin") not in ("*", "https://sid.extend.fi"):
                raise ValueError(f"Missing browser access for sid.extend.fi: {relative}")
            if gzip.decompress(data) != path.read_bytes():
                raise ValueError(f"Downloaded SID differs: {relative}")
        print(f"Verified gzip, CORS and original bytes: {relative}")
    print(f"Live collection verified: HVSC #{local['hvsc_version']}, {local['sid_files']} SIDs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="https://shallowsid.web.app")
    parser.add_argument("--root", type=Path, default=Path("_hvsc-hosting"))
    args = parser.parse_args()
    verify(args.url, args.root)

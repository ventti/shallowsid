#!/usr/bin/env python3
"""Resolve HVSC versions and check deployment changes for GitHub Actions."""

import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

from fetch_hvsc import latest_version
from prepare_hvsc_hosting import needs_deploy


def output(name, value):
    line = f"{name}={value}\n"
    if path := os.environ.get("GITHUB_OUTPUT"):
        with open(path, "a") as stream:
            stream.write(line)
    print(line, end="")


def remote_manifest(base):
    try:
        with urllib.request.urlopen(base.rstrip("/") + "/manifest.json", timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        return {}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("resolve-version")
    changes = commands.add_parser("check-changes")
    changes.add_argument("--root", type=Path, default=Path("_hvsc-hosting"))
    changes.add_argument("--url", default="https://shallowsid-hvsc.web.app")
    args = parser.parse_args()
    if args.command == "resolve-version":
        output("version", int(latest_version()["version"]))
    else:
        local = json.loads((args.root / "manifest.json").read_text())
        changed = needs_deploy(local, remote_manifest(args.url))
        output("changed", str(changed).lower())
        print("Deployment required" if changed else "HVSC and hosting configuration unchanged")


if __name__ == "__main__":
    main()

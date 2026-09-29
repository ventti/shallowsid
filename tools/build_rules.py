#!/usr/bin/env python3
"""Write the accepted tag ids from js/tags-vocab.json into firestore.rules.

The rules accept every id in the vocabulary's groups plus those under
"retired": tags taken out of the app. A retired id is hidden in the app but
still accepted, so a device still running the previous version can save a
tune that has it. Never delete an id from the JSON: move it to "retired".
tools/deploy_rules.py refuses to deploy rules that drop an accepted id.

Usage:
  tools/build_rules.py           # rewrite the block between the markers
  tools/build_rules.py --check   # exit 1 if firestore.rules is out of date (CI)
"""

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RULES = REPO / "firestore.rules"
VOCAB = REPO / "js" / "tags-vocab.json"
TAG_ID = re.compile(r"^[a-z0-9-]{1,24}$")
BLOCK = re.compile(r"(// BEGIN TAG IDS\n)(.*?)(\s*// END TAG IDS)", re.S)


def accepted_ids(vocab):
    """Active ids then retired ones, validated: well formed, unique, not both."""
    active = [t["id"] for g in vocab["groups"] for t in g["tags"]]
    retired = vocab.get("retired", [])
    problems = [f"bad id {i!r}" for i in active + retired if not isinstance(i, str) or not TAG_ID.match(i)]
    for name, ids in (("groups", active), ("retired", retired)):
        problems += [f"{i!r} repeated in {name}" for i in sorted(set(ids)) if ids.count(i) > 1]
    problems += [f"{i!r} is both a tag and retired" for i in sorted(set(active) & set(retired))]
    if problems:
        raise SystemExit("js/tags-vocab.json: " + "; ".join(problems))
    return active + retired


def ids_in_rules(text):
    """The ids a rules file accepts, or None if it has no tag block."""
    match = BLOCK.search(text)
    return re.findall(r"'([a-z0-9-]+)'", match.group(2)) if match else None


def render(text, ids):
    lines = [f"        '{i}'," for i in ids]
    if lines:
        lines[-1] = lines[-1].rstrip(",")
    body = "    function tagIds() {\n      return [\n" + "\n".join(lines) + "\n      ];\n    }"
    if not BLOCK.search(text):
        raise SystemExit("firestore.rules has no // BEGIN TAG IDS ... // END TAG IDS block")
    return BLOCK.sub(lambda m: m.group(1) + body + m.group(3), text, count=1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="only check that firestore.rules is up to date")
    args = parser.parse_args()
    ids = accepted_ids(json.loads(VOCAB.read_text()))
    text = RULES.read_text()
    new = render(text, ids)
    if args.check:
        if new != text:
            sys.exit("firestore.rules is out of date with js/tags-vocab.json: run tools/build_rules.py")
        print(f"firestore.rules is up to date ({len(ids)} tag ids)")
    elif new != text:
        RULES.write_text(new)
        print(f"firestore.rules: {len(ids)} tag ids")
    else:
        print("firestore.rules: unchanged")


if __name__ == "__main__":
    main()

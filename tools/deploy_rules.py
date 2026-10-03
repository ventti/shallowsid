#!/usr/bin/env python3
"""Deploy firestore.rules to the Firebase project, safely.

Rules only decide who may read and write. Deploying them never touches the
data. Before releasing, this:

  1. writes a fresh firestore.rules from firestore.rules.in and the current
     js/tags-vocab.json (tools/build_rules.py), and deploys that,
  2. refuses rules that stop accepting a tag id the deployed rules accept
     (devices still on the previous version could no longer save those
     tunes; retire ids in the JSON instead of deleting them),
  3. has the Rules API compile the file, and fails on any error,
  4. does nothing if the deployed rules are the same.

Then it creates a ruleset and points the Firestore release at it, an atomic
switch. The previous ruleset is kept in Firebase, so a rollback is picking it
under Firestore -> Rules -> history, or re-running this from an older commit.

With GITHUB_OUTPUT set (CI), writes changed=true|false there, and a diff of
the rules to GITHUB_STEP_SUMMARY.

Usage:
  tools/deploy_rules.py [--dry-run] [--project ID]
"""

import argparse
import difflib
import json
import os
import sys

from build_rules import VOCAB, accepted_ids, build, ids_in_rules
from firestore_admin import access_token, call, default_project

API = "https://firebaserules.googleapis.com/v1"
FILE_NAME = "firestore.rules"


def deployed(project, token, quota):
    """(release, content) of the live Firestore rules, or (None, None) if none were released."""
    release = call("GET", f"{API}/projects/{project}/releases/cloud.firestore", token, project=quota)
    if not release:
        return None, None
    ruleset = call("GET", f"{API}/{release['rulesetName']}", token, project=quota)
    files = ruleset["source"]["files"]
    return release, "\n".join(f["content"] for f in files)


def output(name, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as f:
            f.write(f"{name}={value}\n")


def summary(text):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write(text + "\n")
    print(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="check and compile, but don't release")
    parser.add_argument("--project", help="Firebase project (default: from js/sync-config.js)")
    args = parser.parse_args()
    project = args.project or default_project()
    token, from_ci = access_token()
    quota = None if from_ci else project

    content = build()
    ids = accepted_ids(json.loads(VOCAB.read_text()))

    release, live = deployed(project, token, quota)
    dropped = sorted(set(ids_in_rules(live or "") or []) - set(ids))
    if dropped:
        sys.exit(f"Refusing to deploy: these tag ids are accepted now and wouldn't be: {', '.join(dropped)}. "
                 "Move them to \"retired\" in js/tags-vocab.json.")

    if live == content:
        summary(f"Firestore rules for `{project}` are already up to date.")
        output("changed", "false")
        return

    source = {"files": [{"name": FILE_NAME, "content": content}]}
    test = call("POST", f"{API}/projects/{project}:test", token, {"source": source}, quota) or {}
    errors = [i for i in test.get("issues", []) if i.get("severity") == "ERROR"]
    if errors:
        sys.exit("The rules don't compile:\n" + "\n".join(f"  line {i['sourcePosition'].get('line')}: {i['description']}" for i in errors))

    diff = "".join(difflib.unified_diff((live or "").splitlines(True), content.splitlines(True), "deployed", "firestore.rules"))
    summary(f"### Firestore rules for `{project}`{' (dry run)' if args.dry_run else ''}\n\n```diff\n{diff}\n```")
    if args.dry_run:
        output("changed", "false")
        return

    ruleset = call("POST", f"{API}/projects/{project}/rulesets", token, {"source": source}, quota)
    name = f"projects/{project}/releases/cloud.firestore"
    if release:
        call("PATCH", f"{API}/{name}", token, {"release": {"name": name, "rulesetName": ruleset["name"]}}, quota)
    else:
        call("POST", f"{API}/projects/{project}/releases", token, {"name": name, "rulesetName": ruleset["name"]}, quota)
    summary(f"Released {ruleset['name']} (previous: {release['rulesetName'] if release else 'none'}).")
    output("changed", "true")


if __name__ == "__main__":
    main()

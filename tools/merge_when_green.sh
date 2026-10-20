#!/usr/bin/env bash
# Wait until the named checks of a PR pass, then squash-merge it.
# Usage: tools/merge_when_green.sh <pr> <check>...   (needs gh and GH_TOKEN)
# Waits for each check by name: auto-merge alone can merge at once in a
# repository without branch protection. Exits 1 if the checks don't pass in
# about 30 minutes, and leaves the PR open.
set -euo pipefail
pr="${1:?Usage: tools/merge_when_green.sh <pr> <check>...}"; shift
(( $# )) || { echo "Name at least one check" >&2; exit 2; }
names="$(printf '"%s",' "$@")"; names="[${names%,}]"
for _ in $(seq 1 90); do
  sha=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
  passed=$(gh pr view "$pr" --json statusCheckRollup --jq "[.statusCheckRollup[] | select(.name as \$n | $names | index(\$n)) | select(.status == \"COMPLETED\" and .conclusion == \"SUCCESS\") | .name] | unique | length")
  if [[ "$passed" == "$#" ]]; then
    gh pr merge "$pr" --squash --match-head-commit "$sha" --delete-branch
    exit 0
  fi
  sleep 20
done
echo "Checks did not pass; leaving the PR open."
exit 1

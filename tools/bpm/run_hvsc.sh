#!/usr/bin/env bash
# Estimate the BPM of every subtune in HVSC, then publish the results into
# tools/bpm/estimates.tsv (review.py publish), ready to commit.
#
# Usage: tools/bpm/run_hvsc.sh [--commit] [bpm.py options, e.g. --workers 12 -v]
#
# It picks up where the last run stopped: subtunes already in results.jsonl are
# skipped. Ctrl-C stops the analysis, and what's done so far is still published.
# --commit also commits estimates.tsv (and nothing else); it never pushes.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
commit=false
args=()
for arg in "$@"; do
  if [[ $arg == --commit ]]; then commit=true; else args+=("$arg"); fi
done

if [[ ! -d $repo/hvsc ]]; then
  echo "No HVSC in $repo/hvsc. Get it with: tools/fetch_hvsc.py --dest $repo/hvsc" >&2
  exit 1
fi

# A handler, not "ignore": an ignored SIGINT would be inherited by bpm.py, and
# Ctrl-C has to reach it to stop it cleanly. This way the script carries on.
trap : INT
"$here/bpm.py" "$repo/hvsc" "${args[@]+"${args[@]}"}"
status=$?
trap - INT
if [[ $status -ne 0 && $status -ne 130 ]]; then
  echo "bpm.py failed (exit $status); estimates.tsv is unchanged." >&2
  exit "$status"
fi
[[ $status -eq 130 ]] && echo "Publishing what's done so far."

"$here/review.py" publish || exit

if $commit; then
  file=tools/bpm/estimates.tsv
  if git -C "$repo" diff --quiet -- "$file"; then
    echo "estimates.tsv didn't change: nothing to commit."
  else
    count=$(grep -vc "^#" "$repo/$file")
    git -C "$repo" add -- "$file"
    git -C "$repo" commit -q -m "chore(bpm): estimates for $count subtunes" -- "$file" &&
      git -C "$repo" log --oneline -1
  fi
fi
exit "$status"

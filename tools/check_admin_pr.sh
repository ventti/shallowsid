#!/usr/bin/env bash
# Check a bot PR from the "Publish admin changes" workflow.
# Usage: tools/check_admin_pr.sh <base sha> <head sha>   (from the repo root)
# The PR may change only js/tags-vocab.json and js/curated-lists.json. Each
# changed file must pass its sync script's check against the base version.
set -euo pipefail
base="${1:?Usage: tools/check_admin_pr.sh <base sha> <head sha>}"
head="${2:?Usage: tools/check_admin_pr.sh <base sha> <head sha>}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
changed="$(git diff --name-only "$base...$head")"
[[ -n "$changed" ]] || { echo "The PR changes nothing" >&2; exit 1; }
while read -r file; do
  case "$file" in
    js/tags-vocab.json)
      git show "$base:$file" > "$tmp/tags-vocab.json"
      python3 tools/sync_tag_vocab.py --before "$tmp/tags-vocab.json" ;;
    js/curated-lists.json)
      git show "$base:$file" > "$tmp/curated-lists.json"
      python3 tools/sync_curated_lists.py --before "$tmp/curated-lists.json" ;;
    *)
      echo "The bot PR may not change $file" >&2; exit 1 ;;
  esac
  echo "ok: $file"
done <<< "$changed"

#!/usr/bin/env bash
set -euo pipefail

# Prepare locally; CI publishes this state only after the site and rules pass.
source .release.env
source .release-scripts/lib/version.sh
latest=$(release_latest_stable_tag "${RELEASE_TAG_PREFIX-v}" || true)
if [[ -n "$latest" && "$(git rev-parse "${latest}^{}")" == "$(git rev-parse HEAD)" ]]; then
    exit 0
fi
# Docs, CI and other changes still get a version when pushed to production.
bump=$(release_recommended_bump "$latest" || printf '%s\n' patch)
.release-scripts/release --no-publish "$bump"
tag=$(git describe --tags --exact-match)
mkdir -p "$1"
git bundle create "$1/release.bundle" refs/heads/main "refs/tags/$tag"
cp ".git/release-notes-$tag.md" "$1/notes.md"
printf 'tag=%s\n' "$tag" >> "$GITHUB_OUTPUT"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/common.sh"
# shellcheck source=lib/version.sh
source "$SCRIPT_DIR/version.sh"

usage() {
    cat <<'EOF'
Usage: github.sh TAG [NOTES_FILE] [--prerelease] [--moving-tags LEVELS]

Push TAG and create or update its GitHub Release with RELEASE_ARTIFACTS.
EOF
}

[[ $# -ge 1 ]] || { usage >&2; exit 1; }
TAG=$1
shift
SAFE_TAG=${TAG//\//-}
NOTES=""
if [[ $# -gt 0 && "$1" != --* ]]; then
    NOTES=$1
    shift
fi
PRERELEASE=false
MOVING_TAGS=${RELEASE_MOVING_TAGS:-}
while [[ $# -gt 0 ]]; do
    case "$1" in
        --prerelease) PRERELEASE=true ;;
        --moving-tags)
            [[ $# -ge 2 ]] || release_die "--moving-tags requires a value"
            MOVING_TAGS=$2
            shift
            ;;
        -h|--help) usage; exit 0 ;;
        *) release_die "unknown argument: $1" ;;
    esac
    shift
done

release_gh_available || release_die "GitHub CLI is unavailable; install gh or mise"
ROOT=$(release_project_root)
cd "$ROOT"
NOTES=${NOTES:-$ROOT/.git/release-notes-${SAFE_TAG}.md}
[[ -f "$NOTES" ]] || release_die "release notes not found: $NOTES"
git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null || release_die "tag not found: $TAG"

release_expand_artifacts
BRANCH=$(git symbolic-ref --quiet --short HEAD) || release_die "releases must be published from a branch"
if git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
    git push
else
    git push --set-upstream origin "$BRANCH"
fi
TAG_PREFIX=${RELEASE_TAG_PREFIX-v}
VERSION=$(release_version_from_tag "$TAG" "$TAG_PREFIX") || release_die "unsupported release tag: $TAG"
tag_refspecs=("refs/tags/${TAG}")
MOVING_TAG_OUTPUT=$(release_moving_tags "$VERSION" "$TAG_PREFIX" "$MOVING_TAGS") || \
    release_die "RELEASE_MOVING_TAGS must contain only major and/or minor"
while IFS= read -r moving_tag; do
    [[ -n "$moving_tag" ]] || continue
    if git rev-parse -q --verify "refs/tags/${moving_tag}" >/dev/null && \
       [[ "$(git rev-parse "${moving_tag}^{}")" == "$(git rev-parse "${TAG}^{}")" ]]; then
        tag_refspecs+=("+refs/tags/${moving_tag}")
    fi
done <<< "$MOVING_TAG_OUTPUT"
git push --atomic origin "${tag_refspecs[@]}"

if release_gh release view "$TAG" >/dev/null 2>&1; then
    release_info "Updating GitHub Release ${TAG}"
    if $PRERELEASE; then
        release_gh release edit "$TAG" --notes-file "$NOTES" --prerelease
    else
        release_gh release edit "$TAG" --notes-file "$NOTES" --latest
    fi
    if [[ ${#RELEASE_ASSET_FILES[@]} -gt 0 ]]; then
        release_gh release upload "$TAG" "${RELEASE_ASSET_FILES[@]}" --clobber
    fi
else
    args=(release create "$TAG" --title "$TAG" --notes-file "$NOTES" --verify-tag)
    if $PRERELEASE; then
        args+=(--prerelease)
    else
        args+=(--latest)
    fi
    if [[ ${#RELEASE_ASSET_FILES[@]} -gt 0 ]]; then
        args+=("${RELEASE_ASSET_FILES[@]}")
    fi
    release_gh "${args[@]}"
fi

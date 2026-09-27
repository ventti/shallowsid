#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/common.sh"
# shellcheck source=lib/version.sh
source "$SCRIPT_DIR/version.sh"

usage() {
    cat <<'EOF'
Usage: release.sh [OPTIONS] major|minor|patch|auto
       release.sh --pre [OPTIONS] [major|minor|patch|auto]
       release.sh --promote [OPTIONS]

Options:
  --pre          create or continue a release candidate; the bump defaults to
                 auto, and an unpromoted rc is advanced to the next rc number
  --promote      promote the latest rc tag to a stable release
  --dry-run      show the release plan without changing anything
  --no-publish   create the local commit and tag without pushing
  --moving-tags LEVELS
                 update moving stable tags: major, minor, or major,minor
  -h, --help     show this help
EOF
}

PRE=false
PROMOTE=false
DRY_RUN=false
PUBLISH=true
BUMP=""
MOVING_TAGS=${RELEASE_MOVING_TAGS:-}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --pre) PRE=true ;;
        --promote) PROMOTE=true ;;
        --dry-run) DRY_RUN=true ;;
        --no-publish) PUBLISH=false ;;
        --moving-tags)
            [[ $# -ge 2 ]] || release_die "--moving-tags requires a value"
            MOVING_TAGS=$2
            shift
            ;;
        major|minor|patch|auto)
            [[ -z "$BUMP" ]] || release_die "only one version bump may be specified"
            BUMP=$1
            ;;
        -h|--help) usage; exit 0 ;;
        *) release_die "unknown argument: $1" ;;
    esac
    shift
done

if $PROMOTE; then
    ! $PRE && [[ -z "$BUMP" ]] || release_die "--promote cannot be combined with --pre or a bump"
elif [[ -z "$BUMP" ]] && ! $PRE; then
    release_error "a version bump is required: auto, major, minor, or patch"
    usage >&2
    exit 1
fi

if [[ -n "${RELEASE_GET_VERSION:-}" || -n "${RELEASE_SET_VERSION:-}" ]]; then
    [[ -n "${RELEASE_GET_VERSION:-}" && -n "${RELEASE_SET_VERSION:-}" ]] || \
        release_die "RELEASE_GET_VERSION and RELEASE_SET_VERSION must be configured together"
fi

release_require_command git
ROOT=$(release_project_root)
cd "$ROOT"
if ! $DRY_RUN; then
    [[ -z "$(git status --porcelain)" ]] || release_die "working tree is not clean"
fi

if $PUBLISH && ! $DRY_RUN; then
    release_gh_available || release_die "GitHub CLI is unavailable; install gh or mise"
    release_gh auth status >/dev/null 2>&1 || \
        release_die "GitHub CLI is not authenticated; run: gh auth login (or mise exec gh@2 -- gh auth login)"
    git remote get-url origin >/dev/null 2>&1 || release_die "origin remote is not configured"
fi
RELEASE_BRANCH=$(release_assert_branch)

TAG_PREFIX=${RELEASE_TAG_PREFIX-v}
LATEST_STABLE_TAG=$(release_latest_stable_tag "$TAG_PREFIX" || true)
LATEST_STABLE_VERSION="0.0.0"
if [[ -n "$LATEST_STABLE_TAG" ]]; then
    LATEST_STABLE_VERSION=$(release_version_from_tag "$LATEST_STABLE_TAG" "$TAG_PREFIX")
fi

PACKAGE_VERSION=""
if [[ -n "${RELEASE_GET_VERSION:-}" ]]; then
    PACKAGE_VERSION_RAW=$(bash -o pipefail -c "$RELEASE_GET_VERSION") || \
        release_die "RELEASE_GET_VERSION failed"
    PACKAGE_VERSION_RAW=$(release_trim "$PACKAGE_VERSION_RAW")
    PACKAGE_VERSION=$(release_normalize_version "$PACKAGE_VERSION_RAW") || \
        release_die "unsupported package version returned by RELEASE_GET_VERSION: ${PACKAGE_VERSION_RAW}"
fi

EFFECTIVE_BUMP=$BUMP
INFERRED_BUMP=false

if $PROMOTE; then
    PRE_TAG=$(release_latest_prerelease_tag "$TAG_PREFIX" || true)
    [[ -n "$PRE_TAG" ]] || release_die "no ${TAG_PREFIX}X.Y.Z-rc.N tag found to promote"
    CURRENT_VERSION=$(release_version_from_tag "$PRE_TAG" "$TAG_PREFIX")
    TARGET_VERSION=${CURRENT_VERSION%%-rc.*}
    # The stable entry replaces the candidate entries, so it covers them all.
    PREVIOUS_TAG=$LATEST_STABLE_TAG
    if [[ -n "$PACKAGE_VERSION" && "$PACKAGE_VERSION" != "$CURRENT_VERSION" ]]; then
        release_die "package version ${PACKAGE_VERSION} does not match prerelease tag ${CURRENT_VERSION}"
    fi
else
    # An rc tag whose base version is still ahead of the latest stable tag is an
    # open prerelease line that --pre continues instead of restarting.
    OPEN_PRE_TAG=""
    OPEN_PRE_VERSION=""
    OPEN_PRE_BASE=""
    OPEN_PRE_NUMBER=""
    if $PRE; then
        OPEN_PRE_TAG=$(release_latest_prerelease_tag "$TAG_PREFIX" || true)
        if [[ -n "$OPEN_PRE_TAG" ]]; then
            OPEN_PRE_VERSION=$(release_version_from_tag "$OPEN_PRE_TAG" "$TAG_PREFIX")
            OPEN_PRE_BASE=${OPEN_PRE_VERSION%-rc.*}
            OPEN_PRE_NUMBER=${OPEN_PRE_VERSION##*-rc.}
            if ! release_version_gt "$OPEN_PRE_BASE" "$LATEST_STABLE_VERSION"; then
                OPEN_PRE_TAG=""
                OPEN_PRE_BASE=""
            fi
        fi
    fi

    # A bare --pre with no open prerelease line infers the bump from history.
    if [[ -z "$EFFECTIVE_BUMP" && -z "$OPEN_PRE_BASE" ]]; then
        EFFECTIVE_BUMP=auto
    fi
    if [[ "$EFFECTIVE_BUMP" == "auto" ]]; then
        EFFECTIVE_BUMP=$(release_recommended_bump "$LATEST_STABLE_TAG") || \
            release_die "no release-worthy Conventional Commits found since ${LATEST_STABLE_TAG:-the beginning}"
        INFERRED_BUMP=true
    fi

    if [[ -n "$OPEN_PRE_BASE" ]]; then
        CURRENT_VERSION=$OPEN_PRE_VERSION
        if [[ -n "$PACKAGE_VERSION" && "$PACKAGE_VERSION" != "$CURRENT_VERSION" ]]; then
            release_die "package version ${PACKAGE_VERSION} does not match prerelease tag ${CURRENT_VERSION}"
        fi
        NEXT_BASE=$OPEN_PRE_BASE
        if [[ -n "$EFFECTIVE_BUMP" ]]; then
            NEXT_BASE=$(release_bump_version "$LATEST_STABLE_VERSION" "$EFFECTIVE_BUMP") || \
                release_die "cannot bump version: ${LATEST_STABLE_VERSION}"
            if release_version_gt "$OPEN_PRE_BASE" "$NEXT_BASE"; then
                release_die "unpromoted prerelease ${OPEN_PRE_TAG} is ahead of ${NEXT_BASE}; omit the bump to continue it, or use --promote"
            fi
        fi
        if [[ "$NEXT_BASE" == "$OPEN_PRE_BASE" ]]; then
            [[ "$(git rev-parse "${OPEN_PRE_TAG}^{}")" != "$(git rev-parse HEAD)" ]] || \
                release_die "no commits since ${OPEN_PRE_TAG}"
            TARGET_VERSION="${OPEN_PRE_BASE}-rc.$((OPEN_PRE_NUMBER + 1))"
            EFFECTIVE_BUMP=prerelease
            INFERRED_BUMP=false
        else
            TARGET_VERSION="${NEXT_BASE}-rc.1"
        fi
        PREVIOUS_TAG=$OPEN_PRE_TAG
    else
        CURRENT_VERSION=${PACKAGE_VERSION:-$LATEST_STABLE_VERSION}
        [[ "$CURRENT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
            release_die "current version is a prerelease; use --pre or --promote"
        if [[ -n "$PACKAGE_VERSION" && -n "$LATEST_STABLE_TAG" && "$PACKAGE_VERSION" != "$LATEST_STABLE_VERSION" ]]; then
            release_die "package version ${PACKAGE_VERSION} does not match latest tag ${LATEST_STABLE_VERSION}"
        fi
        TARGET_VERSION=$(release_bump_version "$CURRENT_VERSION" "$EFFECTIVE_BUMP") || \
            release_die "cannot bump version: ${CURRENT_VERSION}"
        $PRE && TARGET_VERSION="${TARGET_VERSION}-rc.1"
        PREVIOUS_TAG=$LATEST_STABLE_TAG
    fi
fi

TAG="${TAG_PREFIX}${TARGET_VERSION}"
git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null && release_die "tag already exists: ${TAG}"
MOVING_TAG_NAMES=()
MOVING_TAG_OUTPUT=$(release_moving_tags "$TARGET_VERSION" "$TAG_PREFIX" "$MOVING_TAGS") || \
    release_die "RELEASE_MOVING_TAGS must contain only major and/or minor"
while IFS= read -r moving_tag; do
    [[ -n "$moving_tag" ]] && MOVING_TAG_NAMES+=("$moving_tag")
done <<< "$MOVING_TAG_OUTPUT"

export RELEASE_VERSION=$TARGET_VERSION
export RELEASE_VERSION_PEP440
RELEASE_VERSION_PEP440=$(release_pep440_version "$TARGET_VERSION")
export RELEASE_TAG=$TAG
export RELEASE_BUMP=${EFFECTIVE_BUMP:-promote}
export RELEASE_MOVING_TAGS=$MOVING_TAGS

release_info "Release plan"
release_info "  Branch:  ${RELEASE_BRANCH}"
release_info "  Current: ${CURRENT_VERSION}"
if $INFERRED_BUMP; then
    release_info "  Bump:    ${EFFECTIVE_BUMP} (Conventional Commits)"
fi
release_info "  Target:  ${TARGET_VERSION}"
release_info "  Tag:     ${TAG}"
if [[ -n "$MOVING_TAG_OUTPUT" ]]; then
    release_info "  Moving:  ${MOVING_TAG_NAMES[*]}"
elif [[ -n "$MOVING_TAGS" && "$TARGET_VERSION" == *-rc.* ]]; then
    release_info "  Moving:  skipped for prerelease"
fi
release_info "  Publish: ${PUBLISH}"

if $DRY_RUN; then
    [[ -z "${RELEASE_SET_VERSION:-}" ]] || release_info "  Version command: ${RELEASE_SET_VERSION}"
    [[ -z "${RELEASE_CHECK_COMMAND:-}" ]] || release_info "  Check command:   ${RELEASE_CHECK_COMMAND}"
    [[ -z "${RELEASE_BUILD_COMMAND:-}" ]] || release_info "  Build command:   ${RELEASE_BUILD_COMMAND}"
    exit 0
fi

if [[ -n "${RELEASE_SET_VERSION:-}" ]]; then
    release_run_hook "Set version ${TARGET_VERSION}" "$RELEASE_SET_VERSION"
    VERIFIED_RAW=$(bash -o pipefail -c "$RELEASE_GET_VERSION") || \
        release_die "RELEASE_GET_VERSION failed after setting the version"
    VERIFIED_RAW=$(release_trim "$VERIFIED_RAW")
    VERIFIED=$(release_normalize_version "$VERIFIED_RAW") || \
        release_die "unsupported version after update: ${VERIFIED_RAW}"
    [[ "$VERIFIED" == "$TARGET_VERSION" ]] || \
        release_die "version command produced ${VERIFIED}; expected ${TARGET_VERSION}"
fi

release_run_hook "Checks" "${RELEASE_CHECK_COMMAND:-}"
release_run_hook "Build" "${RELEASE_BUILD_COMMAND:-}"
release_expand_artifacts

SAFE_TAG=${TAG//\//-}
NOTES_FILE="$ROOT/.git/release-notes-${SAFE_TAG}.md"
export RELEASE_NOTES_FILE=$NOTES_FILE
export RELEASE_PREVIOUS_TAG=$PREVIOUS_TAG
CHANGELOG=${RELEASE_CHANGELOG:-CHANGELOG.md}
if [[ -n "${RELEASE_CHANGELOG_COMMAND:-}" ]]; then
    release_run_hook "Changelog" "$RELEASE_CHANGELOG_COMMAND"
    [[ -s "$NOTES_FILE" ]] || \
        release_die "RELEASE_CHANGELOG_COMMAND did not write RELEASE_NOTES_FILE: $NOTES_FILE"
else
    CHANGELOG_ARGS=(--version "$TARGET_VERSION" --output "$CHANGELOG" --notes "$NOTES_FILE")
    [[ -z "$PREVIOUS_TAG" ]] || CHANGELOG_ARGS+=(--from "$PREVIOUS_TAG")
    "$SCRIPT_DIR/changelog.sh" "${CHANGELOG_ARGS[@]}"
fi

git add -u
if [[ "$CHANGELOG" != "false" && -f "$CHANGELOG" ]]; then
    git add -- "$CHANGELOG"
fi
if ! git diff --cached --quiet; then
    git commit -m "chore(release): ${TAG}"
fi

git tag -a "$TAG" -m "$TAG"
release_info "Created ${TAG}"
if [[ -n "$MOVING_TAG_OUTPUT" ]]; then
    for moving_tag in "${MOVING_TAG_NAMES[@]}"; do
        git tag -fa "$moving_tag" "${TAG}^{}" -m "${moving_tag} -> ${TAG}"
        release_info "Updated ${moving_tag} -> ${TAG}"
    done
fi

if $PUBLISH; then
    github_args=("$TAG" "$NOTES_FILE")
    [[ "$TARGET_VERSION" == *-rc.* ]] && github_args+=(--prerelease)
    "$SCRIPT_DIR/github.sh" "${github_args[@]}"
else
    release_info "Local release complete; publish later with release:github ${TAG}"
fi

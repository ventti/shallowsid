#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/common.sh"
# shellcheck source=lib/version.sh
source "$SCRIPT_DIR/version.sh"

ROOT=$(release_project_root)
cd "$ROOT"

failed=false
warnings=false
gh_authenticated=false
origin_configured=false

doctor_warn() {
    printf 'WARN %s\n' "$*" >&2
    warnings=true
}

doctor_check_hook() {
    local name=$1
    local value=$2
    local first
    [[ -n "$value" ]] || return 0
    printf 'cfg %s: %s\n' "$name" "$value"
    if ! bash -n -c "$value" >/dev/null 2>&1; then
        printf 'ERR %s has invalid Bash syntax\n' "$name" >&2
        failed=true
        return
    fi
    first=${value%%[[:space:]]*}
    first=${first#\"}; first=${first%\"}
    first=${first#\'}; first=${first%\'}
    if [[ "$first" == *=* ]]; then
        doctor_warn "$name starts with an environment assignment; executable resolution skipped"
    elif command -v "$first" >/dev/null 2>&1 || [[ -x "$first" ]]; then
        printf 'ok  %s executable: %s\n' "$name" "$first"
    else
        printf 'ERR %s executable not found: %s\n' "$name" "$first" >&2
        failed=true
    fi
}

for command in bash git; do
    if command -v "$command" >/dev/null 2>&1; then
        printf 'ok  %s\n' "$command"
    else
        printf 'ERR %s is not installed\n' "$command" >&2
        failed=true
    fi
done

if command -v gh >/dev/null 2>&1; then
    printf 'ok  gh\n'
elif command -v mise >/dev/null 2>&1; then
    printf 'ok  gh (mise-managed gh@2 fallback)\n'
else
    printf 'ERR gh is not installed and mise is unavailable\n' >&2
    failed=true
fi

if release_gh_available; then
    if release_gh auth status >/dev/null 2>&1; then
        printf 'ok  GitHub CLI authentication\n'
        gh_authenticated=true
    else
        printf 'ERR GitHub CLI is not authenticated; run gh auth login (or mise exec gh@2 -- gh auth login)\n' >&2
        failed=true
    fi
fi

if git remote get-url origin >/dev/null 2>&1; then
    printf 'ok  origin: %s\n' "$(git remote get-url origin)"
    origin_configured=true
else
    printf 'ERR origin remote is not configured\n' >&2
    failed=true
fi

if $gh_authenticated && $origin_configured; then
    if can_push=$(release_gh api 'repos/{owner}/{repo}' --jq '.permissions.push' 2>/dev/null) && \
       [[ -n "$can_push" ]]; then
        if [[ "$can_push" == "true" ]]; then
            printf 'ok  GitHub repository permission: WRITE\n'
        elif [[ "${GITHUB_ACTIONS:-}" == "true" ]] && \
             push_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) && \
             git push --dry-run origin "HEAD:refs/heads/${push_branch}" >/dev/null 2>&1; then
            printf 'ok  GitHub repository permission: WRITE (Actions Git dry-run)\n'
        else
            printf 'ERR GitHub repository permission is read-only; WRITE is required\n' >&2
            failed=true
        fi
    else
        printf 'ERR authenticated GitHub account cannot access the origin repository\n' >&2
        failed=true
    fi
fi

if branch=$(release_assert_branch 2>/dev/null); then
    printf 'ok  release branch: %s\n' "$branch"
else
    printf 'ERR current branch is not eligible for releases\n' >&2
    failed=true
fi

TAG_PREFIX=${RELEASE_TAG_PREFIX-v}
LATEST_TAG=$(release_latest_stable_tag "$TAG_PREFIX" || true)
INCOMPATIBLE_TAG=""
while IFS= read -r tag; do
    candidate=${tag#v}
    version=$(release_normalize_version "$candidate" 2>/dev/null || true)
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
    if ! release_version_from_tag "$tag" "$TAG_PREFIX" >/dev/null 2>&1; then
        INCOMPATIBLE_TAG=$tag
        break
    fi
done < <(git tag --list --sort=-version:refname)
if [[ -n "$LATEST_TAG" ]]; then
    printf 'ok  latest release tag: %s\n' "$LATEST_TAG"
else
    printf 'ok  no previous release tags matching configured prefix\n'
fi
if [[ -n "$INCOMPATIBLE_TAG" ]]; then
    doctor_warn "existing tag '$INCOMPATIBLE_TAG' does not match RELEASE_TAG_PREFIX='${TAG_PREFIX}'"
fi

MOVING_TAGS=${RELEASE_MOVING_TAGS:-}
if [[ -z "$MOVING_TAGS" || "$MOVING_TAGS" == "none" ]]; then
    printf 'ok  moving tags: disabled\n'
else
    MOVING_VERSION=0.0.0
    [[ -z "$LATEST_TAG" ]] || MOVING_VERSION=$(release_version_from_tag "$LATEST_TAG" "$TAG_PREFIX")
    if MOVING_TAG_OUTPUT=$(release_moving_tags "$MOVING_VERSION" "$TAG_PREFIX" "$MOVING_TAGS"); then
        printf 'ok  moving tags: %s' "${MOVING_TAGS//,/ }"
        [[ -z "$LATEST_TAG" ]] || printf ' (current aliases: %s)' "$(printf '%s' "$MOVING_TAG_OUTPUT" | paste -sd ' ' -)"
        printf '\n'
    else
        printf 'ERR RELEASE_MOVING_TAGS must contain only major and/or minor\n' >&2
        failed=true
    fi
fi

if [[ -n "${RELEASE_GET_VERSION:-}" ]]; then
    if version=$(bash -o pipefail -c "$RELEASE_GET_VERSION" 2>/dev/null); then
        printf 'ok  package version: %s\n' "$(release_trim "$version")"
    else
        printf 'ERR RELEASE_GET_VERSION failed\n' >&2
        failed=true
    fi
else
    printf 'ok  tag-based versioning\n'
fi

doctor_check_hook RELEASE_CHECK_COMMAND "${RELEASE_CHECK_COMMAND:-}"
doctor_check_hook RELEASE_BUILD_COMMAND "${RELEASE_BUILD_COMMAND:-}"
doctor_check_hook RELEASE_CHANGELOG_COMMAND "${RELEASE_CHANGELOG_COMMAND:-}"

if [[ -n "${RELEASE_ARTIFACTS:-}" ]]; then
    MISSING_ARTIFACTS=()
    for pattern in $RELEASE_ARTIFACTS; do
        MATCHED=false
        while IFS= read -r file; do
            [[ -f "$file" ]] && MATCHED=true
        done < <(compgen -G "$pattern" || true)
        $MATCHED || MISSING_ARTIFACTS+=("$pattern")
    done
    if [[ ${#MISSING_ARTIFACTS[@]} -gt 0 ]]; then
        if [[ -n "${RELEASE_BUILD_COMMAND:-}" ]]; then
            doctor_warn "artifacts currently missing (build must create them): ${MISSING_ARTIFACTS[*]}"
        else
            printf 'ERR artifact patterns match no files: %s\n' "${MISSING_ARTIFACTS[*]}" >&2
            failed=true
        fi
    else
        printf 'ok  release artifacts exist\n'
    fi
fi

DROPBOX_CONFIG=${RELEASE_DROPBOX_CONFIG:-$ROOT/.dropboxuploader}
if [[ -n "${RELEASE_DROPBOX_PATH:-}" || -n "${RELEASE_DROPBOX_CONFIG:-}" || -e "$DROPBOX_CONFIG" ]]; then
    if [[ -s "$DROPBOX_CONFIG" ]]; then
        printf 'ok  Dropbox credentials: %s\n' "$DROPBOX_CONFIG"
    else
        printf 'ERR Dropbox credentials not found: %s\n' "$DROPBOX_CONFIG" >&2
        failed=true
    fi
    if [[ -n "${RELEASE_DROPBOX_PATH:-}" ]]; then
        printf 'ok  Dropbox path: %s\n' "$RELEASE_DROPBOX_PATH"
    else
        printf 'ERR RELEASE_DROPBOX_PATH must be set when Dropbox is configured\n' >&2
        failed=true
    fi
fi

if $failed; then
    printf 'Release readiness checks failed; resolve the ERR lines above.\n' >&2
    exit 1
fi
if $warnings; then
    printf 'Ready to release with warnings.\n'
else
    printf 'Ready to release.\n'
fi

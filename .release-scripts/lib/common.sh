#!/usr/bin/env bash

release_error() {
    printf 'ERROR: %s\n' "$*" >&2
}

release_die() {
    release_error "$*"
    exit 1
}

release_info() {
    printf '%s\n' "$*"
}

release_project_root() {
    git rev-parse --show-toplevel 2>/dev/null || release_die "not inside a Git repository"
}

release_current_branch() {
    git symbolic-ref --quiet --short HEAD 2>/dev/null || \
        release_die "releases cannot be created from a detached HEAD"
}

release_default_branch() {
    local ref branch
    ref=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)
    if [[ -n "$ref" ]]; then
        printf '%s\n' "${ref#refs/remotes/origin/}"
        return 0
    fi

    branch=$(git ls-remote --symref origin HEAD 2>/dev/null | \
        sed -n 's/^ref: refs\/heads\/\([^[:space:]]*\)[[:space:]]*HEAD$/\1/p' | head -1) || true
    if [[ -n "$branch" ]]; then
        printf '%s\n' "$branch"
        return 0
    fi

    if release_gh_available && git remote get-url origin >/dev/null 2>&1; then
        branch=$(release_gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || true)
        if [[ -n "$branch" ]]; then
            printf '%s\n' "$branch"
            return 0
        fi
    fi

    return 1
}

release_assert_branch() {
    local branch pattern regex default_branch
    branch=$(release_current_branch)
    pattern=${RELEASE_BRANCH_PATTERN:-}

    if [[ -n "$pattern" ]]; then
        regex="^(${pattern})$"
        if [[ "$branch" =~ $regex ]]; then
            printf '%s\n' "$branch"
            return 0
        else
            release_die "branch '$branch' does not match RELEASE_BRANCH_PATTERN: $pattern"
        fi
    fi

    default_branch=$(release_default_branch) || \
        release_die "cannot determine the default branch; set RELEASE_BRANCH_PATTERN explicitly"
    [[ "$branch" == "$default_branch" ]] || \
        release_die "releases must be created from the default branch '$default_branch' (current: '$branch')"
    printf '%s\n' "$branch"
}

release_require_command() {
    command -v "$1" >/dev/null 2>&1 || release_die "required command not found: $1"
}

release_gh_available() {
    command -v gh >/dev/null 2>&1 || command -v mise >/dev/null 2>&1
}

release_gh() {
    if command -v gh >/dev/null 2>&1; then
        command gh "$@"
    elif command -v mise >/dev/null 2>&1; then
        mise exec gh@2 -- gh "$@"
    else
        release_error "GitHub CLI is unavailable; install gh or mise"
        return 127
    fi
}

release_run_hook() {
    local label=$1
    local command=$2
    [[ -n "$command" ]] || return 0
    release_info "==> ${label}"
    bash -o pipefail -c "$command"
}

release_trim() {
    local value=$1
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s' "$value"
}

release_expand_artifacts() {
    local patterns=${RELEASE_ARTIFACTS:-}
    local pattern file found=false
    RELEASE_ASSET_FILES=()

    [[ -n "$patterns" ]] || return 0
    for pattern in $patterns; do
        found=false
        while IFS= read -r file; do
            [[ -f "$file" ]] || continue
            RELEASE_ASSET_FILES+=("$file")
            found=true
        done < <(compgen -G "$pattern" || true)
        $found || release_die "artifact pattern matched no files: $pattern"
    done
}

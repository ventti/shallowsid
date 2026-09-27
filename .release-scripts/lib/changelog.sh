#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/common.sh"
# shellcheck source=lib/version.sh
source "$SCRIPT_DIR/version.sh"

usage() {
    cat <<'EOF'
Usage: changelog.sh [--version VERSION] [--from TAG] [--output FILE] [--notes FILE]

Generate a Markdown changelog entry from Git commits, grouped by Conventional
Commit type. VERSION defaults to Unreleased and FILE defaults to CHANGELOG.md.
A stable X.Y.Z version replaces the release-candidate entries it supersedes, so
it defaults to covering commits from the latest stable tag.
EOF
}

VERSION="Unreleased"
FROM_TAG=""
OUTPUT=${RELEASE_CHANGELOG:-CHANGELOG.md}
NOTES=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) [[ $# -ge 2 ]] || release_die "--version requires a value"; VERSION=$2; shift 2 ;;
        --from) [[ $# -ge 2 ]] || release_die "--from requires a value"; FROM_TAG=$2; shift 2 ;;
        --output) [[ $# -ge 2 ]] || release_die "--output requires a value"; OUTPUT=$2; shift 2 ;;
        --notes) [[ $# -ge 2 ]] || release_die "--notes requires a value"; NOTES=$2; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) release_die "unknown argument: $1" ;;
    esac
done

ROOT=$(release_project_root)
cd "$ROOT"

# A stable release documents the whole candidate line it concludes, so the
# superseded rc entries can be dropped without losing their commits.
DROP_PRERELEASES=false
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && DROP_PRERELEASES=true

if [[ -z "$FROM_TAG" ]]; then
    if $DROP_PRERELEASES; then
        FROM_TAG=$(release_latest_stable_tag "${RELEASE_TAG_PREFIX-v}" || true)
    fi
    [[ -n "$FROM_TAG" ]] || FROM_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
fi

RANGE=HEAD
[[ -z "$FROM_TAG" ]] || RANGE="${FROM_TAG}..HEAD"
# Release commits are made by this tool and document nothing on their own.
LOG_ARGS=("$RANGE" --extended-regexp --invert-grep --grep='^chore\(release\): ')
ENTRY=$(mktemp "${TMPDIR:-/tmp}/release-changelog.XXXXXX")
UPDATED=$(mktemp "${TMPDIR:-/tmp}/release-changelog-updated.XXXXXX")
COMMITS=$(mktemp "${TMPDIR:-/tmp}/release-changelog-commits.XXXXXX")
HISTORY=$(mktemp "${TMPDIR:-/tmp}/release-changelog-history.XXXXXX")
trap 'rm -f "$ENTRY" "$UPDATED" "$COMMITS" "$HISTORY"' EXIT

# Commit links stay relative so they resolve on any GitHub host or fork. From
# <repo>/blob/<ref>/<changelog>, two levels up is the repository root.
LINK_PREFIX=../..
LINK_DIR=$(dirname "$OUTPUT")
while [[ "$LINK_DIR" != . && "$LINK_DIR" != / && -n "$LINK_DIR" ]]; do
    LINK_PREFIX="../${LINK_PREFIX}"
    LINK_DIR=$(dirname "$LINK_DIR")
done

# Commits are bucketed by Conventional Commit type; anything unprefixed is other.
# The order lists the types named by Conventional Commits 1.0.0 by how much they
# concern a reader of the changelog, leaving the tooling types last.
TAB=$'\t'
TYPE_ORDER=(feat fix docs perf refactor test style build ci chore)
TYPE_PATTERN='^([a-zA-Z][a-zA-Z0-9_-]*)(\(([^)]+)\))?(!)?:[[:space:]]+(.*)$'
git log "${LOG_ARGS[@]}" --pretty=tformat:'%h%x1f%H%x1f%s' > "$HISTORY" || \
    release_die "could not read Git history"
while IFS=$'\x1f' read -r short full subject; do
    type=other
    scope=""
    breaking=""
    text=$subject
    if [[ "$subject" =~ $TYPE_PATTERN ]]; then
        type=$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')
        scope=${BASH_REMATCH[3]}
        breaking=${BASH_REMATCH[4]}
        text=${BASH_REMATCH[5]}
    fi
    # Breaking changes lead the entry, so they keep their type in the label.
    bucket=$type
    label=$scope
    if [[ -n "$breaking" ]]; then
        bucket=breaking
        label=$type
        [[ -z "$scope" ]] || label="${type}(${scope})"
    fi
    item="- "
    [[ -z "$label" ]] || item="${item}**${label}:** "
    item="${item}${text} ([\`${short}\`](${LINK_PREFIX}/commit/${full}))"
    printf '%s%s%s\n' "$bucket" "$TAB" "$item" >> "$COMMITS"
done < "$HISTORY"

group_present() {
    grep -q "^${1}${TAB}" "$COMMITS"
}

# Breaking changes lead, then the known types, then project-specific types
# alphabetically, and finally the commits with no Conventional Commit type.
TYPE_GROUPS=()
if group_present breaking; then
    TYPE_GROUPS+=(breaking)
fi
for type in "${TYPE_ORDER[@]}"; do
    if group_present "$type"; then
        TYPE_GROUPS+=("$type")
    fi
done
while IFS= read -r type; do
    [[ -n "$type" ]] || continue
    case " ${TYPE_ORDER[*]} breaking other " in
        *" $type "*) continue ;;
    esac
    TYPE_GROUPS+=("$type")
done < <(cut -f1 "$COMMITS" | sort -u)
if group_present other; then
    TYPE_GROUPS+=(other)
fi

{
    printf '## %s - %s\n' "$VERSION" "$(date +%Y-%m-%d)"
    if [[ ${#TYPE_GROUPS[@]} -eq 0 ]]; then
        printf '\n- No user-visible changes.\n'
    else
        for type in "${TYPE_GROUPS[@]}"; do
            printf '\n### %s\n\n' "$type"
            grep "^${type}${TAB}" "$COMMITS" | cut -f2-
        done
    fi
} > "$ENTRY"

if [[ -n "$NOTES" ]]; then
    cp "$ENTRY" "$NOTES"
fi

if [[ "$OUTPUT" != "false" ]]; then
    if [[ -f "$OUTPUT" ]] && grep -Fq "## ${VERSION} -" "$OUTPUT"; then
        release_die "${OUTPUT} already contains version ${VERSION}"
    fi
    if [[ -f "$OUTPUT" ]]; then
        awk -v entry="$ENTRY" -v drop_prereleases="$DROP_PRERELEASES" '
            function insert(   line) {
                while ((getline line < entry) > 0) print line
                close(entry)
            }
            NR == 1 && $0 ~ /^# / { print; print ""; insert(); next }
            NR == 1 { insert(); print "" }
            /^## / {
                skip = drop_prereleases == "true" &&
                    $0 ~ /^## [0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+ /
            }
            skip { next }
            { print }
        ' "$OUTPUT" > "$UPDATED"
    else
        {
            printf '# Changelog\n\n'
            cat "$ENTRY"
        } > "$UPDATED"
    fi
    mv "$UPDATED" "$OUTPUT"
    release_info "Updated ${OUTPUT}"
fi

[[ -n "$NOTES" ]] || cat "$ENTRY"

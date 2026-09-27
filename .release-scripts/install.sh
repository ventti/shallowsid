#!/usr/bin/env bash
set -euo pipefail

REPOSITORY=${RELEASE_SCRIPTS_REPOSITORY:-https://github.com/superteppo/release-scripts.git}
ARCHIVE_BASE=${RELEASE_SCRIPTS_ARCHIVE_BASE:-https://github.com/superteppo/release-scripts/archive}
VERSION=latest
TARGET=

usage() {
    cat <<'EOF'
Usage: install.sh [latest|MAJOR.MINOR|VERSION] [--target DIRECTORY]

Install the standalone release scripts. With no target, scripts are installed
in .release-scripts at the root of the current Git repository.
EOF
}

if [[ $# -gt 0 && "$1" != --* ]]; then
    VERSION=$1
    shift
fi
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)
            [[ $# -ge 2 ]] || { printf 'ERROR: --target requires a directory\n' >&2; exit 1; }
            TARGET=$2
            shift
            ;;
        -h|--help) usage; exit 0 ;;
        *) printf 'ERROR: unknown argument: %s\n' "$1" >&2; usage >&2; exit 1 ;;
    esac
    shift
done

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
    printf 'ERROR: run the installer inside the target Git repository\n' >&2
    exit 1
}
TARGET=${TARGET:-$PROJECT_ROOT/.release-scripts}
case "$TARGET" in
    /|'') printf 'ERROR: unsafe installation target: %s\n' "$TARGET" >&2; exit 1 ;;
esac
TARGET_PARENT=$(cd "$(dirname "$TARGET")" && pwd)
TARGET="$TARGET_PARENT/$(basename "$TARGET")"

TEMP_ROOT=$(mktemp -d "$TARGET_PARENT/.release-scripts-install.XXXXXX")
STAGE="$TEMP_ROOT/stage"
BACKUP="$TEMP_ROOT/backup"
mkdir -p "$STAGE"
cleanup() {
    if [[ -e "$BACKUP" && ! -e "$TARGET" ]]; then
        mv "$BACKUP" "$TARGET"
    fi
    rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

SOURCE_ROOT=${RELEASE_SCRIPTS_SOURCE:-}
REVISION=local
if [[ -z "$SOURCE_ROOT" ]]; then
    command -v curl >/dev/null 2>&1 || { printf 'ERROR: curl is required\n' >&2; exit 1; }
    command -v git >/dev/null 2>&1 || { printf 'ERROR: git is required\n' >&2; exit 1; }

    case "$VERSION" in
        latest)
            TAG=$(git ls-remote --refs --tags "$REPOSITORY" 'refs/tags/v*.*.*' |
                sed -n 's#^[^[:space:]]*[[:space:]]refs/tags/\(v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$#\1#p' |
                sort -V | tail -1)
            [[ -n "$TAG" ]] || { printf 'ERROR: no stable release tags found\n' >&2; exit 1; }
            ;;
        [0-9]*.[0-9]*) TAG="v$VERSION" ;;
        v[0-9]*.[0-9]*) TAG=$VERSION ;;
        *) printf 'ERROR: version must be latest, MAJOR.MINOR, or an exact version\n' >&2; exit 1 ;;
    esac

    REFS=$(git ls-remote "$REPOSITORY" "refs/tags/$TAG" "refs/tags/$TAG^{}")
    REVISION=$(printf '%s\n' "$REFS" | sed -n '/\^{}$/ { s/[[:space:]].*//; p; }' | head -1)
    if [[ -z "$REVISION" ]]; then
        REVISION=$(printf '%s\n' "$REFS" | sed -n '1s/[[:space:]].*//p')
    fi
    [[ -n "$REVISION" ]] || { printf 'ERROR: release channel not found: %s\n' "$TAG" >&2; exit 1; }

    ARCHIVE="$TEMP_ROOT/source.tar.gz"
    curl -fsSL "$ARCHIVE_BASE/$REVISION.tar.gz" -o "$ARCHIVE"
    mkdir -p "$TEMP_ROOT/source"
    tar -xzf "$ARCHIVE" -C "$TEMP_ROOT/source"
    SOURCE_ROOT=$(find "$TEMP_ROOT/source" -mindepth 1 -maxdepth 1 -type d -print -quit)
    [[ -n "$SOURCE_ROOT" ]] || { printf 'ERROR: downloaded archive is empty\n' >&2; exit 1; }
fi

for path in release install.sh lib mise-tasks templates tools LICENSE THIRD_PARTY_NOTICES.md; do
    [[ -e "$SOURCE_ROOT/$path" ]] || { printf 'ERROR: runtime file missing: %s\n' "$path" >&2; exit 1; }
    cp -R "$SOURCE_ROOT/$path" "$STAGE/$path"
done
printf '%s\n' "$VERSION" > "$STAGE/.channel"
printf '%s\n' "$REVISION" > "$STAGE/.revision"
chmod +x "$STAGE/release" "$STAGE/install.sh" "$STAGE/lib/"*.sh "$STAGE/mise-tasks/release/"*

if [[ -e "$TARGET" ]]; then
    mv "$TARGET" "$BACKUP"
fi
if ! mv "$STAGE" "$TARGET"; then
    [[ ! -e "$BACKUP" ]] || mv "$BACKUP" "$TARGET"
    printf 'ERROR: could not install release scripts\n' >&2
    exit 1
fi

printf 'Installed release scripts (%s, %s) in %s\n' "$VERSION" "$REVISION" "$TARGET"
printf 'Run: %s setup\n' "$TARGET/release"

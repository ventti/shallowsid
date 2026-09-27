#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/common.sh"

usage() {
    cat <<'EOF'
Usage: dropbox.sh

Upload RELEASE_ARTIFACTS and the changelog to Dropbox. Configure
RELEASE_DROPBOX_PATH and a .dropboxuploader credentials file first.
EOF
}

case "${1:-}" in
    -h|--help) usage; exit 0 ;;
    "") ;;
    *) release_die "unknown argument: $1" ;;
esac

ROOT=$(release_project_root)
cd "$ROOT"
UPLOADER="$SCRIPT_DIR/../tools/dropbox_uploader.sh"
CONFIG=${RELEASE_DROPBOX_CONFIG:-$ROOT/.dropboxuploader}
PROJECT_NAME=$(basename "$ROOT")
DESTINATION=${RELEASE_DROPBOX_PATH:-$PROJECT_NAME/releases}
[[ -x "$UPLOADER" ]] || release_die "Dropbox uploader is not executable: $UPLOADER"
[[ -s "$CONFIG" ]] || release_die "Dropbox credentials not found: $CONFIG"

VERSION=${RELEASE_VERSION:-}
if [[ -z "$VERSION" && -n "${RELEASE_GET_VERSION:-}" ]]; then
    VERSION=$(bash -o pipefail -c "$RELEASE_GET_VERSION")
    VERSION=$(release_trim "$VERSION")
fi
if [[ -z "$VERSION" ]]; then
    VERSION=$(git describe --tags --abbrev=0 2>/dev/null || true)
fi
[[ -n "$VERSION" ]] || release_die "could not determine the release version"

release_expand_artifacts
[[ ${#RELEASE_ASSET_FILES[@]} -gt 0 ]] || release_die "RELEASE_ARTIFACTS is empty"

dropbox() {
    "$UPLOADER" -f "$CONFIG" "$@" </dev/null
}

dropbox mkdir "$DESTINATION" >/dev/null 2>&1 || true
dropbox mkdir "$DESTINATION/$VERSION" >/dev/null 2>&1 || true
dropbox mkdir "$DESTINATION/latest" >/dev/null 2>&1 || true

for file in "${RELEASE_ASSET_FILES[@]}"; do
    name=$(basename "$file")
    dropbox upload "$file" "$DESTINATION/$VERSION/$name"
    dropbox upload "$file" "$DESTINATION/latest/$name"
done

CHANGELOG=${RELEASE_CHANGELOG:-CHANGELOG.md}
if [[ "$CHANGELOG" != "false" && -f "$CHANGELOG" ]]; then
    dropbox upload "$CHANGELOG" "$DESTINATION/latest/$(basename "$CHANGELOG")"
fi

#!/usr/bin/env bash
# Serve the app with a locally built HVSC catalogue (songs stream from hvsc.c64.org).
# Usage: tools/dev.sh [port] [build_index.py args...]   (e.g. tools/dev.sh 8000 --subset MUSICIANS/H)
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
site="${SHALLOWSID_SITE:-$HOME/.cache/shallowsid/_site}"
port="${1:-8000}"; shift || true
if [[ ! -f "$site/data/index.json" || $# -gt 0 ]]; then
  python3 "$repo/tools/build_index.py" --out "$site" "$@"
fi
for f in index.html css js; do ln -sfn "$repo/$f" "$site/$f"; done
echo "serving $site on http://localhost:$port"
# Like `python3 -m http.server`, but with no-cache so edited modules reload.
exec python3 - "$port" "$site" <<'PY'
import functools, http.server, sys
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
port, root = int(sys.argv[1]), sys.argv[2]
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(NoCache, directory=root)).serve_forever()
PY

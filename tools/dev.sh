#!/usr/bin/env bash
# Serve the app with a locally built HVSC catalogue (songs stream from hvsc.c64.org).
# Usage: tools/dev.sh [--role user|curator|admin] [port] [build_index.py args...]
#   (e.g. tools/dev.sh 8000 --subset MUSICIANS/H, or tools/dev.sh --role admin 8765)
#
# --role starts a Firestore emulator with a test profile in that role. The
# profile and the emulator apply only to http://127.0.0.1:<port>. On
# http://localhost:<port> the app stays as it is, with the real Firestore.
# The emulator needs Java 11+ and keeps no data after it stops.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
site="${SHALLOWSID_SITE:-$HOME/.cache/shallowsid/_site}"
role=""
if [[ "${1:-}" == "--role" ]]; then
  role="${2:?--role needs user, curator or admin}"; shift 2
  [[ "$role" =~ ^(user|curator|admin)$ ]] || { echo "--role must be user, curator or admin" >&2; exit 2; }
fi
port="${1:-8000}"; shift || true
if [[ ! -f "$site/data/index.json" || $# -gt 0 ]]; then
  python3 "$repo/tools/build_index.py" --out "$site" "$@"
fi
for f in index.html favicon.ico privacy.html about.html manifest.webmanifest service-worker.js icons css js; do ln -sfn "$repo/$f" "$site/$f"; done

profile=""
emulator_port=8089
if [[ -n "$role" ]]; then
  # A broken Java shim (for example jenv) falls back to the newest installed JDK.
  if ! java -version >/dev/null 2>&1 && [[ -x /usr/libexec/java_home ]]; then
    export JAVA_HOME="$(/usr/libexec/java_home)"; export PATH="$JAVA_HOME/bin:$PATH"
  fi
  python3 "$repo/tools/build_rules.py"
  log="$(mktemp -t shallowsid-emulator)"
  (cd "$repo" && exec npx -y firebase-tools@15.31.0 emulators:start --only firestore --project demo-shallowsid) >"$log" 2>&1 &
  emulator=$!
  trap 'kill "$emulator" 2>/dev/null || true' EXIT
  echo "starting the Firestore emulator (log: $log)"
  until curl -s -o /dev/null "http://127.0.0.1:$emulator_port/"; do
    kill -0 "$emulator" 2>/dev/null || { echo "The Firestore emulator stopped. See $log" >&2; exit 1; }
    sleep 0.5
  done
  profile="$(node "$repo/tools/dev_profile.mjs" "$role" "http://127.0.0.1:$emulator_port")"
  echo "role $role: http://127.0.0.1:$port (emulator), real profile: http://localhost:$port"
fi

echo "serving $site on http://localhost:$port"
# Like `python3 -m http.server`, but with no-cache so edited modules reload.
# With --role, requests to 127.0.0.1 get the emulator config and the test profile.
python3 - "$port" "$site" "$profile" "$emulator_port" <<'PY'
import functools, http.server, json, sys
port, root, profile, emulator_port = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
CONFIG = ('export const FIREBASE = { apiKey: "dev", projectId: "demo-shallowsid", '
          f'endpoint: "http://127.0.0.1:{emulator_port}" }};\n')
PROFILE = ('// tools/dev.sh --role: the test profile for this origin.\n'
           f'const profile = {profile or "{}"};\n'
           'const key = "shallowsid.curation";\n'
           'let state = {};\n'
           'try { state = JSON.parse(localStorage.getItem(key)) ?? {}; } catch {}\n'
           'if (!profile.cid) localStorage.removeItem(key);\n'
           'else if (state.cid !== profile.cid) localStorage.setItem(key, JSON.stringify(profile));\n')

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_text(self, body, content_type):
        data = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if profile and self.headers.get("Host", "").startswith("127.0.0.1"):
            if path == "/js/sync-config.js":
                return self.send_text(CONFIG, "text/javascript")
            if path == "/dev-profile.js":
                return self.send_text(PROFILE, "text/javascript")
            if path in ("/", "/index.html"):
                html = open(f"{root}/index.html", encoding="utf-8").read()
                html = html.replace('<script src="js/ionic-config.js">', '<script src="dev-profile.js"></script>\n  <script src="js/ionic-config.js">', 1)
                return self.send_text(html, "text/html; charset=utf-8")
        super().do_GET()

http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(NoCache, directory=root)).serve_forever()
PY

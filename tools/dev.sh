#!/usr/bin/env bash
# Serve the app with a locally built HVSC catalogue (songs stream from hvsc.c64.org).
# Usage: tools/dev.sh [--no-emulator] [port] [build_index.py args...]
#   (e.g. tools/dev.sh 8000 --subset MUSICIANS/H)
#
# A Firestore emulator starts in the background with test profiles. Open
# http://127.0.0.1:<port>/?role=user|curator|admin to use one; on that
# address the app uses only the emulator. http://localhost:<port> stays as
# it is, with your own profile and the real Firestore. The emulator needs
# Java 11+ and keeps no data after it stops. --no-emulator turns it off.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
site="${SHALLOWSID_SITE:-$HOME/.cache/shallowsid/_site}"
emulator_on=1
if [[ "${1:-}" == "--no-emulator" ]]; then emulator_on=0; shift; fi
port="${1:-8000}"; shift || true
if [[ ! -f "$site/data/index.json" || $# -gt 0 ]]; then
  python3 "$repo/tools/build_index.py" --out "$site" "$@"
fi
for f in index.html favicon.ico privacy.html about.html manifest.webmanifest service-worker.js icons css js; do ln -sfn "$repo/$f" "$site/$f"; done

profiles=""
emulator_port=8089
if (( emulator_on )); then
  # A broken Java shim (for example jenv) falls back to the newest installed JDK.
  if ! java -version >/dev/null 2>&1 && [[ -x /usr/libexec/java_home ]]; then
    export JAVA_HOME="$(/usr/libexec/java_home)"; export PATH="$JAVA_HOME/bin:$PATH"
  fi
  python3 "$repo/tools/build_rules.py" >/dev/null
  profiles="$(node "$repo/tools/dev_profile.mjs")"
  log="$(mktemp -t shallowsid-emulator)"
  (cd "$repo" && exec npx -y firebase-tools@15.31.0 emulators:start --only firestore --project demo-shallowsid) >"$log" 2>&1 &
  emulator=$!
  trap 'kill "$emulator" 2>/dev/null || true' EXIT
  # Write the test profiles when the emulator is up; the site serves meanwhile.
  (
    until curl -s -o /dev/null "http://127.0.0.1:$emulator_port/"; do
      kill -0 "$emulator" 2>/dev/null || { echo "The Firestore emulator stopped. See $log" >&2; exit 1; }
      sleep 0.5
    done
    node "$repo/tools/dev_profile.mjs" "http://127.0.0.1:$emulator_port" >/dev/null \
      && echo "emulator ready: http://127.0.0.1:$port/?role=user|curator|admin"
  ) &
  echo "starting the Firestore emulator (log: $log)"
fi

echo "serving $site on http://localhost:$port"
# Like `python3 -m http.server`, but with no-cache so edited modules reload.
# Requests to 127.0.0.1 get the emulator config and the test profiles.
python3 - "$port" "$site" "$profiles" "$emulator_port" <<'PY'
import functools, http.server, sys
port, root, profiles, emulator_port = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
CONFIG = ('export const FIREBASE = { apiKey: "dev", projectId: "demo-shallowsid", '
          f'endpoint: "http://127.0.0.1:{emulator_port}" }};\n')
# ?role= picks a profile; with no ?role=, the stored one stays.
PROFILE = ('// tools/dev.sh: the test profiles for this origin (?role=user|curator|admin).\n'
           f'const profiles = {profiles};\n'
           'const role = new URLSearchParams(location.search).get("role");\n'
           'const key = "shallowsid.curation";\n'
           'if (role in profiles) {\n'
           '  let state = {};\n'
           '  try { state = JSON.parse(localStorage.getItem(key)) ?? {}; } catch {}\n'
           '  if (!profiles[role].cid) localStorage.removeItem(key);\n'
           '  else if (state.cid !== profiles[role].cid) localStorage.setItem(key, JSON.stringify(profiles[role]));\n'
           '} else if (role) console.warn(`dev.sh: unknown role "${role}"`);\n')

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
        path, _, query = self.path.partition("?")
        host = self.headers.get("Host", "")
        if profiles and path in ("/", "/index.html") and "role=" in query and not host.startswith("127.0.0.1"):
            # Keep your own profile on localhost: test profiles live on 127.0.0.1.
            self.send_response(302)
            self.send_header("Location", f"http://127.0.0.1:{port}{self.path}")
            self.end_headers()
            return
        if profiles and host.startswith("127.0.0.1"):
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

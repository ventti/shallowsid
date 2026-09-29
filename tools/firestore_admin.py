"""Firestore REST with admin (IAM) credentials, for the tag tools.

These requests aren't bound by firestore.rules: they use your gcloud login
(`gcloud auth print-access-token`), or GOOGLE_OAUTH_ACCESS_TOKEN (a service
account in CI). With FIRESTORE_EMULATOR_HOST set they go to the emulator.
"""

import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def default_project():
    config = (REPO / "js" / "sync-config.js").read_text()
    match = re.search(r'projectId:\s*"([^"]+)"', config)
    return match.group(1) if match else None


def access_token():
    """(token, from_ci): GOOGLE_OAUTH_ACCESS_TOKEN (a service account in CI) or your gcloud login."""
    token = os.environ.get("GOOGLE_OAUTH_ACCESS_TOKEN")
    if token:
        return token, True
    try:
        return subprocess.run(["gcloud", "auth", "print-access-token"], check=True, capture_output=True, text=True).stdout.strip(), False
    except (OSError, subprocess.CalledProcessError) as err:
        raise SystemExit(f"Couldn't get a gcloud access token ({err}); run `gcloud auth login` first")


def call(method, url, token, body=None, project=None, retries=3):
    """JSON over HTTPS, retrying server errors. None for a 404 on GET."""
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    # A user login needs a quota project; a service account uses its own.
    if project:
        headers["X-Goog-User-Project"] = project
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.load(res)
        except urllib.error.HTTPError as err:
            if err.code == 404 and method == "GET":
                return None
            if err.code >= 500 and attempt < retries - 1:
                time.sleep(2 ** attempt * 5)
                continue
            raise SystemExit(f"{method} {url}: HTTP {err.code} {err.read().decode(errors='replace')}")
        except urllib.error.URLError as err:
            if attempt < retries - 1:
                time.sleep(2 ** attempt * 5)
                continue
            raise SystemExit(f"{method} {url}: {err}")


class Firestore:
    def __init__(self, project=None):
        self.project = project or default_project()
        if not self.project:
            raise SystemExit("No Firebase project: pass --project or fill in js/sync-config.js")
        emulator = os.environ.get("FIRESTORE_EMULATOR_HOST")
        self.endpoint = f"http://{emulator}" if emulator else "https://firestore.googleapis.com"
        self.token, from_ci = ("owner", True) if emulator else access_token()
        self.quota_project = None if from_ci else self.project
        self.root = f"projects/{self.project}/databases/(default)/documents"

    def request(self, method, path, body=None, params=""):
        return call(method, f"{self.endpoint}/v1/{self.root}{path}{params}", self.token, body, self.quota_project)

    def get(self, collection, doc_id):
        return self.request("GET", f"/{collection}/{doc_id}")

    def patch(self, collection, doc_id, fields, mask=None):
        params = "?" + "&".join(f"updateMask.fieldPaths={f}" for f in mask) if mask else ""
        return self.request("PATCH", f"/{collection}/{doc_id}", {"fields": fields}, params)

    def list(self, collection):
        token = ""
        while True:
            page = self.request("GET", f"/{collection}", params=f"?pageSize=300{'&pageToken=' + token if token else ''}")
            yield from (page or {}).get("documents", [])
            token = (page or {}).get("nextPageToken")
            if not token:
                return


def s(value):
    return {"stringValue": value}


def value(field):
    """A Firestore REST value as plain Python."""
    if field is None:
        return None
    if "stringValue" in field:
        return field["stringValue"]
    if "integerValue" in field:
        return int(field["integerValue"])
    if "booleanValue" in field:
        return field["booleanValue"]
    if "timestampValue" in field:
        return field["timestampValue"]
    if "arrayValue" in field:
        return [value(v) for v in field["arrayValue"].get("values", [])]
    return None

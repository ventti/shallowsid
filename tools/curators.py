#!/usr/bin/env python3
"""Manage ShallowSID's tag curators with your Firebase admin (gcloud) login.

Admins can only be made here: an admin invite link is opened in ShallowSID on
the admin's device, which then invites curators from its Curation page.

Usage:
  tools/curators.py invite --role admin [--days 14] [--site URL]
  tools/curators.py invite                  # a curator invite
  tools/curators.py list
  tools/curators.py revoke <curator id>     # works for admins too
"""

import argparse
import datetime
import hashlib
import secrets

from firestore_admin import Firestore, s, value

SITE = "https://ventti.github.io/shallowsid/"


def invite(db, role, days, site):
    secret = secrets.token_hex(16)
    doc_id = hashlib.sha256(secret.encode()).hexdigest()
    exp = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=days)
    db.patch("invites", doc_id, {
        "role": s(role), "by": s("cli"), "used": {"nullValue": None},
        "exp": {"timestampValue": exp.isoformat().replace("+00:00", "Z")},
    })
    print(f"{role} invite, works once until {exp:%Y-%m-%d}:")
    print(f"{site.rstrip('/')}/#/curate/{secret}")


def list_curators(db):
    for doc in db.list("curators"):
        f = doc.get("fields", {})
        cid = doc["name"].rsplit("/", 1)[1]
        state = "active" if value(f.get("active")) else "revoked"
        print(f"{cid}  {value(f.get('role')):8}  {state:8}  steps {value(f.get('n'))}  invite {value(f.get('invite'))[:12]}…")


def revoke(db, cid):
    if not db.get("curators", cid):
        raise SystemExit(f"No curator {cid}")
    db.patch("curators", cid, {"active": {"booleanValue": False}, "revokedBy": s("cli")}, mask=["active", "revokedBy"])
    print(f"Revoked {cid}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", help="Firebase project (default: from js/sync-config.js)")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("invite", help="print a one-time invite link")
    p.add_argument("--role", choices=["curator", "admin"], default="curator")
    p.add_argument("--days", type=int, default=14, choices=range(1, 15), metavar="1-14")
    p.add_argument("--site", default=SITE)
    sub.add_parser("list", help="list curators and admins")
    p = sub.add_parser("revoke", help="take a curator's or admin's rights")
    p.add_argument("cid")
    args = parser.parse_args()
    db = Firestore(args.project)
    if args.command == "invite":
        invite(db, args.role, args.days, args.site)
    elif args.command == "list":
        list_curators(db)
    else:
        revoke(db, args.cid)


if __name__ == "__main__":
    main()

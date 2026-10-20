// The local test profiles for tools/dev.sh (?role=user|curator|admin).
// Usage: node tools/dev_profile.mjs [emulator URL]
// Prints the curation state for each role: {user: {}, curator: {seed, cid,
// role}, admin: {...}}. With an emulator URL, it also writes the curator
// and admin records there. The seeds are fixed, so the profiles stay the
// same from one start to the next.
import { createHash } from "node:crypto";
import { curatorId, inviteHash, str, int, bool } from "../js/tags-core.js";
import { ownerHash, tokenFor } from "../js/live-share-core.js";

const endpoint = process.argv[2];
const profiles = { user: {} };
for (const role of ["curator", "admin"]) {
  const seed = createHash("sha256").update(`shallowsid-dev-${role}`).digest("hex");
  profiles[role] = { seed, cid: await curatorId(seed), role };
}
if (endpoint) {
  const docs = `${endpoint}/v1/projects/demo-shallowsid/databases/(default)/documents`;
  for (const { seed, cid, role } of [profiles.curator, profiles.admin]) {
    // "Bearer owner" lets the emulator write past the rules.
    const res = await fetch(`${docs}/curators/${cid}`, {
      method: "PATCH",
      headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { owner: str(await ownerHash(await tokenFor(seed, 0))), n: int(0), role: str(role), active: bool(true), invite: str(await inviteHash(`dev-${role}`)) } }),
    });
    if (!res.ok) {
      console.error(`Could not write the ${role} profile: ${await res.text()}`);
      process.exit(1);
    }
  }
}
console.log(JSON.stringify(profiles));

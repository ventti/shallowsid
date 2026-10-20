// Puts a local test profile in the Firestore emulator for `tools/dev.sh --role`.
// Usage: node tools/dev_profile.mjs <user|curator|admin> [emulator URL]
// Prints the curation state for the browser: {seed, cid, role}, or {} for a
// plain user. The seed is fixed per role, so the profile stays the same
// from one start to the next.
import { createHash } from "node:crypto";
import { curatorId, inviteHash, str, int, bool } from "../js/tags-core.js";
import { ownerHash, tokenFor } from "../js/live-share-core.js";

const [role, endpoint = "http://127.0.0.1:8089"] = process.argv.slice(2);
if (!["user", "curator", "admin"].includes(role)) {
  console.error("Usage: node tools/dev_profile.mjs <user|curator|admin> [emulator URL]");
  process.exit(2);
}
if (role === "user") {
  console.log("{}");
  process.exit(0);
}
const seed = createHash("sha256").update(`shallowsid-dev-${role}`).digest("hex");
const cid = await curatorId(seed);
const docs = `${endpoint}/v1/projects/demo-shallowsid/databases/(default)/documents`;
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
console.log(JSON.stringify({ seed, cid, role }));

// Runs the real firestore.rules in the Firestore emulator against TagService
// and hand-made attacks. Needs Java 11+; from the repo root:
//   npx firebase-tools emulators:exec \
//     --only firestore --project demo-shallowsid "node tests/rules/rules-check.mjs"
import assert from "node:assert/strict";
const REPO = new URL("../..", import.meta.url).href.replace(/\/$/, "");
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
globalThis.location = { origin: "https://example.test", pathname: "/shallowsid/" };
const core = await import(REPO + "/js/tags-core.js");
const { TagService } = await import(REPO + "/js/tags.js");
const { readFileSync } = await import("node:fs");
const vocabJSON = JSON.parse(readFileSync(new URL("../../js/tags-vocab.json", import.meta.url)));
const EP = "http://127.0.0.1:8089", P = "demo-shallowsid";
const DOCS = EP + "/v1/projects/" + P + "/databases/(default)/documents";
const config = { apiKey: "x", projectId: P, endpoint: EP };
const owner = (path, fields) => fetch(DOCS + "/" + path, { method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields }) }).then(async (r) => assert.ok(r.ok, await r.text()));
const svc = (k) => new TagService({ config, storageKey: k, fetchJSON: async (u) => { if (u.endsWith("vocab.json")) return vocabJSON; throw new Error("none"); } });
const results = [];
const expect = async (label, promise, ok) => {
  try { await promise; results.push([label, ok ? "PASS" : "FAIL (allowed)"]); }
  catch (e) { results.push([label, ok ? "FAIL: " + e.message : "PASS (denied)"]); }
};
const rawCommit = (writes) => fetch(DOCS + ":commit?key=x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ writes }) }).then(async (r) => { if (!r.ok) throw new Error(await r.text()); });
const ids = vocabJSON.groups.flatMap((g) => g.tags.map((t) => t.id));
await owner("config/vocab", { ids: { arrayValue: { values: ids.map((s) => ({ stringValue: s })) } } });
const invite = async (role, secret, ms) => owner("invites/" + await core.inviteHash(secret), { role: { stringValue: role }, by: { stringValue: "cli" }, exp: { timestampValue: new Date(Date.now() + ms).toISOString() }, used: { nullValue: null } });
const TUNE = "MUSICIANS/H/Hubbard_Rob/Commando.sid";
const DAY = 86_400_000;

const admin = svc("a"); await admin.init();
await invite("admin", "a".repeat(32), 14 * DAY);
await expect("admin claims CLI invite", admin.claim("a".repeat(32)), true);
let link; await expect("admin creates invite", admin.createInvite("Rob").then((l) => (link = l)), true);
const cur = svc("c"); await cur.init();
await expect("curator claims admin invite", cur.claim(core.parseInviteLink(link)), true);
await expect("invite can't be reused", svc("d").claim(core.parseInviteLink(link)), false);
await expect("curator tags whole + subtune", cur.save(TUNE, [{ song: 0, tags: ["funk"] }, { song: 2, tags: ["dark"] }]), true);
await expect("curator clears tags", cur.save(TUNE, [{ song: 2, tags: [] }]), true);
cur.state.role = "admin"; cur.curator.role = "admin";
await expect("curator can't create invite", cur.createInvite("x"), false);
cur.state.role = "curator"; cur.curator.role = "curator";
const name = cur.name;
const curDoc = async (s) => core.decodeCurator(await s.get("curators", s.cid));
await expect("unknown tag id refused", (async () => rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), await core.tagWrite(name, cur.cid, TUNE, 0, ["not-a-tag"])]))(), false);
await expect("tag write without chain step refused", (async () => rawCommit([await core.tagWrite(name, cur.cid, TUNE, 0, ["funk"])]))(), false);
await expect("replayed proof refused", (async () => { const c = await curDoc(cur); c.n -= 1; const w = await core.chainStep(name, cur.state, c); delete w.currentDocument; return rawCommit([w, await core.tagWrite(name, cur.cid, TUNE, 0, ["funk"])]); })(), false);
await expect("tag doc id must match path#song", (async () => { const w = await core.tagWrite(name, cur.cid, TUNE, 0, ["funk"]); w.update.name = name("tags", "0".repeat(64)); return rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), w]); })(), false);
await expect("tagging as someone else's cid refused", (async () => rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), await core.tagWrite(name, admin.cid, TUNE, 0, ["funk"])]))(), false);
await expect("curator can't promote self", (async () => rawCommit([{ update: { name: name("curators", cur.cid), fields: { role: { stringValue: "admin" } } }, updateMask: { fieldPaths: ["role"] } }]))(), false);
await expect("curator can't revoke admin", (async () => rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), core.revokeWrite(name, cur.cid, admin.cid)]))(), false);
const out = svc("o"); await out.init();
out.state = { seed: "cd".repeat(32), cid: await core.curatorId("cd".repeat(32)), role: "curator" };
await expect("outsider with made-up cid refused", rawCommit([{ update: { name: name("curators", out.cid), fields: { owner: { stringValue: "0".repeat(64) }, n: { integerValue: "0" }, role: { stringValue: "admin" }, active: { booleanValue: true }, invite: { stringValue: "1".repeat(64) } } }, currentDocument: { exists: false } }]), false);
await invite("curator", "e".repeat(32), -DAY);
await expect("expired invite refused", svc("e").claim("e".repeat(32)), false);
await expect("client can't make an admin invite", (async () => { const w = await core.inviteWrite(name, admin.cid, "f".repeat(32)); w.update.fields.role = { stringValue: "admin" }; return rawCommit([await core.chainStep(name, admin.state, await curDoc(admin)), w]); })(), false);
await expect("admin revokes curator", admin.revoke(cur.cid), true);
await expect("revoked curator can't tag", cur.save(TUNE, [{ song: 0, tags: ["funk"] }]), false);
await expect("anyone reads tags", svc("r").refresh({ path: TUNE, song: 1, songs: 3 }), true);
await expect("admin lists a curator's edits", admin.editsBy(cur.cid).then((e) => assert.equal(e.length, 2)), true);
for (const [l, r] of results) console.log((r.startsWith("PASS") ? "ok   " : "FAIL ") + l + " -> " + r);
process.exit(results.some(([, r]) => !r.startsWith("PASS")) ? 1 : 0);

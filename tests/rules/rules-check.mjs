// Runs the real firestore.rules in the Firestore emulator against TagService
// and hand-made attacks. Needs Java 11+; from the repo root:
//   npx firebase-tools@15.31.0 emulators:exec \
//     --only firestore --project demo-shallowsid "node tests/rules/rules-check.mjs && node tests/rules/sync-check.mjs"
import assert from "node:assert/strict";
const REPO = new URL("../..", import.meta.url).href.replace(/\/$/, "");
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
globalThis.location = { origin: "https://example.test", pathname: "/" };
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
await expect("curator sets whole + subtune BPM", cur.save(TUNE, [{ song: 0, bpm: 124 }, { song: 2, bpm: 185 }]), true);
await expect("curator removes a BPM", cur.save(TUNE, [{ song: 2, bpm: null }]), true);
await expect("curator says a subtune has no BPM (0)", cur.save(TUNE, [{ song: 3, bpm: 0 }]), true);
await expect("negative BPM refused", (async () => rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), await core.tagWrite(name, cur.cid, TUNE, 0, [], -1)]))(), false);
await expect("BPM out of range refused", (async () => rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), await core.tagWrite(name, cur.cid, TUNE, 0, [], 999)]))(), false);
await expect("BPM as text refused", (async () => { const w = await core.tagWrite(name, cur.cid, TUNE, 0, [], 120); w.update.fields.b = { stringValue: "120" }; return rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), w]); })(), false);
await expect("unknown tag field refused", (async () => { const w = await core.tagWrite(name, cur.cid, TUNE, 0, []); w.update.fields.x = { stringValue: "hi" }; return rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), w]); })(), false);
await expect("unknown tag id refused", (async () => rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), await core.tagWrite(name, cur.cid, TUNE, 0, ["not-a-tag"])]))(), false);
await expect("tag write without chain step refused", (async () => rawCommit([await core.tagWrite(name, cur.cid, TUNE, 0, ["funk"])]))(), false);
await expect("replayed proof refused", (async () => { const c = await curDoc(cur); c.n -= 1; const w = await core.chainStep(name, cur.state, c); delete w.currentDocument; return rawCommit([w, await core.tagWrite(name, cur.cid, TUNE, 0, ["funk"])]); })(), false);
await expect("tag doc id must match path#song", (async () => { const w = await core.tagWrite(name, cur.cid, TUNE, 0, ["funk"]); w.update.name = name("tags", "0".repeat(64)); return rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), w]); })(), false);
await expect("tagging as someone else's cid refused", (async () => rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), await core.tagWrite(name, admin.cid, TUNE, 0, ["funk"])]))(), false);
await expect("curator can't promote self", (async () => rawCommit([{ update: { name: name("curators", cur.cid), fields: { role: { stringValue: "admin" } } }, updateMask: { fieldPaths: ["role"] } }]))(), false);
await expect("curator can't turn an admin off", (async () => rawCommit([await core.chainStep(name, cur.state, await curDoc(cur)), core.activeWrite(name, cur.cid, admin.cid, false)]))(), false);
const out = svc("o"); await out.init();
out.state = { seed: "cd".repeat(32), cid: await core.curatorId("cd".repeat(32)), role: "curator" };
await expect("outsider with made-up cid refused", rawCommit([{ update: { name: name("curators", out.cid), fields: { owner: { stringValue: "0".repeat(64) }, n: { integerValue: "0" }, role: { stringValue: "admin" }, active: { booleanValue: true }, invite: { stringValue: "1".repeat(64) } } }, currentDocument: { exists: false } }]), false);
await invite("curator", "e".repeat(32), -DAY);
await expect("expired invite refused", svc("e").claim("e".repeat(32)), false);
await expect("client can't make an admin invite", (async () => { const w = await core.inviteWrite(name, admin.cid, "f".repeat(32)); w.update.fields.role = { stringValue: "admin" }; return rawCommit([await core.chainStep(name, admin.state, await curDoc(admin)), w]); })(), false);
await expect("admin turns curator off", admin.setActive(cur.cid, false), true);
await expect("curator that's off can't tag", cur.save(TUNE, [{ song: 0, tags: ["funk"] }]), false);
await expect("curator that's off can't turn itself on", (async () => rawCommit([core.activeWrite(name, cur.cid, cur.cid, true)]))(), false);
await expect("curator that's off can't step its chain", (async () => { const w = await core.chainStep(name, cur.state, await curDoc(cur)); delete w.currentDocument; return rawCommit([w]); })(), false);
await expect("admin can't turn itself off in the app", (async () => rawCommit([await core.chainStep(name, admin.state, await curDoc(admin)), core.activeWrite(name, admin.cid, admin.cid, false)]))(), false);
await expect("admin turns curator back on", admin.setActive(cur.cid, true), true);
await expect("curator tags again", (async () => { await cur.refreshCurator(); return cur.save(TUNE, [{ song: 0, tags: ["funk"] }]); })(), true);
await expect("admin turns curator off again", admin.setActive(cur.cid, false), true);
// Expiring invites early.
let waitingLink; await expect("admin creates a second invite", admin.createInvite("Later").then((l) => (waitingLink = l)), true);
const waitingHash = await core.inviteHash(core.parseInviteLink(waitingLink));
await expect("curator can't expire an invite", (async () => rawCommit([core.expireInviteWrite(name, cur.cid, waitingHash)]))(), false);
await expect("expire without a chain step refused", (async () => rawCommit([core.expireInviteWrite(name, admin.cid, waitingHash)]))(), false);
await expect("expire must set exp to now", (async () => { const w = core.expireInviteWrite(name, admin.cid, waitingHash); delete w.updateTransforms; w.update.fields.exp = { timestampValue: new Date(Date.now() + 7 * DAY).toISOString() }; w.updateMask.fieldPaths.push("exp"); return rawCommit([await core.chainStep(name, admin.state, await curDoc(admin)), w]); })(), false);
await expect("admin expires a waiting invite", admin.expireInvite(waitingHash), true);
await expect("expired invite can't be claimed", svc("late").claim(core.parseInviteLink(waitingLink)), false);
await expect("expired invite can't be claimed (raw)", (async () => { const s2 = svc("late2"); const seed = "ef".repeat(32); const id = { seed, cid: await core.curatorId(seed) }; const doc = await s2.get("invites", waitingHash); const inv = core.decodeInvite(doc); return rawCommit(await core.claimWrites(name, id, core.parseInviteLink(waitingLink), { ...inv, role: "curator" }, doc)); })(), false);
await expect("used invite can't be expired", (async () => { const h = await core.inviteHash(core.parseInviteLink(link)); return admin.expireInvite(h); })(), false);
await expect("admin invite can't be expired in the app", (async () => { await invite("admin", "8".repeat(32), DAY); return admin.expireInvite(await core.inviteHash("8".repeat(32))); })(), false);
await expect("anyone reads tags", svc("r").refresh({ path: TUNE, song: 1, songs: 3 }), true);
// The whole tune, subtune 2 and subtune 3 (its BPM of 0).
await expect("admin lists a curator's edits", admin.editsBy(cur.cid).then((e) => assert.equal(e.length, 3)), true);
await expect("an admin can't be turned off in the app", (async () => { await invite("admin", "9".repeat(32), DAY); const admin2 = svc("a2"); await admin2.init(); await admin2.claim("9".repeat(32)); return rawCommit([await core.chainStep(name, admin2.state, await curDoc(admin2)), core.activeWrite(name, admin2.cid, admin.cid, false)]); })(), false);
for (const [l, r] of results) console.log((r.startsWith("PASS") ? "ok   " : "FAIL ") + l + " -> " + r);
process.exit(results.some(([, r]) => !r.startsWith("PASS")) ? 1 : 0);

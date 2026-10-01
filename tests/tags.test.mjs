// Tune tags: vocabulary, ids, proofs, and curators/admins working through an
// in-memory fake of Firestore's commit API that checks what firestore.rules check.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
globalThis.location = { origin: "https://example.test", pathname: "/shallowsid/" };

const {
  MAX_BPM, MAX_TAGS, MIN_BPM, TAG_ID, chainStep, cleanBpm, cleanTags, curatorId, decodeBpmIndex, decodeTagIndex, inviteHash, parseInviteLink, parseVocab, sha256Hex, tagDocId,
} = await import("../js/tags-core.js");
const { ownerHash, tokenFor } = await import("../js/live-share-core.js");
const { mergeCuration, EMPTY_CURATION } = await import("../js/sync-merge.js");
const { TagService } = await import("../js/tags.js");

const vocabJSON = JSON.parse(readFileSync(new URL("../js/tags-vocab.json", import.meta.url)));
const vocab = parseVocab(vocabJSON);

// ---- vocabulary and ids --------------------------------------------------------

test("the vocabulary's ids are well formed and unique, and every tag has a label", () => {
  const ids = vocabJSON.groups.flatMap((g) => g.tags.map((t) => t.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const g of vocabJSON.groups) for (const t of g.tags) {
    assert.match(t.id, TAG_ID);
    assert.ok(t.label.trim(), t.id);
  }
  assert.equal(vocab.byId.size, ids.length);
});

test("firestore.rules accepts exactly the vocabulary's tags and retired ids (tools/build_rules.py)", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const block = rules.match(/BEGIN TAG IDS([\s\S]*?)END TAG IDS/)[1];
  const ids = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, [...vocab.byId.keys(), ...(vocabJSON.retired ?? [])]);
  for (const id of vocabJSON.retired ?? []) assert.ok(!vocab.byId.has(id), `${id} is retired and a tag`);
});

test("parseVocab drops malformed and repeated tags; cleanTags keeps known ids once, in order, capped", () => {
  const v = parseVocab({ groups: [{ name: "A", tags: [{ id: "ok", label: "OK" }, { id: "Bad Id", label: "x" }, { id: "ok", label: "again" }, { id: "nolabel" }] }, { name: "B", tags: [] }] });
  assert.deepEqual([...v.byId.keys()], ["ok"]);
  assert.equal(v.groups.length, 1);
  assert.deepEqual(cleanTags(["dark", "ballad", "nope", "ballad"], vocab), ["ballad", "dark"]);
  assert.equal(cleanTags([...vocab.byId.keys()], vocab).length, MAX_TAGS);
});

test("tag document ids are sha256 of path#song, as the rules compute them", async () => {
  const path = "MUSICIANS/H/Hubbard_Rob/Commando.sid";
  assert.equal(await tagDocId(path, 0), await sha256Hex(`${path}#0`));
  assert.notEqual(await tagDocId(path, 0), await tagDocId(path, 1));
});

test("decodeTagIndex keeps valid paths, songs and known tags only", () => {
  const index = decodeTagIndex({ tunes: {
    "MUSICIANS/H/Hubbard_Rob/Commando.sid": { 0: ["funk", "bogus"], 2: ["dark"], 999: ["dark"], x: ["dark"] },
    "../etc/passwd.sid": { 0: ["funk"] },
    "GAMES/A/Empty.sid": { 0: ["bogus"] },
  } }, vocab);
  assert.deepEqual([...index.keys()], ["MUSICIANS/H/Hubbard_Rob/Commando.sid"]);
  assert.deepEqual([...index.get("MUSICIANS/H/Hubbard_Rob/Commando.sid")], [[0, ["funk"]], [2, ["dark"]]]);
});

test("BPMs are whole numbers in range; the index's bpm part keeps valid paths and songs only", () => {
  assert.equal(cleanBpm(125), 125);
  assert.equal(cleanBpm("94"), 94);
  for (const bad of [MIN_BPM - 1, MAX_BPM + 1, 12.5, "12.5", "", "fast", null, undefined]) assert.equal(cleanBpm(bad), null, String(bad));
  const index = decodeBpmIndex({ bpm: {
    "MUSICIANS/H/Hubbard_Rob/Commando.sid": { 0: 124, 2: 185, 3: 9999, 999: 120 },
    "../etc/passwd.sid": { 0: 120 },
  } });
  assert.deepEqual([...index.keys()], ["MUSICIANS/H/Hubbard_Rob/Commando.sid"]);
  assert.deepEqual([...index.get("MUSICIANS/H/Hubbard_Rob/Commando.sid")], [[0, 124], [2, 185]]);
  assert.equal(decodeBpmIndex({}).size, 0);
});

test("firestore.rules takes the same BPM range as the app", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, new RegExp(`d\\.b >= ${MIN_BPM} && d\\.b <= ${MAX_BPM}`));
});

test("a chain step's proof opens the current owner and commits to the next token", async () => {
  const seed = "ab".repeat(32);
  const identity = { seed, cid: await curatorId(seed) };
  const name = (c, id) => `x/${c}/${id}`;
  const write = await chainStep(name, identity, { n: 3, updateTime: "t" });
  assert.equal(await ownerHash(write.update.fields.proof.stringValue), await ownerHash(await tokenFor(seed, 3)));
  assert.equal(write.update.fields.owner.stringValue, await ownerHash(await tokenFor(seed, 4)));
  assert.equal(write.update.fields.n.integerValue, "4");
});

test("invite links: the secret from a link or on its own, nothing else", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  assert.equal(parseInviteLink(`https://x.test/shallowsid/#/curate/${secret}`), secret);
  assert.equal(parseInviteLink(secret.toUpperCase()), secret);
  assert.equal(parseInviteLink("https://x.test/#/curate/123"), null);
  assert.equal(parseInviteLink("#/p/abcdefghjkmn"), null);
});

test("curation merge: an identity spreads to devices without one, and a dropped one stays dropped", () => {
  const a = { seed: "s1", cid: "c1", role: "curator" };
  const b = { seed: "s2", cid: "c2", role: "curator" };
  assert.deepEqual(mergeCuration(EMPTY_CURATION, { identity: null, notes: {} }, { identity: a, notes: {} }).identity, a);
  assert.deepEqual(mergeCuration({ identity: a, notes: {} }, { identity: null, notes: {} }, { identity: a, notes: {} }).identity, null);
  assert.deepEqual(mergeCuration({ identity: a, notes: {} }, { identity: a, notes: {} }, { identity: b, notes: {} }).identity, b);
  assert.deepEqual(mergeCuration(EMPTY_CURATION, { identity: a, notes: { h1: { note: "Rob" } } }, { identity: null, notes: { h2: { note: "Ben" } } }).notes,
    { h1: { note: "Rob" }, h2: { note: "Ben" } });
});

// ---- a fake Firestore with the rules' checks ----------------------------------------------

const docs = new Map();         // "collection/id" -> {fields, updateTime}
let clock = 0;
const PREFIX = "projects/p/databases/(default)/documents/";
const sget = (f) => f?.stringValue ?? null;
const nget = (f) => (f?.integerValue != null ? Number(f.integerValue) : null);
const denied = (message) => ({ ok: false, status: 403, json: async () => ({ error: { status: "PERMISSION_DENIED", message } }) });
const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

async function check(key, before, after, all) {
  const [collection, id] = key.split("/");
  const f = after.fields;
  const afterOf = (k) => all.get(k) ?? docs.get(k);
  const stepped = (cid) => {
    const b = docs.get(`curators/${cid}`), a = afterOf(`curators/${cid}`);
    return b && b.fields.active?.booleanValue === true && nget(a.fields.n) === nget(b.fields.n) + 1;
  };
  if (collection === "tags") {
    const s = nget(f.s), t = (f.t.arrayValue.values ?? []).map(sget);
    if (id !== await sha256Hex(`${sget(f.p)}#${s}`)) return "id";
    if (t.length > 12 || !t.every((x) => vocab.byId.has(x))) return "vocab";
    if (Object.keys(f).some((k) => !["p", "s", "t", "b", "by", "at"].includes(k))) return "fields";
    if (f.b && cleanBpm(nget(f.b)) === null) return "bpm";
    if (!stepped(sget(f.by))) return "not a stepping curator";
    return null;
  }
  if (collection === "curators") {
    if (!before) {
      const h = sget(f.invite), inv = docs.get(`invites/${h}`), invAfter = afterOf(`invites/${h}`);
      if (!inv || inv.fields.used.nullValue !== null || sget(invAfter.fields.used) !== id) return "invite";
      if (Date.parse(inv.fields.exp.timestampValue) <= Date.now()) return "expired";
      if (sget(f.role) !== sget(inv.fields.role) || nget(f.n) !== 0) return "claim";
      return null;
    }
    if (f.active?.booleanValue !== before.fields.active?.booleanValue || sget(f.changedBy) !== sget(before.fields.changedBy)) {
      const admin = sget(f.changedBy);
      return admin !== id && stepped(admin) && sget(docs.get(`curators/${admin}`).fields.role) === "admin" && sget(before.fields.role) === "curator" ? null : "active";
    }
    if (before.fields.active?.booleanValue !== true) return "inactive";
    if (await ownerHash(sget(f.proof)) !== sget(before.fields.owner) || nget(f.n) !== nget(before.fields.n) + 1) return "proof";
    return null;
  }
  if (collection === "invites") {
    if (!before) {
      const by = sget(f.by);
      return sget(f.role) === "curator" && stepped(by) && sget(docs.get(`curators/${by}`).fields.role) === "admin" ? null : "invite create";
    }
    if (f.cancelledBy && !before.fields.cancelledBy) {
      const admin = sget(f.cancelledBy);
      const ok = before.fields.used.nullValue === null && sget(before.fields.role) === "curator" && Date.parse(before.fields.exp.timestampValue) > Date.now()
        && stepped(admin) && sget(docs.get(`curators/${admin}`).fields.role) === "admin";
      return ok ? null : "invite expire";
    }
    if (before.fields.used.nullValue !== null || await sha256Hex(sget(f.secret)) !== id) return "invite use";
    return null;
  }
  return "collection";
}

globalThis.fetch = async (url, { method = "GET", body } = {}) => {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname).split("/documents")[1];
  if (method === "GET") {
    const key = path.slice(1);
    const doc = docs.get(key);
    return doc ? json(200, { name: PREFIX + key, ...doc }) : json(404, { error: { status: "NOT_FOUND", message: "no doc" } });
  }
  const request = JSON.parse(body);
  if (path === ":runQuery") {
    const cid = request.structuredQuery.where.fieldFilter.value.stringValue;
    return json(200, [...docs].filter(([k, d]) => k.startsWith("tags/") && sget(d.fields.by) === cid).map(([k, d]) => ({ document: { name: PREFIX + k, ...d } })));
  }
  assert.equal(path, ":commit");
  const staged = new Map();
  for (const w of request.writes) {
    const key = w.update.name.slice(PREFIX.length);
    const before = docs.get(key);
    if (w.currentDocument?.exists === false && before) return json(409, { error: { status: "ALREADY_EXISTS", message: key } });
    if (w.currentDocument?.exists === true && !before) return json(404, { error: { status: "NOT_FOUND", message: key } });
    if (w.currentDocument?.updateTime && before?.updateTime !== w.currentDocument.updateTime) return json(400, { error: { status: "FAILED_PRECONDITION", message: key } });
    const fields = w.updateMask ? { ...before?.fields, ...w.update.fields } : { ...w.update.fields };
    for (const t of w.updateTransforms ?? []) fields[t.fieldPath] = { timestampValue: new Date().toISOString() };
    staged.set(key, { fields, updateTime: `t${++clock}` });
  }
  for (const [key, after] of staged) {
    const why = await check(key, docs.get(key), after, staged);
    if (why) return denied(`${key}: ${why}`);
  }
  for (const [key, doc] of staged) docs.set(key, doc);
  return json(200, { writeResults: [] });
};

const config = { apiKey: "k", projectId: "p", endpoint: "https://fs.test" };
const fetchJSON = async (url) => {
  if (url.endsWith("tags-vocab.json")) return vocabJSON;
  throw new Error("no index");
};
const service = (storageKey) => new TagService({ config, storageKey, fetchJSON });

// What tools/curators.py does with IAM credentials: an invite outside the rules.
async function cliInvite(role, secret, days = 14) {
  docs.set(`invites/${await inviteHash(secret)}`, {
    fields: { role: { stringValue: role }, by: { stringValue: "cli" }, exp: { timestampValue: new Date(Date.now() + days * 86_400_000).toISOString() }, used: { nullValue: null } },
    updateTime: `t${++clock}`,
  });
}

const TUNE = "MUSICIANS/H/Hubbard_Rob/Commando.sid";
const secretOf = (link) => parseInviteLink(link);

beforeEach(() => {
  docs.clear();
  storage.clear();
});

test("an admin from the CLI invites a curator, who tags a tune and a subtune", async () => {
  const admin = service("admin");
  await admin.init();
  await cliInvite("admin", "a".repeat(32));
  assert.equal(await admin.claim("a".repeat(32)), "admin");
  assert.ok(admin.isAdmin);

  const link = await admin.createInvite("Rob");
  const curator = service("curator");
  await curator.init();
  assert.deepEqual(await curator.checkInvite(secretOf(link)), { status: "ok", role: "curator" });
  assert.equal(await curator.claim(secretOf(link)), "curator");
  assert.ok(curator.canTag && !curator.isAdmin);
  assert.deepEqual(await curator.checkInvite(secretOf(link)), { status: "used", role: "curator" });
  await assert.rejects(service("third").claim(secretOf(link)), /already been used/);

  await curator.save(TUNE, [{ song: 0, tags: ["funk", "nonsense"] }, { song: 3, tags: ["dark"] }]);
  const item = { path: TUNE, song: 3, songs: 5 };
  assert.deepEqual(curator.tagsFor(item).whole, ["funk"]);
  assert.deepEqual(curator.tagsFor(item).sub, ["dark"]);

  // Anyone reading the documents sees them; the admin can tell who it was.
  const reader = service("reader");
  await reader.init();
  await reader.refresh(item);
  assert.deepEqual(reader.tagsFor(item).whole, ["funk"]);
  assert.equal(admin.whoIs(reader.tagsFor(item).edited.whole.by, await admin.invites()), "Rob");
  assert.equal((await admin.editsBy(curator.cid)).length, 2);
});

test("curators set, change and remove a BPM, for the whole tune or a subtune, without touching the tags", async () => {
  const admin = service("admin");
  await admin.init();
  await cliInvite("admin", "c".repeat(32));
  await admin.claim("c".repeat(32));
  const item = { path: TUNE, song: 2, songs: 5 };

  await admin.save(TUNE, [{ song: 0, tags: ["funk"], bpm: 124 }]);
  assert.deepEqual(admin.bpmFor(item), { whole: 124, sub: null, bpm: 124 });
  await admin.save(TUNE, [{ song: 2, bpm: 185 }]);
  assert.deepEqual(admin.bpmFor(item), { whole: 124, sub: 185, bpm: 185 });
  assert.deepEqual(admin.bpmFor({ ...item, song: 3 }).bpm, 124);

  // Tags alone keep the BPM, and BPM alone keeps the tags.
  await admin.save(TUNE, [{ song: 0, tags: ["funk", "dark"] }]);
  assert.equal(admin.songBpm(TUNE, 0), 124);
  await admin.save(TUNE, [{ song: 0, bpm: 125 }]);
  assert.deepEqual(admin.tagsFor(item).whole, ["funk", "dark"]);

  const reader = service("reader");
  await reader.init();
  await reader.refresh(item);
  assert.deepEqual(reader.bpmFor(item), { whole: 125, sub: 185, bpm: 185 });

  // Removing it: the subtune falls back to the whole tune's.
  await admin.save(TUNE, [{ song: 2, bpm: null }]);
  await reader.refresh(item);
  assert.deepEqual(reader.bpmFor(item), { whole: 125, sub: null, bpm: 125 });
  assert.equal(nget(docs.get(`tags/${await tagDocId(TUNE, 2)}`).fields.b), null);

  // Out of range is refused by the rules too, not just dropped by the app.
  const doc = await admin.get("curators", admin.cid);
  const { decodeCurator, tagWrite } = await import("../js/tags-core.js");
  const res = await fetch(admin.url(":commit"), { method: "POST", body: JSON.stringify({ writes: [
    await chainStep(admin.name, admin.state, decodeCurator(doc)), await tagWrite(admin.name, admin.cid, TUNE, 0, [], 999),
  ] }) });
  assert.equal(res.status, 403);
});

test("curators can't invite; a curator turned off can't tag until turned back on", async () => {
  const admin = service("admin");
  await admin.init();
  await cliInvite("admin", "b".repeat(32));
  await admin.claim("b".repeat(32));
  const curator = service("curator");
  await curator.init();
  await curator.claim(secretOf(await admin.createInvite("Ben")));

  await assert.rejects(curator.createInvite("x"), /Only admins/);
  // Even bypassing the client check, the server refuses.
  curator.state.role = "admin";
  curator.curator = { ...curator.curator, role: "admin" };
  await assert.rejects(curator.createInvite("x"), /Not allowed/);
  curator.state.role = "curator";
  curator.curator = { ...curator.curator, role: "curator" };

  await admin.setActive(curator.cid, false);
  await assert.rejects(curator.save(TUNE, [{ song: 0, tags: ["funk"] }]), /no longer a curator/);
  assert.equal(curator.canTag, false);
  await assert.rejects(admin.setActive(admin.cid, false), /Can't change/);

  await admin.setActive(curator.cid, true);
  await curator.refreshCurator();
  assert.equal(curator.canTag, true);
  await curator.save(TUNE, [{ song: 0, tags: ["funk"] }]);
});

test("an admin expires a waiting invite: its link stops working; used ones can't be expired", async () => {
  const admin = service("admin");
  await admin.init();
  await cliInvite("admin", "d".repeat(32));
  await admin.claim("d".repeat(32));
  const waiting = secretOf(await admin.createInvite("Waiting"));
  const used = secretOf(await admin.createInvite("Used"));
  const curator = service("curator");
  await curator.init();
  await curator.claim(used);

  const rows = await admin.invites();
  await admin.expireInvite(rows.find((r) => r.note === "Waiting").hash);
  assert.deepEqual(await curator.checkInvite(waiting), { status: "cancelled", role: "curator" });
  await assert.rejects(service("late").claim(waiting), /cancelled/);
  assert.equal((await admin.invites()).find((r) => r.note === "Waiting").cancelled, true);
  await assert.rejects(admin.expireInvite(rows.find((r) => r.note === "Used").hash), /Not allowed/);
  await assert.rejects(curator.expireInvite(rows.find((r) => r.note === "Waiting").hash), /Only admins/);
});

test("someone without rights can't tag, even with a made-up curator id", async () => {
  const outsider = service("outsider");
  await outsider.init();
  outsider.state = { seed: "cd".repeat(32), cid: await curatorId("cd".repeat(32)), role: "curator" };
  await assert.rejects(outsider.save(TUNE, [{ song: 0, tags: ["funk"] }]), /no longer a curator/);
  assert.equal([...docs.keys()].filter((k) => k.startsWith("tags/")).length, 0);
});

test("two devices of one curator (synced identity) take turns on the proof chain", async () => {
  await cliInvite("curator", "c".repeat(32));
  const phone = service("phone");
  await phone.init();
  await phone.claim("c".repeat(32));
  const laptop = service("laptop");
  await laptop.init();
  laptop.applySynced(structuredClone(phone.snapshot()));
  await laptop.refreshCurator();
  await phone.save(TUNE, [{ song: 0, tags: ["funk"] }]);
  await laptop.save(TUNE, [{ song: 0, tags: ["funk", "happy"] }]);
  await phone.save(TUNE, [{ song: 0, tags: ["happy"] }]);
  const doc = docs.get(`curators/${phone.cid}`);
  assert.equal(nget(doc.fields.n), 3);
});

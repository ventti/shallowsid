// Tune tags: the fixed vocabulary, document ids, curator proofs and the
// Firestore writes they take. Pure WebCrypto, so it runs in browsers and under
// `node --test`. See firestore.rules for what the server checks.
//
// Tags are picked from js/tags-vocab.json only, so there's no free text to
// filter. A tune's tags live at tags/<sha256("path#s")>, where s = 0 is the
// whole tune and s >= 1 one subtune; a subtune shows both.
//
// Curators have no accounts. Each has a random seed; its curator id is
// HMAC(seed, "curator-id") and, as for shared lists (live-share-core.js),
// curators/<cid> stores owner = sha256(token_n). Every write by a curator is one
// batch that also moves that chain on (proof = token_n, n + 1), which the rules
// require of the other writes in the batch.

import { isValidPath, newSeed, ownerHash, tokenFor } from "./live-share-core.js";

export const TAG_ID = /^[a-z0-9-]{1,24}$/;
export const MAX_TAGS = 12;            // per tune or subtune, as firestore.rules allow
export const MAX_SONG = 256;
export const WHOLE_TUNE = 0;
export const INVITE_DAYS = 14;
export const ROLES = ["curator", "admin"];
const HEX64 = /^[0-9a-f]{64}$/;
const INVITE_SECRET = /^[0-9a-f]{32}$/;

// ---- vocabulary --------------------------------------------------------------

// {groups: [{name, tags: [{id, label, description}]}], byId: Map}. Malformed
// entries and repeated ids are dropped.
export function parseVocab(data) {
  const byId = new Map();
  const groups = [];
  for (const group of Array.isArray(data?.groups) ? data.groups : []) {
    const tags = [];
    for (const t of Array.isArray(group?.tags) ? group.tags : []) {
      if (!TAG_ID.test(t?.id ?? "") || typeof t.label !== "string" || byId.has(t.id)) continue;
      const tag = { id: t.id, label: t.label, description: typeof t.description === "string" ? t.description : "", group: String(group.name ?? "") };
      byId.set(tag.id, tag);
      tags.push(tag);
    }
    if (tags.length) groups.push({ name: String(group.name ?? ""), tags });
  }
  return { groups, byId };
}

// Known ids only, each once, in vocabulary order, at most MAX_TAGS.
export function cleanTags(ids, vocab) {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  return [...vocab.byId.keys()].filter((id) => wanted.has(id)).slice(0, MAX_TAGS);
}

// ---- ids -----------------------------------------------------------------------

const enc = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export const tagKey = (path, song) => `${path}#${song}`;
export const tagDocId = (path, song) => sha256Hex(tagKey(path, song));

export function newCuratorSeed() {
  return newSeed();
}

export const curatorId = (seed) => tokenFor(seed, "curator-id");

export function newInviteSecret() {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

export const inviteHash = (secret) => sha256Hex(secret);
export const isInviteSecret = (text) => INVITE_SECRET.test(String(text ?? ""));
export const isCuratorId = (text) => HEX64.test(String(text ?? ""));

// ---- the static tag index (tools/export_tags.py) ---------------------------------

// {path: {song: [ids]}} with only valid paths, songs and known tags.
export function decodeTagIndex(data, vocab) {
  const out = new Map();
  const tunes = data?.tunes && typeof data.tunes === "object" ? data.tunes : {};
  for (const [path, songs] of Object.entries(tunes)) {
    if (!isValidPath(path) || !songs || typeof songs !== "object") continue;
    const bySong = new Map();
    for (const [song, ids] of Object.entries(songs)) {
      const s = Number(song);
      const tags = cleanTags(ids, vocab);
      if (Number.isInteger(s) && s >= 0 && s <= MAX_SONG && tags.length) bySong.set(s, tags);
    }
    if (bySong.size) out.set(path, bySong);
  }
  return out;
}

// ---- Firestore REST values ---------------------------------------------------------

export const str = (value) => ({ stringValue: value });
export const int = (value) => ({ integerValue: String(value) });
export const bool = (value) => ({ booleanValue: value });
export const time = (date) => ({ timestampValue: new Date(date).toISOString() });
export const NULL = { nullValue: null };
export const strings = (list) => ({ arrayValue: list.length ? { values: list.map(str) } : {} });

export const fieldString = (f) => (typeof f?.stringValue === "string" ? f.stringValue : null);
export const fieldInt = (f) => (f?.integerValue != null ? Number(f.integerValue) : null);
export const fieldStrings = (f) => (f?.arrayValue?.values ?? []).map(fieldString).filter((s) => s !== null);
export const fieldTime = (f) => (f?.timestampValue ? Date.parse(f.timestampValue) : null);

// A tags/ document as read back: {path, song, tags, by, at}, or null if it's not one.
export function decodeTagDoc(doc, vocab) {
  const f = doc?.fields ?? {};
  const path = fieldString(f.p);
  const song = fieldInt(f.s);
  if (!isValidPath(path ?? "") || !Number.isInteger(song) || song < 0 || song > MAX_SONG) return null;
  const by = fieldString(f.by);
  return { path, song, tags: cleanTags(fieldStrings(f.t), vocab), by: isCuratorId(by) ? by : null, at: fieldTime(f.at) };
}

// A curators/ document: {cid, n, role, active, invite, updateTime}.
export function decodeCurator(doc) {
  const f = doc?.fields ?? {};
  const role = fieldString(f.role);
  return {
    cid: doc?.name?.split("/").pop() ?? null,
    n: fieldInt(f.n) ?? 0,
    role: ROLES.includes(role) ? role : null,
    active: f.active?.booleanValue === true,
    invite: fieldString(f.invite),
    updateTime: doc?.updateTime ?? null,
  };
}

// An invites/ document: {role, by, exp, used}.
export function decodeInvite(doc) {
  const f = doc?.fields ?? {};
  const role = fieldString(f.role);
  return { role: ROLES.includes(role) ? role : null, by: fieldString(f.by), exp: fieldTime(f.exp), used: fieldString(f.used) };
}

// ---- batched writes (documents:commit) ----------------------------------------------

// `name(collection, id)` gives the full document name for the project.

// Moves the curator's proof chain on: proof = token_n, owner = sha256(token_n+1).
export async function chainStep(name, identity, curator) {
  const n = curator.n;
  return {
    update: {
      name: name("curators", identity.cid),
      fields: { owner: str(await ownerHash(await tokenFor(identity.seed, n + 1))), n: int(n + 1), proof: str(await tokenFor(identity.seed, n)) },
    },
    updateMask: { fieldPaths: ["owner", "n", "proof"] },
    currentDocument: { updateTime: curator.updateTime },
  };
}

// Sets the tags of a tune (song 0) or subtune; an empty list clears them.
export async function tagWrite(name, cid, path, song, tags) {
  return {
    update: { name: name("tags", await tagDocId(path, song)), fields: { p: str(path), s: int(song), t: strings(tags), by: str(cid) } },
    updateTransforms: [{ fieldPath: "at", setToServerValue: "REQUEST_TIME" }],
  };
}

// Joining with an invite: a new curator record (chain at 0) and the invite
// marked used by it, with the secret that proves it was known.
export async function claimWrites(name, { seed, cid }, secret, invite, inviteDoc) {
  return [
    {
      update: {
        name: name("curators", cid),
        fields: { owner: str(await ownerHash(await tokenFor(seed, 0))), n: int(0), role: str(invite.role), active: bool(true), invite: str(await inviteHash(secret)) },
      },
      currentDocument: { exists: false },
    },
    {
      update: { name: name("invites", await inviteHash(secret)), fields: { used: str(cid), secret: str(secret) } },
      updateMask: { fieldPaths: ["used", "secret"] },
      currentDocument: { updateTime: inviteDoc.updateTime },
    },
  ];
}

export async function inviteWrite(name, cid, secret, now = Date.now(), days = INVITE_DAYS) {
  return {
    update: {
      name: name("invites", await inviteHash(secret)),
      fields: { role: str("curator"), by: str(cid), exp: time(now + days * 86_400_000), used: NULL },
    },
    currentDocument: { exists: false },
  };
}

export function revokeWrite(name, adminCid, cid) {
  return {
    update: { name: name("curators", cid), fields: { active: bool(false), revokedBy: str(adminCid) } },
    updateMask: { fieldPaths: ["active", "revokedBy"] },
    currentDocument: { exists: true },
  };
}

// ---- links ----------------------------------------------------------------------

// An invite link (…#/curate/<secret>) or a bare secret -> the secret, or null.
export function parseInviteLink(text) {
  const input = String(text ?? "").trim().toLowerCase();
  if (isInviteSecret(input)) return input;
  const match = input.match(/#\/?curate\/([0-9a-f]{32})$/);
  return match ? match[1] : null;
}

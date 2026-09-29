// Tune tags: what everyone reads (a static index built at deploy, plus the
// current tune's documents read live) and what curators and admins write.
// See tags-core.js for the scheme and firestore.rules for what's enforced.
//
// This device's curator identity ({seed, cid, role}) and an admin's notes on
// the invites they made ({inviteHash: {note, created}}) are kept in
// localStorage and synced, encrypted, with the rest (sync.js), so all the
// user's devices curate as one.
//
// Events: "change" when tags or the identity changed (views re-render),
//         "identity" when the curator identity or notes changed (sync pushes).

import { FIREBASE } from "./sync-config.js";
import { firestoreFetch } from "./firestore-fetch.js";
import {
  WHOLE_TUNE, chainStep, claimWrites, cleanTags, curatorId, decodeCurator, decodeInvite, decodeTagDoc, decodeTagIndex,
  inviteHash, inviteWrite, isCuratorId, newCuratorSeed, newInviteSecret, parseVocab, activeWrite, str, tagDocId, tagKey, tagWrite,
} from "./tags-core.js";

const STORAGE_KEY = "shallowsid.curation";
const VOCAB_URL = new URL("./tags-vocab.json", import.meta.url).href;
const INDEX_URL = new URL("../data/tags-index.json", import.meta.url).href;
const RECENT_EDITS = 200;
const EMPTY_TAGS = Object.freeze({ whole: [], sub: [], edited: null });

export class TagService extends EventTarget {
  constructor({ config = FIREBASE, storageKey = STORAGE_KEY, fetchJSON = defaultFetchJSON } = {}) {
    super();
    this.config = config;
    this.storageKey = storageKey;
    this.fetchJSON = fetchJSON;
    this.configured = !!(config.apiKey && config.projectId);
    this.vocab = parseVocab({});
    this.index = new Map();      // path -> Map(song -> [ids]) from the deploy
    this.live = new Map();       // "path#song" -> {tags, by, at} read or written this session
    this.state = this.load();
    this.curator = null;         // this device's curators/<cid>, once checked
  }

  // Vocabulary and the static index. A missing index (local dev) just means no tags yet.
  async init() {
    try {
      this.vocab = parseVocab(await this.fetchJSON(VOCAB_URL));
    } catch (err) {
      console.error("tags vocabulary:", err);
    }
    try {
      this.index = decodeTagIndex(await this.fetchJSON(INDEX_URL), this.vocab);
    } catch {
      this.index = new Map();
    }
    this.dispatchEvent(new Event("change"));
    if (this.state.cid) this.refreshCurator().catch((err) => console.error("curator:", err));
  }

  // ---- reading ---------------------------------------------------------------

  label(id) {
    return this.vocab.byId.get(id)?.label ?? id;
  }

  songTags(path, song) {
    const live = this.live.get(tagKey(path, song));
    return live ? live.tags : this.index.get(path)?.get(song) ?? [];
  }

  // {whole, sub, edited: {whole, sub}} for a subtune: its own tags and the whole tune's.
  tagsFor(item) {
    if (!item?.path) return EMPTY_TAGS;
    const whole = this.songTags(item.path, WHOLE_TUNE);
    const sub = item.songs > 1 ? this.songTags(item.path, item.song).filter((id) => !whole.includes(id)) : [];
    const edited = (song) => this.live.get(tagKey(item.path, song)) ?? null;
    return { whole, sub, edited: { whole: edited(WHOLE_TUNE), sub: item.songs > 1 ? edited(item.song) : null } };
  }

  // Every tagged tune and subtune: [{path, song, tags}] with song 0 for whole tunes.
  entries() {
    const out = new Map();
    for (const [path, songs] of this.index) for (const [song, tags] of songs) out.set(tagKey(path, song), { path, song, tags });
    for (const [key, { path, song, tags }] of this.live) out.set(key, { path, song, tags });
    return [...out.values()].filter((e) => e.tags.length);
  }

  // How many tunes (or subtunes) carry each tag, for the tag cloud.
  counts() {
    const counts = new Map();
    for (const { tags } of this.entries()) for (const id of tags) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }

  // Read the current tune's documents so edits by others show at once.
  async refresh(item) {
    if (!this.configured || !item?.path) return;
    const songs = item.songs > 1 ? [WHOLE_TUNE, item.song] : [WHOLE_TUNE];
    const before = songs.map((s) => this.songTags(item.path, s).join());
    await Promise.all(songs.map(async (song) => {
      const doc = await this.get("tags", await tagIdFor(item.path, song));
      const tag = doc ? decodeTagDoc(doc, this.vocab) : null;
      if (tag) this.live.set(tagKey(item.path, song), tag);
      else if (!doc) this.live.delete(tagKey(item.path, song));
    }));
    if (songs.some((s, i) => this.songTags(item.path, s).join() !== before[i])) this.dispatchEvent(new Event("change"));
  }

  // ---- identity ----------------------------------------------------------------

  get cid() {
    return this.state.cid ?? null;
  }

  get role() {
    return this.curator ? (this.curator.active ? this.curator.role : null) : this.state.role ?? null;
  }

  get canTag() {
    return this.configured && !!this.cid && !!this.role;
  }

  get isAdmin() {
    return this.canTag && this.role === "admin";
  }

  // Whether this device's curator is still active, and in which role.
  async refreshCurator() {
    if (!this.cid) return null;
    const doc = await this.get("curators", this.cid);
    this.curator = doc ? decodeCurator(doc) : { cid: this.cid, active: false, role: null, n: 0 };
    const role = this.curator.active ? this.curator.role : null;
    if (role !== this.state.role) {
      this.state = { ...this.state, role };
      this.persist();
    }
    this.dispatchEvent(new Event("change"));
    return this.curator;
  }

  // ---- invites -------------------------------------------------------------------

  // What an invite link leads to: {status: "ok" | "used" | "expired" | "missing", role}.
  async checkInvite(secret) {
    const doc = await this.get("invites", await inviteHash(secret));
    if (!doc) return { status: "missing" };
    const invite = decodeInvite(doc);
    if (invite.used) return { status: "used", role: invite.role };
    if (!invite.exp || invite.exp <= Date.now()) return { status: "expired", role: invite.role };
    return { status: "ok", role: invite.role };
  }

  // Become a curator (or admin) with an invite. A device that already is one
  // keeps its identity unless the invite gives it a higher role.
  async claim(secret) {
    const doc = await this.get("invites", await inviteHash(secret));
    if (!doc) throw new Error("This invite doesn't exist");
    const invite = decodeInvite(doc);
    if (invite.used) throw new Error("This invite has already been used");
    if (!invite.exp || invite.exp <= Date.now()) throw new Error("This invite has expired");
    const seed = newCuratorSeed();
    const identity = { seed, cid: await curatorId(seed) };
    await this.commit(await claimWrites(this.name, identity, secret, invite, doc));
    this.state = { ...this.state, ...identity, role: invite.role };
    this.persist();
    this.curator = null;
    await this.refreshCurator();
    this.dispatchEvent(new Event("identity"));
    return invite.role;
  }

  // Forget this device's curator identity (the record stays, and an admin can still turn it off).
  leave() {
    this.state = { notes: this.state.notes ?? {} };
    this.curator = null;
    this.persist();
    this.dispatchEvent(new Event("identity"));
    this.dispatchEvent(new Event("change"));
  }

  // An admin's new invite link; `note` (who it's for) stays in their vault only.
  async createInvite(note) {
    if (!this.isAdmin) throw new Error("Only admins can invite curators");
    const secret = newInviteSecret();
    await this.step(async () => [await inviteWrite(this.name, this.cid, secret)]);
    const h = await inviteHash(secret);
    this.state = { ...this.state, notes: { ...this.state.notes, [h]: { note: String(note ?? "").slice(0, 80), created: Date.now() } } };
    this.persist();
    this.dispatchEvent(new Event("identity"));
    return `${location.origin}${location.pathname}#/curate/${secret}`;
  }

  get notes() {
    return this.state.notes ?? {};
  }

  // The invites this admin made, with whoever used them:
  // [{hash, note, created, exp, used, curator: {cid, role, active} | null}].
  async invites() {
    const rows = await Promise.all(Object.entries(this.notes).map(async ([hash, { note, created }]) => {
      const doc = await this.get("invites", hash);
      const invite = doc ? decodeInvite(doc) : null;
      const curatorDoc = invite?.used ? await this.get("curators", invite.used) : null;
      return { hash, note, created, exp: invite?.exp ?? null, used: invite?.used ?? null, curator: curatorDoc ? decodeCurator(curatorDoc) : null, missing: !doc };
    }));
    return rows.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  }

  // Who a curator id is, as far as this device knows: "you", an admin's note, or null.
  whoIs(cid, invites = []) {
    if (!cid) return null;
    if (cid === this.cid) return "you";
    return invites.find((i) => i.used === cid)?.note || null;
  }

  // Turn a curator off (can't tag any more; their tags stay) or back on.
  async setActive(cid, active) {
    if (!this.isAdmin) throw new Error("Only admins can turn curators off or on");
    if (!isCuratorId(cid) || cid === this.cid) throw new Error("Can't change that curator");
    await this.step(async () => [activeWrite(this.name, this.cid, cid, active)]);
  }

  // A curator's latest edits, newest first: [{path, song, tags, at}].
  async editsBy(cid) {
    const res = await firestoreFetch(this.config, this.url(":runQuery"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: "tags" }],
        where: { fieldFilter: { field: { fieldPath: "by" }, op: "EQUAL", value: str(cid) } },
        limit: RECENT_EDITS,
      } }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    return (await res.json()).map((r) => r.document && decodeTagDoc(r.document, this.vocab)).filter(Boolean).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  }

  // ---- writing tags ------------------------------------------------------------------

  // `changes` is [{song, tags}] (song 0 = whole tune), written in one batch.
  async save(path, changes) {
    if (!this.canTag) throw new Error("Only curators can tag tunes");
    const clean = changes.map(({ song, tags }) => ({ song, tags: cleanTags(tags, this.vocab) }));
    await this.step(async () => Promise.all(clean.map(({ song, tags }) => tagWrite(this.name, this.cid, path, song, tags))));
    for (const { song, tags } of clean) this.live.set(tagKey(path, song), { path, song, tags, by: this.cid, at: Date.now() });
    this.dispatchEvent(new Event("change"));
  }

  // One batch: `writes()` plus a step of this curator's chain. Another of the
  // user's devices may step it first: then read it again and retry.
  async step(writes) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const doc = await this.get("curators", this.cid);
      const curator = doc ? decodeCurator(doc) : null;
      if (!curator?.active) {
        await this.refreshCurator();
        throw new Error("You're no longer a curator");
      }
      try {
        return await this.commit([await chainStep(this.name, this.state, curator), ...(await writes())]);
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err;
      }
    }
    throw new Error("Another of your devices keeps editing; try again");
  }

  // ---- sync (see sync.js) ----------------------------------------------------------------

  snapshot() {
    const { seed, cid, role } = this.state;
    return { identity: seed && cid ? { seed, cid, role: role ?? null } : null, notes: this.notes };
  }

  applySynced({ identity, notes } = {}) {
    const next = { ...(identity ?? {}), notes: notes ?? {} };
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    const changedIdentity = next.cid !== this.state.cid;
    this.state = next;
    this.persist();
    if (changedIdentity) {
      this.curator = null;
      this.refreshCurator().catch((err) => console.error("curator:", err));
    }
    this.dispatchEvent(new Event("change"));
  }

  load() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey)) ?? {};
    } catch {
      return {};
    }
  }

  persist() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      // storage blocked: the identity lasts for this visit (and in sync, if on)
    }
  }

  // ---- Firestore REST ---------------------------------------------------------------------

  get base() {
    return `projects/${this.config.projectId}/databases/(default)/documents`;
  }

  name = (collection, id) => `${this.base}/${collection}/${id}`;

  url(path) {
    const endpoint = this.config.endpoint ?? "https://firestore.googleapis.com";
    return `${endpoint}/v1/${this.base}${path}?${new URLSearchParams({ key: this.config.apiKey })}`;
  }

  async get(collection, id) {
    const res = await firestoreFetch(this.config, this.url(`/${collection}/${id}`));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await errorText(res));
    return res.json();
  }

  async commit(writes) {
    const res = await firestoreFetch(this.config, this.url(":commit"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writes }),
    });
    if (res.ok) return res.json();
    const text = await errorText(res);
    if (res.status === 409 || /FAILED_PRECONDITION|ABORTED/.test(text)) throw new ConflictError(text);
    throw new Error(/PERMISSION_DENIED/.test(text) ? "Not allowed: your curator rights may have changed" : text);
  }
}

class ConflictError extends Error {}

const tagIdCache = new Map();
async function tagIdFor(path, song) {
  const key = tagKey(path, song);
  if (!tagIdCache.has(key)) tagIdCache.set(key, await tagDocId(path, song));
  return tagIdCache.get(key);
}

async function defaultFetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function errorText(res) {
  try {
    const body = await res.json();
    const error = Array.isArray(body) ? body[0]?.error : body.error;
    return `${error?.status ?? res.status}: ${error?.message ?? res.statusText}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

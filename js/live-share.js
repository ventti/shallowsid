// Unlisted playlists: publish a playlist at lists/<id> so anyone with the link
// can open it, and keep it up to date as the owner edits. See
// live-share-core.js for the owner-proof scheme and input validation.
//
// A shared playlist carries `share: {id, seed}` in the local store. The seed is
// the owner's secret; it syncs (encrypted) with the vault so the owner's other
// devices can update the list too, and is never put in links or exports.

import { FIREBASE } from "./sync-config.js";
import { ID_PATTERN, decodeList, encodeList, newListId, newSeed, ownerHash, tokenFor } from "./live-share-core.js";

const FORMAT_VERSION = 1;
const UPDATE_DELAY_MS = 3000;
const PUBLISHED_KEY = "shallowsid.liveShare.published";   // playlist id -> last published content

export class LiveShare extends EventTarget {
  constructor({ store, config = FIREBASE }) {
    super();
    this.store = store;
    this.config = config;
    this.configured = !!(config.apiKey && config.projectId);
    this.published = this.loadPublished();
    this.timer = 0;
    store.addEventListener("change", () => this.schedule());
  }

  link(share) {
    return `${location.origin}${location.pathname}#/p/${share.id}`;
  }

  // ---- owner side ----------------------------------------------------------

  // Publish (first time) or push the latest content. Returns the share.
  async publish(playlist) {
    if (!this.configured) throw new Error("Sharing isn't set up on this site");
    const content = encodeList(playlist);
    let share = playlist.share;
    if (!share) {
      share = await this.create(content);
      this.store.setShare(playlist.id, share);
    } else {
      await this.update(share, content);
    }
    this.remember(playlist.id, content);
    return share;
  }

  // Replace the public content with a "no longer shared" marker and forget the share.
  async stop(playlist) {
    if (playlist.share) await this.update(playlist.share, JSON.stringify({ deleted: true }));
    this.store.setShare(playlist.id, null);
    this.remember(playlist.id, null);
  }

  // Edits to shared playlists are pushed a few seconds later.
  schedule() {
    if (!this.configured) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pushChanged(), UPDATE_DELAY_MS);
  }

  async pushChanged() {
    for (const playlist of this.store.playlists) {
      if (!playlist.share || encodeList(playlist) === this.published[playlist.id]) continue;
      try {
        await this.publish(playlist);
      } catch (err) {
        console.error("live share:", err);
        this.dispatchEvent(new CustomEvent("error", { detail: `Couldn't update “${playlist.name}”: ${err.message}` }));
      }
    }
  }

  async create(content) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const share = { id: newListId(), seed: newSeed() };
      const owner = await ownerHash(await tokenFor(share.seed, 0));
      const res = await this.write(share.id, { d: content, owner, n: 0 }, { "currentDocument.exists": "false" });
      if (res.ok) return share;
      if (res.status !== 409) throw new Error(await errorText(res));
      // ALREADY_EXISTS: astronomically unlikely id clash; pick another
    }
    throw new Error("Couldn't create a link; try again");
  }

  // Each update proves ownership with token n and commits to token n+1.
  async update(share, content) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const doc = await this.get(share.id);
      if (!doc) throw new Error("The shared list no longer exists");
      const n = Number(doc.fields?.n?.integerValue ?? 0);
      const proof = await tokenFor(share.seed, n);
      const owner = await ownerHash(await tokenFor(share.seed, n + 1));
      const res = await this.write(share.id, { d: content, owner, n: n + 1, proof }, { "currentDocument.updateTime": doc.updateTime });
      if (res.ok) return;
      const text = await errorText(res);
      if (!/FAILED_PRECONDITION/.test(text)) throw new Error(/PERMISSION_DENIED/.test(text) ? "This device isn't allowed to change that list" : text);
      // another device updated it meanwhile: read again and retry
    }
    throw new Error("The list keeps changing on another device; try again");
  }

  // ---- anyone with the link ------------------------------------------------------

  // {name, items} | {deleted: true} | null (not found). `exists(path)` checks the catalogue.
  async fetch(id, exists) {
    if (!ID_PATTERN.test(id)) return null;
    const doc = await this.get(id);
    if (!doc) return null;
    return decodeList(doc.fields?.d?.stringValue ?? "", exists);
  }

  // ---- Firestore REST --------------------------------------------------------------

  url(id, params = {}) {
    const q = new URLSearchParams({ key: this.config.apiKey, ...params });
    const endpoint = this.config.endpoint ?? "https://firestore.googleapis.com";
    return `${endpoint}/v1/projects/${this.config.projectId}/databases/(default)/documents/lists/${id}?${q}`;
  }

  async get(id) {
    const res = await fetch(this.url(id));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await errorText(res));
    return res.json();
  }

  write(id, { d, owner, n, proof }, precondition) {
    const fields = {
      d: { stringValue: d },
      owner: { stringValue: owner },
      n: { integerValue: String(n) },
      v: { integerValue: String(FORMAT_VERSION) },
    };
    if (proof) fields.proof = { stringValue: proof };
    return fetch(this.url(id, precondition), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
  }

  // ---- bookkeeping ---------------------------------------------------------------

  loadPublished() {
    try {
      return JSON.parse(localStorage.getItem(PUBLISHED_KEY)) ?? {};
    } catch {
      return {};
    }
  }

  remember(playlistId, content) {
    if (content === null) delete this.published[playlistId];
    else this.published[playlistId] = content;
    try {
      localStorage.setItem(PUBLISHED_KEY, JSON.stringify(this.published));
    } catch {
      // storage blocked: we may re-push unchanged content once, harmlessly
    }
  }
}

async function errorText(res) {
  try {
    const body = await res.json();
    return `${body.error?.status ?? res.status}: ${body.error?.message ?? res.statusText}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

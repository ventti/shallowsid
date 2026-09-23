// Playlists, recently played tunes and playlists, and play counts, kept in
// this browser's localStorage (and synced, see sync.js).
// Storage can be unavailable (private mode, blocked site data); everything
// still works for the session, it just isn't remembered.

import { sanitizeItems, sanitizeName } from "./live-share-core.js";
import { MAX_PLAYS, MAX_RECENT, mergePlays, mergeRecent } from "./sync-merge.js";

const PLAYLISTS_KEY = "shallowsid.playlists";
const RECENT_KEY = "shallowsid.recent";
const PLAYS_KEY = "shallowsid.plays";
const PLAYED_LISTS_KEY = "shallowsid.playedLists";
const FAVORITES_NAME = "Favorites";

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded or storage blocked: keep the in-memory copy
  }
}

export class PlaylistStore extends EventTarget {
  constructor() {
    super();
    this.playlists = read(PLAYLISTS_KEY, []);
    this.recent = read(RECENT_KEY, []);   // {path, song, at}, last played first
    this.plays = read(PLAYS_KEY, {});   // "path#song" -> [count, last played]
    // {id, at}, last played first; older versions kept bare ids
    this.playedLists = read(PLAYED_LISTS_KEY, []).map((p) => (typeof p === "string" ? { id: p } : p));
  }

  // Play history changed here ("history" event, which sync listens to).
  saveHistory() {
    this.persistHistory();
    this.dispatchEvent(new Event("history"));
  }

  persistHistory() {
    write(RECENT_KEY, this.recent);
    write(PLAYS_KEY, this.plays);
    write(PLAYED_LISTS_KEY, this.playedLists);
  }

  // Synced history in (see sync.js). `since` is the history it was merged
  // from; plays made here after that are kept on top.
  applySyncedHistory({ plays, recent, playedLists }, since) {
    this.plays = mergePlays(since.plays, this.plays, plays);
    this.recent = mergeRecent(this.recent, recent);
    this.playedLists = mergeRecent(this.playedLists, playedLists);
    this.persistHistory();
  }

  // `changed` gets a fresh `updated` time, which sync uses to resolve edits made on two devices.
  save(changed) {
    if (changed) changed.updated = Date.now();
    write(PLAYLISTS_KEY, this.playlists);
    this.dispatchEvent(new Event("change"));
  }

  // Replace everything with synced data (see sync.js).
  replaceAll(playlists) {
    this.playlists = playlists;
    this.save();
  }

  get(id) {
    return this.playlists.find((p) => p.id === id) ?? null;
  }

  // Names are sanitised on the way in (typed, imported or from a shared link).
  create(name, items = []) {
    const playlist = { id: crypto.randomUUID().slice(0, 8), name: sanitizeName(name, "New playlist"), items: sanitizeItems(items, undefined, Infinity), created: Date.now() };
    this.playlists.unshift(playlist);
    this.save(playlist);
    return playlist;
  }

  rename(id, name) {
    const p = this.get(id);
    const clean = sanitizeName(name, "");
    if (p && clean) {
      p.name = clean;
      this.save(p);
    }
  }

  // Unlisted sharing state {id, seed}, or null to stop (see live-share.js).
  setShare(id, share) {
    const p = this.get(id);
    if (!p) return;
    if (share) p.share = share;
    else delete p.share;
    this.save(p);
  }

  remove(id) {
    this.playlists = this.playlists.filter((p) => p.id !== id);
    this.save();
  }

  add(id, item) {
    const p = this.get(id);
    if (!p) return;
    p.items.push({ path: item.path, song: item.song ?? item.start ?? 1 });
    this.save(p);
  }

  removeAt(id, index) {
    const p = this.get(id);
    if (!p) return;
    p.items.splice(index, 1);
    this.save(p);
  }

  move(id, from, to) {
    const p = this.get(id);
    if (!p) return;
    const [item] = p.items.splice(from, 1);
    p.items.splice(to, 0, item);
    this.save(p);
  }

  // The Favorites playlist (flagged `favorites`); adopts an existing playlist
  // called "Favorites" so hand-made ones keep working.
  favorites() {
    const p = this.playlists.find((pl) => pl.favorites) ?? this.playlists.find((pl) => pl.name === FAVORITES_NAME);
    if (p && !p.favorites) {
      p.favorites = true;
      this.save(p);
    }
    return p ?? null;
  }

  isFavorite(item) {
    return !!this.favorites()?.items.some((i) => i.path === item.path && i.song === item.song);
  }

  // Returns true when the item is a favorite afterwards.
  toggleFavorite(item) {
    let fav = this.favorites();
    if (!fav) {
      fav = this.create(FAVORITES_NAME);
      fav.favorites = true;
    }
    const at = fav.items.findIndex((i) => i.path === item.path && i.song === item.song);
    if (at >= 0) fav.items.splice(at, 1);
    else fav.items.push({ path: item.path, song: item.song });
    this.save(fav);
    return at < 0;
  }

  addRecent(item) {
    this.recent = [{ path: item.path, song: item.song, at: Date.now() }, ...this.recent.filter((r) => !(r.path === item.path && r.song === item.song))].slice(0, MAX_RECENT);
    this.saveHistory();
  }

  markPlayed(id) {
    this.playedLists = [{ id, at: Date.now() }, ...this.playedLists.filter((p) => p.id !== id)].slice(0, MAX_RECENT);
    this.saveHistory();
  }

  // Playlists played from, last first; deleted ones (here or via sync) drop out.
  recentPlaylists() {
    return this.playedLists.map((p) => this.get(p.id)).filter(Boolean);
  }

  addPlay(item) {
    const key = `${item.path}#${item.song}`;
    this.plays[key] = [(this.plays[key]?.[0] ?? 0) + 1, Date.now()];
    const extra = Object.keys(this.plays).length - MAX_PLAYS;
    if (extra > 0) this.mostPlayed().slice(-extra).forEach((p) => delete this.plays[`${p.path}#${p.song}`]);
    this.saveHistory();
  }

  // Most played first; ties go to the most recently played.
  mostPlayed(limit = Infinity) {
    return Object.entries(this.plays)
      .sort(([, a], [, b]) => b[0] - a[0] || b[1] - a[1])
      .slice(0, limit)
      .map(([key, [count]]) => {
        const at = key.lastIndexOf("#");
        return { path: key.slice(0, at), song: Number(key.slice(at + 1)), count };
      });
  }
}

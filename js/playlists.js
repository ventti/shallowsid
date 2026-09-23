// Playlists and recently played, kept in this browser's localStorage.
// Storage can be unavailable (private mode, blocked site data); everything
// still works for the session, it just isn't remembered.

const PLAYLISTS_KEY = "shallowsid.playlists";
const RECENT_KEY = "shallowsid.recent";
const MAX_RECENT = 30;
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
    this.recent = read(RECENT_KEY, []);
  }

  save() {
    write(PLAYLISTS_KEY, this.playlists);
    this.dispatchEvent(new Event("change"));
  }

  get(id) {
    return this.playlists.find((p) => p.id === id) ?? null;
  }

  create(name, items = []) {
    const playlist = { id: crypto.randomUUID().slice(0, 8), name: name.trim() || "New playlist", items, created: Date.now() };
    this.playlists.unshift(playlist);
    this.save();
    return playlist;
  }

  rename(id, name) {
    const p = this.get(id);
    if (p && name.trim()) {
      p.name = name.trim();
      this.save();
    }
  }

  remove(id) {
    this.playlists = this.playlists.filter((p) => p.id !== id);
    this.save();
  }

  add(id, item) {
    const p = this.get(id);
    if (!p) return;
    p.items.push({ path: item.path, song: item.song ?? item.start ?? 1 });
    this.save();
  }

  removeAt(id, index) {
    const p = this.get(id);
    if (!p) return;
    p.items.splice(index, 1);
    this.save();
  }

  move(id, from, to) {
    const p = this.get(id);
    if (!p) return;
    const [item] = p.items.splice(from, 1);
    p.items.splice(to, 0, item);
    this.save();
  }

  // The Favorites playlist (flagged `favorites`); adopts an existing playlist
  // called "Favorites" so hand-made ones keep working.
  favorites() {
    const p = this.playlists.find((pl) => pl.favorites) ?? this.playlists.find((pl) => pl.name === FAVORITES_NAME);
    if (p && !p.favorites) {
      p.favorites = true;
      this.save();
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
    this.save();
    return at < 0;
  }

  addRecent(item) {
    this.recent = [{ path: item.path, song: item.song }, ...this.recent.filter((r) => !(r.path === item.path && r.song === item.song))].slice(0, MAX_RECENT);
    write(RECENT_KEY, this.recent);
  }
}

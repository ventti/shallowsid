// Recent searches, Spotify-style: queries run with Enter ({ q }) and tunes
// played from the results ({ path, song }), newest first. Kept in this
// browser's localStorage (not synced); without storage they last the session.

const STORAGE_KEY = "shallowsid.searchHistory";
export const MAX_SEARCHES = 10;

const entryKey = (e) => (e.q != null ? `q:${e.q.toLowerCase()}` : `t:${e.path}#${e.song}`);

// A clean entry, or null: queries get their spacing tidied.
function normalize(e) {
  if (typeof e === "string") e = { q: e };   // the first format stored plain queries
  if (typeof e?.q === "string") {
    const q = e.q.trim().replace(/\s+/g, " ");
    return q ? { q } : null;
  }
  if (typeof e?.path === "string" && Number.isInteger(e.song)) return { path: e.path, song: e.song };
  return null;
}

// `entry` moved (or added) to the front; a query differing only in case or
// spacing replaces the older one.
export function addSearch(list, entry, max = MAX_SEARCHES) {
  const e = normalize(entry);
  if (!e) return list;
  const key = entryKey(e);
  return [e, ...list.filter((x) => entryKey(x) !== key)].slice(0, max);
}

export class SearchHistory {
  constructor() {
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      // unreadable: start empty
    }
    this.items = (Array.isArray(saved) ? saved : []).reduceRight((list, e) => addSearch(list, e), []);
  }

  add(entry) {
    this.items = addSearch(this.items, entry);
    this.save();
  }

  remove(index) {
    this.items = this.items.filter((_, i) => i !== index);
    this.save();
  }

  clear() {
    this.items = [];
    this.save();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // storage blocked: keep the in-memory copy
    }
  }
}

// Recent searches, Spotify-style: queries run with Enter ({ q }) and tunes
// played from the results ({ path, song }), newest first. Each entry has the
// time `at` it was last used, so Sync can merge the lists of two devices
// (see mergeSearches in sync-merge.js). Kept in this browser's localStorage;
// without storage they last the session.

const STORAGE_KEY = "shallowsid.searchHistory";
export const MAX_SEARCHES = 10;

export const entryKey = (e) => (e.q != null ? `q:${e.q.toLowerCase()}` : `t:${e.path}#${e.song}`);

// A clean entry, or null: queries get their spacing tidied.
function normalize(e) {
  if (typeof e === "string") e = { q: e };   // the first format stored plain queries
  const at = Number.isFinite(e?.at) ? { at: e.at } : {};   // entries from before Sync have no time
  if (typeof e?.q === "string") {
    const q = e.q.trim().replace(/\s+/g, " ");
    return q ? { q, ...at } : null;
  }
  if (typeof e?.path === "string" && Number.isInteger(e.song)) return { path: e.path, song: e.song, ...at };
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

// Clean entries, newest first, without repeats.
export const cleanSearches = (entries, max = MAX_SEARCHES) =>
  (Array.isArray(entries) ? entries : []).reduceRight((list, e) => addSearch(list, e, max), []);

// Events: "change" after a local edit (not after applySynced).
export class SearchHistory extends EventTarget {
  constructor() {
    super();
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      // unreadable: start empty
    }
    this.items = cleanSearches(saved);
  }

  add(entry) {
    this.items = addSearch(this.items, { ...(typeof entry === "string" ? { q: entry } : entry), at: Date.now() });
    this.changed();
  }

  // Searches from elsewhere (an imported file): these first, then theirs.
  merge(entries) {
    this.items = cleanSearches([...this.items, ...(Array.isArray(entries) ? entries : [])]);
    this.changed();
  }

  remove(index) {
    this.items = this.items.filter((_, i) => i !== index);
    this.changed();
  }

  clear() {
    this.items = [];
    this.changed();
  }

  // The list merged by Sync.
  applySynced(entries) {
    this.items = cleanSearches(entries);
    this.save();
  }

  changed() {
    this.save();
    this.dispatchEvent(new Event("change"));
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // storage blocked: keep the in-memory copy
    }
  }
}

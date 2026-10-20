// Curated lists that admins manage: the popular composers, the music groups
// with a mix, and changes to the generated Hot tunes set (js/hot-tunes.js).
// The published lists are js/curated-lists.json. Admin changes wait in
// curatedLists/<list>/items/<sha256(key)> ({key, hidden, by, at}) until
// tools/sync_curated_lists.py publishes them. Pure, so it runs under `node --test`.

import { sha256Hex, str, bool } from "./tags-core.js";

export const LISTS = ["composers", "groups", "hot-tunes"];
export const LIST_NAMES = { composers: "Composers", groups: "Groups", "hot-tunes": "Hot tunes" };
export const EMPTY_LISTS = Object.freeze({ composers: [], groups: [], hotTunes: Object.freeze({ add: [], remove: [] }) });

const MAX_KEY = 200;
const TUNE_PATH = /^[A-Z_]+\/.+\.sid$/;

const isText = (s) => typeof s === "string" && s.length >= 1 && s.length <= MAX_KEY && s.trim() === s;

// Whether `key` is a valid item of `list`: a composer credit, a group name or an HVSC path.
export function validListItem(list, key) {
  return LISTS.includes(list) && isText(key) && (list !== "hot-tunes" || TUNE_PATH.test(key));
}

// The lists from curated-lists.json. Throws on a bad shape.
export function parseCuratedLists(data) {
  const strings = (list, name) => {
    if (!Array.isArray(list) || !list.every((s) => validListItem(name, s))) throw new Error(`curated-lists.json: bad ${name} list`);
    return list.slice();
  };
  if (data?.v !== 1) throw new Error("curated-lists.json: unknown version");
  return {
    composers: strings(data.composers, "composers"),
    groups: strings(data.groups, "groups"),
    hotTunes: { add: strings(data.hotTunes?.add, "hot-tunes"), remove: strings(data.hotTunes?.remove, "hot-tunes") },
  };
}

// The pattern a group's name matches in a "released" credit: the name as
// words, case-insensitive. A word boundary goes only at an edge that is a word
// character, so "Blues Muz'" still matches.
export function groupPattern(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${/^\w/.test(name) ? "\\b" : ""}${escaped}${/\w$/.test(name) ? "\\b" : ""}`, "i");
}

// The Hot tunes: the generated set, plus `add`, minus `remove`.
export function hotTunes(base, { add, remove }) {
  const set = new Set(base);
  for (const path of add) set.add(path);
  for (const path of remove) set.delete(path);
  return set;
}

// Whether `key` shows in the published `lists` (base: the generated Hot tunes).
export function publishedVisible(list, lists, key, base) {
  if (list === "hot-tunes") return lists.hotTunes.add.includes(key) || (base.has(key) && !lists.hotTunes.remove.includes(key));
  return lists[list].includes(key);
}

export const listItemId = (key) => sha256Hex(key);

// An admin's addition (hidden = false) or removal (hidden = true) of `key`;
// `exists` when the item is already in the database.
export function listItemWrite(name, cid, list, id, key, hidden, exists = false) {
  if (!validListItem(list, key)) throw new Error(list === "hot-tunes" ? "Enter an HVSC path, such as MUSICIANS/H/Hubbard_Rob/Commando.sid" : "Enter a name");
  return { update: { name: name(`curatedLists/${list}/items`, id), fields: { key: str(key), hidden: bool(hidden), by: str(cid) } },
    currentDocument: { exists }, updateTransforms: [{ fieldPath: "at", setToServerValue: "REQUEST_TIME" }] };
}

// Every item of `list` for the admin panel: the published ones and the
// database items. An item is pending until the published lists agree with
// it. Hot tunes show only the changes, not the whole generated set.
// Sorted by key.
export function listCatalog(list, lists, items, base = new Set()) {
  const keys = list === "hot-tunes" ? [...lists.hotTunes.add, ...lists.hotTunes.remove] : lists[list];
  const rows = new Map(keys.map((key) => [key, { key, hidden: !publishedVisible(list, lists, key, base), pending: false }]));
  for (const item of items) {
    const visible = publishedVisible(list, lists, item.key, base);
    rows.set(item.key, { ...item, pending: visible === item.hidden });
  }
  return [...rows.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

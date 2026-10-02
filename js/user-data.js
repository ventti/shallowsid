// All of the user's data in one file, to move it without Sync: what Sync
// carries (playlists, favorites, sound presets and preferences, play history,
// the curator identity) plus recent searches. Not encrypted, unlike Sync.
//
// Importing merges the file into what's here, as joining Sync does: nothing
// here is removed, and importing the same file twice changes nothing (play
// counts take the higher of the two, never the sum).

import { sanitizeItems, sanitizeName } from "./live-share-core.js";
import { EMPTY_CURATION, mergePlays, mergeSnapshots } from "./sync-merge.js";

export const FORMAT = "shallowsid-user-data";
export const VERSION = 1;

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);

// The file's content, from a sync snapshot and the search history.
export function toBundle(snapshot, searches = [], now = new Date()) {
  const { devices, ...data } = snapshot;   // devices belong to Sync, not to the data
  return { format: FORMAT, version: VERSION, exported: now.toISOString(), data, searches };
}

// A playlist from a file, cleaned like one from a shared link. Null if unusable.
function cleanPlaylist(p) {
  if (!isObject(p) || (typeof p.id !== "string" && typeof p.id !== "number")) return null;
  return { ...p, id: String(p.id), name: sanitizeName(p.name, p.favorites ? "Favorites" : "Imported playlist"), items: sanitizeItems(p.items, undefined, Infinity) };
}

const cleanPlays = (plays) => Object.fromEntries(Object.entries(isObject(plays) ? plays : {})
  .filter(([, v]) => Array.isArray(v) && Number.isFinite(v[0]) && v[0] >= 0 && Number.isFinite(v[1])));

// { data, searches } from a file's text; throws with a message for the user.
export function parseBundle(text) {
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch {
    throw new Error("That file isn't ShallowSID data");
  }
  if (!isObject(bundle) || bundle.format !== FORMAT || !isObject(bundle.data)) throw new Error("That file isn't ShallowSID data");
  if (!(bundle.version <= VERSION)) throw new Error("That file is from a newer ShallowSID: update this one first");
  const d = bundle.data;
  return {
    data: {
      devices: [],
      playlists: list(d.playlists).map(cleanPlaylist).filter(Boolean),
      soundPresets: list(d.soundPresets).filter(isObject),   // normalised again when applied (sound-settings.js)
      prefs: isObject(d.prefs) ? d.prefs : {},
      plays: cleanPlays(d.plays),
      recent: list(d.recent).filter((r) => isObject(r) && typeof r.path === "string"),
      playedLists: list(d.playedLists).filter((r) => isObject(r) && r.id !== undefined),
      curation: isObject(d.curation) ? { identity: isObject(d.curation.identity) ? d.curation.identity : null, notes: isObject(d.curation.notes) ? d.curation.notes : {} } : EMPTY_CURATION,
    },
    searches: list(bundle.searches),
  };
}

// The file merged into `local` (both sync snapshots).
export function mergeImport(local, imported) {
  const merged = mergeSnapshots(null, local, imported);
  // With the file as the base, each tune keeps the higher count of the two.
  return { ...merged, devices: local.devices, plays: mergePlays(imported.plays, local.plays, imported.plays) };
}

export const fileName = (now = new Date()) => `shallowsid-data-${now.toISOString().slice(0, 10)}.json`;

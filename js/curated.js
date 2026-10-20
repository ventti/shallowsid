// The published curated lists (js/curated-lists.json), as the app uses them.
// Fetched rather than imported, so a broken file can't stop the app: the
// lists are then empty, and the generated Hot tunes still show.

import { HOT_TUNES } from "./hot-tunes.js";
import { EMPTY_LISTS, groupPattern, hotTunes, parseCuratedLists } from "./curated-core.js";

const LISTS_URL = new URL("./curated-lists.json", import.meta.url).href;

// lists: as published; composers: credits; groups: [name, pattern]; hot: the Hot tunes paths.
export const curated = { lists: EMPTY_LISTS, composers: [], groups: [], hot: HOT_TUNES };

export function useCuratedLists(lists) {
  curated.lists = lists;
  curated.composers = lists.composers;
  curated.groups = lists.groups.map((name) => [name, groupPattern(name)]);
  curated.hot = hotTunes(HOT_TUNES, lists.hotTunes);
}

export async function loadCurated(url = LISTS_URL) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    useCuratedLists(parseCuratedLists(await response.json()));
  } catch (err) {
    console.warn("curated lists:", err.message);
  }
}

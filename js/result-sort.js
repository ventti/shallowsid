// Sort orders for search results. Pure, so it runs under `node --test`.
// `relevance` keeps the search worker's order; the others sort a copy.
//
// HVSC's "released" field is "<year> <publisher/group>", where the year may be
// "1985", "198?", "19??" or "1985-1986". Release sorts by the publisher part,
// Year by the (first) year; partly unknown years go after the known ones of
// their decade or century.

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export const SORTS = [
  { id: "relevance", label: "Relevance" },
  { id: "name", label: "Name" },
  { id: "folder", label: "Folder" },
  { id: "release", label: "Release" },
  { id: "year", label: "Year" },
];

export const DEFAULT_SORT = Object.freeze({ by: "relevance", desc: false });

const YEAR = /^(\d[\d?]{3})(?:-\d{2,4})?\s*/;

export function releaseYear(released = "") {
  const m = String(released).match(YEAR);
  if (!m) return Infinity;                               // no year: last
  const unknown = (m[1].match(/\?/g) ?? []).length;
  return Number(m[1].replace(/\?/g, "9")) + (unknown ? 0.5 : 0);
}

export function releaseName(released = "") {
  return String(released).replace(YEAR, "").trim();
}

const byTitle = (a, b) => collator.compare(a.title, b.title) || collator.compare(a.author, b.author) || a.song - b.song;

const COMPARE = {
  name: byTitle,
  folder: (a, b) => collator.compare(a.dir, b.dir) || collator.compare(a.name, b.name) || a.song - b.song,
  release: (a, b) => {
    const an = releaseName(a.released), bn = releaseName(b.released);
    // tunes without a publisher go last, whatever the direction
    return (!an - !bn) || collator.compare(an, bn) || releaseYear(a.released) - releaseYear(b.released) || byTitle(a, b);
  },
  year: (a, b) => releaseYear(a.released) - releaseYear(b.released) || byTitle(a, b),
};

export function sortResults(items, { by, desc } = DEFAULT_SORT) {
  const compare = COMPARE[by];
  if (!compare) return desc ? items.slice().reverse() : items;
  return items.slice().sort(desc ? (a, b) => compare(b, a) : compare);
}

export function normalizeSort(value) {
  const by = SORTS.some((s) => s.id === value?.by) ? value.by : DEFAULT_SORT.by;
  return { by, desc: by !== "relevance" && value?.desc === true };
}

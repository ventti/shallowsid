// Full-text search over the HVSC index, off the main thread.
// Receives {type:"load", text} once (the catalogue JSON the page downloaded),
// then {type:"search", id, query}; replies {type:"results", id, ids}.
//
// MiniSearch finds the candidates (prefix + fuzzy). They are then ranked in
// predictable tiers rather than by raw BM25 score, which reads as random:
//   0 title equals the query          3 every word starts a title word
//   1 every word matches the composer 4 every word matches title + composer
//   2 title starts with the query     5 anything else (fuzzy, year, path)
// and alphabetically by title, then composer, within a tier.

import MiniSearch from "https://cdn.jsdelivr.net/npm/minisearch@7.2.0/dist/es/index.js";

const MAX_RESULTS = 1000;
const TOKEN_SPLIT = /[\s/_\-.,()&!?'"]+/u;

// Lowercase and strip accents, so "hulsbeck" finds "Hülsbeck".
const normalize = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (text) => normalize(text).split(TOKEN_SPLIT).filter(Boolean);

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

let receiveCatalogue;
const catalogue = new Promise((resolve) => (receiveCatalogue = resolve));

const ready = (async () => {
  const data = JSON.parse(await catalogue);
  const tunes = data.files.map(([dir, name, title, author, released], id) => ({
    id,
    title: title || name,
    author: data.authors[author],
    released,
    path: `${data.dirs[dir]}/${name.replace(/\.sid$/i, "")}`,
  }));
  const search = new MiniSearch({
    fields: ["title", "author", "released", "path"],
    searchOptions: {
      prefix: true,
      fuzzy: (term) => (term.length > 3 ? 0.2 : false),
      combineWith: "AND",
    },
    // Split paths and underscores too, so "hubbard_rob" and "GAMES" match.
    tokenize: (text) => text.split(TOKEN_SPLIT).filter(Boolean),
    processTerm: (term) => normalize(term),
  });
  search.addAll(tunes);
  // Precomputed per tune for ranking.
  const ranked = tunes.map((t) => ({
    title: normalize(t.title).trim(),
    titleWords: words(t.title),
    authorWords: words(t.author),
  }));
  self.postMessage({ type: "ready", count: data.files.length });
  return { search, tunes, ranked };
})();
ready.catch((err) => self.postMessage({ type: "error", message: String(err?.message || err) }));

const allStart = (queryWords, fieldWords) => queryWords.every((q) => fieldWords.some((w) => w.startsWith(q)));

function tier(r, query, queryWords) {
  if (r.title === query) return 0;
  if (allStart(queryWords, r.authorWords)) return 1;
  if (r.title.startsWith(query)) return 2;
  if (allStart(queryWords, r.titleWords)) return 3;
  if (allStart(queryWords, [...r.titleWords, ...r.authorWords])) return 4;
  return 5;
}

self.onmessage = async (e) => {
  if (e.data.type === "load") return receiveCatalogue(e.data.text);
  const { id, query } = e.data;
  const { search, tunes, ranked } = await ready;
  const q = normalize(query).trim();
  const qWords = words(query);
  const ids = search
    .search(query)
    .map((hit) => ({ id: hit.id, tier: tier(ranked[hit.id], q, qWords) }))
    .sort((a, b) =>
      a.tier - b.tier ||
      collator.compare(tunes[a.id].title, tunes[b.id].title) ||
      collator.compare(tunes[a.id].author, tunes[b.id].author))
    .slice(0, MAX_RESULTS)
    .map((hit) => hit.id);
  self.postMessage({ type: "results", id, ids });
};

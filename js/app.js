import { nameKey, nextPlaylistName, sameItems } from "./playlist-merge.js";
import { playlistImportSheet } from "./playlist-import-sheet.js";
import { matchZip } from "./zip-playlist.js";
// ShallowSID: hash router + views (Search, Browse, Playlists, Share).

import { loadIndex, sidFeatures } from "./index-store.js";
import { NowPlaying } from "./now-playing.js";
import { Player, shuffle } from "./player/player.js";
import { connectMediaSession } from "./player/media-session.js";
import { decodeShare, encodeShare, nameFromFileName, parseM3U8, safeFileName, toM3U8 } from "./playlist-format.js";
import { PlaylistStore } from "./playlists.js";
import { toEngineConfig } from "./sound-profile.js";
import { SoundSettings } from "./sound-settings.js";
import { RomStore } from "./roms.js";
import { RomSheet } from "./rom-sheet.js";
import { SoundSheet } from "./sound-sheet.js";
import { COMPOSER_ALIASES } from "./suggestions.js";
import { curated, loadCurated } from "./curated.js";
import { LIST_NAMES, LISTS, listCatalog } from "./curated-core.js";
import { HOT_TUNES } from "./hot-tunes.js";
import { DEFAULT_SORT, SORTS, normalizeSort, sortResults } from "./result-sort.js";
import { SearchHistory } from "./search-history.js";
import { ABOUT, HELP } from "./help.js";
import { FIELDS, describe as describeFilter, exactYear, fieldHint, matches, parseQuery, perSubtune } from "./num-query.js";
import { mixDefinition, mixTunes, pickMixes, weekSeed } from "./mixes.js";
import { SyncService } from "./sync.js";
import { LiveShare } from "./live-share.js";
import { parsePlaylistLink, sanitizeItems, sanitizeName } from "./live-share-core.js";
import { SyncSheet } from "./sync-sheet.js";
import { TagService } from "./tags.js";
import { TagSheet } from "./tag-sheet.js";
import { definitionId, tagCatalog, TAG_GROUPS, WHOLE_TUNE, isCuratorId, isInviteSecret } from "./tags-core.js";
import { playlistArtStyle } from "./artwork.js";
import { composerName } from "./composer-colors.js";
import { paintAvatars } from "./avatars.js";
import { Install, registerServiceWorker } from "./install.js";
import { Notices } from "./notices.js";
import { dataWidget, syncWidget } from "./notice-widgets.js";
import { fileName as userDataFileName, mergeImport, parseBundle, toBundle } from "./user-data.js";
import { actionSheet, confirmDialog, duplicateDialog, esc, prompt, saveFile, subtuneDialog, thumb, toast, tuneRow } from "./ui.js";

const PAGE_SIZE = 100;
// SID files come from the gzip-enabled Firebase mirror, refreshed by CI.
// The official site and an optional local hvsc/ copy remain fallbacks.
const SID_SOURCES = [
  "https://shallowsid.web.app/",
  "https://www.hvsc.c64.org/download/C64Music/",
  new URL("../hvsc/", import.meta.url).href,
];
const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
const SUGGESTION_COUNT = 10;
const FAVORITE_COMPOSER_COUNT = 10;
const SHELF_COUNT = 10;
const MOST_PLAYED_COUNT = 50;
const PLAY_COUNT_SECONDS = 30;   // heard this long (or half of a shorter tune) counts as a play
const SORT_KEYS = { search: "shallowsid.searchSort", list: "shallowsid.listSort" };

const $ = (id) => document.getElementById(id);
// Read before anything here saves to localStorage: no ShallowSID data yet means a new user.
const newUser = (() => {
  try {
    return !Object.keys(localStorage).some((key) => key.startsWith("shallowsid."));
  } catch {
    return false;   // storage blocked: don't welcome on every visit
  }
})();
const dom = {
  title: $("title"), back: $("back"), actions: $("toolbar-actions"), searchToolbar: $("search-toolbar"),
  searchbar: $("searchbar"), content: $("content"), view: $("view"), infinite: $("infinite"),
  tabBar: $("tab-bar"), importInput: $("import-input"), titleToolbar: $("title-toolbar"),
};

const store = new PlaylistStore();
const searchHistory = new SearchHistory();
const sound = new SoundSettings();
const player = new Player({
  sidUrls: (item) => SID_SOURCES.map((base) => base + encodePath(item.path)), prerender: sound.prerender, engine: sound.engine, u64Host: sound.u64Host,
});
const romStore = new RomStore();
player.romsReady = romStore.load().then((entries) => { player.roms = entries; }).catch(() => {});
const romSheet = new RomSheet(romStore, (entries) => player.setRoms(entries));
connectMediaSession(player);
const soundSheet = new SoundSheet(sound);
// Hand the engine a new setup only when it really changes.
let appliedSound = "";
function applySound(settings = sound.current) {
  const config = toEngineConfig(settings);
  const key = JSON.stringify(config);
  if (key === appliedSound) return;
  appliedSound = key;
  player.setSound(config);
}
sound.addEventListener("change", () => {
  applySound();
  player.setPrerender(sound.prerender);
  player.setOutput(sound.engine, sound.u64Host);
});
soundSheet.addEventListener("preview", ({ detail: { chip, knobs } }) => {
  const current = sound.current;
  applySound({ ...current, [chip]: { ...current[chip], ...knobs } });
});
soundSheet.addEventListener("adjusting", (e) => player.setAdjusting(e.detail));
// A device too slow for reSIDfp gets SIDLite, unless an engine was picked by hand:
// when its first pre-render runs under 2x realtime, or playback stalls twice in a minute.
const SLOW_RENDER_RATIO = 2;
const STALL_WINDOW_MS = 60_000;
let stalls = [];
player.speedMeasured = sound.renderSpeed > 0;   // once per device
const preferLightEngine = () => sound.autoEngine("sidlite");   // quietly: it shows in Sound
player.addEventListener("speed", ({ detail: { engine, ratio } }) => {
  if (engine !== "residfp" || sound.renderSpeed) return;
  sound.setRenderSpeed(ratio);
  if (ratio < SLOW_RENDER_RATIO) preferLightEngine();
});
player.addEventListener("stall", ({ detail: { engine } }) => {
  if (engine !== "residfp") return;
  const now = Date.now();
  stalls = [...stalls.filter((t) => now - t < STALL_WINDOW_MS), now];
  if (stalls.length >= 2) preferLightEngine();
});
applySound();
const tags = new TagService();
const tagSheet = new TagSheet(tags);
const sync = new SyncService({ store, sound, curation: tags });
const syncSheet = sync.configured ? new SyncSheet(sync, { onOpen: () => go("#/settings/sync") }) : null;
const liveShare = new LiveShare({ store });
liveShare.addEventListener("error", (e) => toast(e.detail, { color: "danger" }));
// Remote changes landed: show them. Folders and search results only show
// synced data in their favorite marks, so they keep their rows and scroll.
sync.addEventListener("applied", () => {
  if (["browse", "search", "composer"].includes(currentRoute().name)) refreshRowMarks();
  else render();
  nowPlaying.refreshFavorite();
});
sync.addEventListener("status", () => {
  const icon = document.querySelector("#sync-open ion-icon");
  if (icon) icon.name = syncIcon();
});
const syncIcon = () => (!sync.enabled ? "cloud-outline" : sync.status === "error" ? "cloud-offline-outline" : "cloud-done-outline");
const install = new Install();
const showInstall = () => ($("install-app-wrap").hidden = !install.available);
install.addEventListener("change", showInstall);
showInstall();
$("install-app").addEventListener("click", (e) => {
  e.preventDefault();
  install.install();
});
registerServiceWorker();
const notices = new Notices({
  newUser,
  widgets: {
    sync: syncWidget(sync, syncSheet),
    data: dataWidget({ exportData: () => exportUserData(), importData: () => $("user-data-input").click() }),
  },
});
globalThis.shallowsid = { player, store, sound, sync, tags, notices };   // handy from the devtools console
const nowPlaying = new NowPlaying(player, {
  onAddToPlaylist: (item) => addToPlaylist(item),
  onShowFolder: (dir) => go(`#/browse/${encodeURIComponent(dir)}`),
  onShare: (item) => shareTune(item),
  onOpenComposer: (credit) => go(composerHref(composerName(credit))),
  isFavorite: (item) => store.isFavorite(item),
  onToggleFavorite: (item) => toggleFavorite(item),
  tags,
  onOpenTag: (id) => go(tagHref(id)),
  onEditTags: (item) => tagSheet.open(item),
});
// Curators and admins get a tab right of Settings: "Admin" for admins,
// "Curation" for curators (also once turned off, to see why).
function showCurationTab() {
  const tab = document.querySelector('ion-tab-button[tab="curation"]');   // Ionic replaces tab buttons' ids
  tab.hidden = !tags.cid;
  // A fresh label: setting a hydrated ion-label's textContent appends to it.
  const text = tags.isAdmin ? "Admin" : "Curation";
  if (tab.dataset.label !== text) {
    tab.dataset.label = text;
    tab.querySelector("ion-label").replaceWith(Object.assign(document.createElement("ion-label"), { textContent: text }));
  }
  tab.querySelector("ion-icon").name = tags.isAdmin ? "shield-checkmark" : "pricetags";
}
// New tags (saved here, read live, synced identity): update what shows them.
tags.addEventListener("change", () => {
  nowPlaying.refreshTags();
  showCurationTab();
  if (["tag", "tags", "curation"].includes(currentRoute().name)) render();
});

let index = null;               // IndexStore, once loaded
let listItems = [];             // queue items backing the list currently shown
let listShown = 0;
let listOptions = {};           // {playlistId} when the list is a playlist
let searchQuery = "";
let searchSeq = 0;
let lastResults = null;
// Search results and tune lists (folders, composer pages) each remember their
// last order, which becomes the default.
const sorts = { search: loadSort("search"), list: loadSort("list") };

// ---- search worker ----------------------------------------------------------

const searchWorker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
let searchReady = false;
let searchError = null;
let lastIds = null;             // result ids; turned into tunes once the index is in
let searchFilter = null;        // the query's {text, filter, error} (num-query.js)
let lastTotal = 0;              // every match, including those past the worker's limit
searchWorker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "ready") {
    searchReady = true;
    if (searchQuery) runSearch(searchQuery);
  } else if (msg.type === "error") {
    failSearch(msg.message);
  } else if (msg.type === "results" && msg.id === searchSeq) {
    lastIds = msg.ids;
    lastTotal = msg.total ?? msg.ids.length;
    lastResults = null;
    if (currentRoute().name === "search") renderSearch();
  }
};
// A worker that fails to load (unsupported browser, blocked script) only fires this.
searchWorker.onerror = (e) => failSearch(e.message || "the search worker failed to start");

function failSearch(message) {
  searchError = message;
  console.error("search:", message);
  if (currentRoute().name === "search") renderSearch();
}

function searchFor(query) {
  dom.searchbar.value = query;
  if (currentRoute().name !== "search") location.hash = "#/search";
  runSearch(query);
}

// ---- recent searches (Spotify-style) -------------------------------------------

// Focusing the empty search bar swaps Home for the recent searches: queries
// run with Enter and tunes played from the results. The list stays while it's
// being used (scrolled, tapped) and closes with Esc, a tap outside it, the
// Home tab or leaving.
let recentOpen = false;
let searchFocused = false;
let pointerInRecent = false;

function setRecentOpen(open) {
  if (open === recentOpen) return;
  recentOpen = open;
  if (isHome()) renderSearch();
}

const isHome = () => ["", "home"].includes(currentRoute().name);

function recentRow(entry, i) {
  const remove = `<ion-button slot="end" fill="clear" color="medium" data-recent-remove="${i}" aria-label="Remove from recent searches"><ion-icon slot="icon-only" name="close"></ion-icon></ion-button>`;
  if (entry.q != null) {
    return `<ion-item button detail="false" data-recent="${i}">
      <div slot="start" class="thumb recent-query"><ion-icon name="search"></ion-icon></div>
      <ion-label><h2>${esc(entry.q)}</h2><p>Search</p></ion-label>${remove}
    </ion-item>`;
  }
  const [item] = resolveItems([entry]);
  if (item.missing) return "";
  const song = item.songs > 1 ? ` <span class="song-chip">#${item.song}/${item.songs}</span>` : "";
  return `<ion-item button detail="false" data-recent="${i}">
    <div slot="start">${thumb(item)}</div>
    <ion-label><h2>${esc(item.title)}${song}</h2><p>Tune · ${esc(item.author)}</p></ion-label>${remove}
  </ion-item>`;
}

const recentSearches = () => `
  <section class="recent-searches">
    <h2 class="section-title">Recent searches</h2>
    <ion-list lines="none">${searchHistory.items.map(recentRow).join("")}</ion-list>
    <div class="recent-clear"><ion-button fill="outline" shape="round" color="medium" data-clear-searches>Clear recent searches</ion-button></div>
  </section>`;

async function blurSearchbar() {
  (await dom.searchbar.getInputElement()).blur();
}

function openRecent(entry, i) {
  searchHistory.add(entry);
  if (entry.q != null) {
    recentOpen = false;
    searchFor(entry.q);
    blurSearchbar();
    return;
  }
  const [item] = resolveItems([entry]);
  player.setQueue([item], 0);
  blurSearchbar();
  renderSearch();   // it moved to the top
}

// Taps in the list blur the bar first: remember where the pointer went.
dom.view.addEventListener("pointerdown", (e) => {
  pointerInRecent = !!e.target.closest(".recent-searches");
  if (!pointerInRecent && !searchFocused) setRecentOpen(false);
}, true);
dom.searchbar.addEventListener("ionFocus", () => {
  searchFocused = true;
  if (!searchQuery) setRecentOpen(true);
});
dom.searchbar.addEventListener("ionBlur", () => {
  searchFocused = false;
  if (!pointerInRecent) setRecentOpen(false);
  pointerInRecent = false;
});
dom.searchbar.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && dom.searchbar.value?.trim()) searchHistory.add({ q: dom.searchbar.value });
  else if (e.key === "Escape") {
    setRecentOpen(false);
    blurSearchbar();
  }
});

function runSearch(query) {
  searchQuery = query.trim();
  // Results live at #/search, an empty search is Home (no history entry per keystroke).
  const route = currentRoute().name;
  if (searchQuery && route !== "search") history.replaceState(null, "", "#/search");
  else if (!searchQuery && route === "search") history.replaceState(null, "", "#/home");
  lastResults = lastIds = searchFilter = null;
  searchSeq++;   // results still on their way for an earlier query get dropped
  if (searchQuery && !searchQuery.startsWith("#")) {
    searchFilter = parseQuery(searchQuery);
    // Comparisons alone need no word search: they go through the whole catalogue.
    if (searchFilter.text && !searchFilter.error) {
      searchWorker.postMessage({ type: "search", id: searchSeq, query: searchFilter.text, all: !!searchFilter.filter });
    }
  }
  renderSearch();
}

// ---- helpers ----------------------------------------------------------------

// A fresh handful of composers per visit, stable while the page is open.
// The chip shows the handle HVSC gives in parentheses, else the credit itself;
// an alias replaces both label and search.
function composerChip(credit) {
  const alias = COMPOSER_ALIASES[credit];
  return alias ? [alias, alias] : [credit.match(/\(([^)]+)\)\s*$/)?.[1] ?? credit, credit];
}
let suggestions = null;
const popularComposers = () => suggestions ??= shuffle(curated.composers).slice(0, SUGGESTION_COUNT).map(composerChip);
const chips = (list) => `<div class="chips">${list.map(([label, name]) => `<ion-chip data-open-composer="${esc(name)}">${esc(label)}</ion-chip>`).join("")}</div>`;

const playedWhere = () => (sync.enabled ? "on your devices" : "on this device");
const mostPlayedItems = () => resolveItems(store.mostPlayed(MOST_PLAYED_COUNT)).filter((i) => !i.missing);
const recentItems = () => resolveItems(store.recent).filter((i) => !i.missing);

// "Jump back in" cards: Your most played, Favorites, Recently played, then
// playlists last played.
function shelfCards() {
  const cards = [];
  const mostPlayed = mostPlayedItems().length;
  if (mostPlayed) cards.push({ href: "#/most-played", name: "Your most played", count: mostPlayed, art: "most-played-art", icon: "trending-up" });
  const favorites = store.favorites();
  if (favorites?.items.length) cards.push({ playlist: favorites });
  const recent = recentItems().length;
  if (recent) cards.push({ href: "#/recent", name: "Recently played", count: recent, art: "recent-art", icon: "time-outline" });
  for (const p of store.recentPlaylists()) if (p !== favorites) cards.push({ playlist: p });
  return cards.slice(0, SHELF_COUNT).map((c) => c.playlist
    ? { href: `#/playlist/${c.playlist.id}`, name: c.playlist.name, count: c.playlist.items.length,
        ...(c.playlist.favorites ? { art: "favorites-thumb", icon: "star" } : playlistArt(c.playlist)) }
    : c);
}

// "Mixes for you": which mixes show changes each visit; their tunes each week.
const MIX_SEED = weekSeed();
const MIX_PICK_SEED = Math.random().toString(36).slice(2);
const mixCache = new Map();

function mixItems(id) {
  if (!mixCache.has(id)) mixCache.set(id, mixTunes(id, index.tunes, MIX_SEED, curated).map((t) => asItem(t)));
  return mixCache.get(id);
}

// Covers are quiet type on the app's gradients (as on "Jump back in"), a
// different one per card, so the shelf doesn't compete with the tune art. A
// composer mix shows that composer's critter, seeded as on their page.
const MIX_GRADIENTS = 6;
let mixes = null;
function mixCards() {
  mixes ??= pickMixes(index.tunes, curated, MIX_PICK_SEED);
  return mixes.map((m, i) => ({
    href: `#/mix/${encodeURIComponent(m.id)}`, name: m.title, sub: m.note,
    art: `mix-art mix-art-${i % MIX_GRADIENTS}`, label: m.label,
    ...(m.composer ? { avatar: COMPOSER_ALIASES[m.composer] ?? m.composer } : { icon: m.icon }),
  }));
}

function renderMix(id) {
  const mix = mixDefinition(id, curated);
  if (!mix) return go("#/home");
  const items = mixItems(id);
  renderGenerated(mix.title, items, `${mix.note} · ${items.length} picked at random`);
}

// A playlist's cover mosaic, or a note icon while it's empty.
function playlistArt(playlist) {
  const style = playlistArtStyle(playlist, (path) => index?.get(path)?.author);
  return { art: "playlist-art", style, icon: style ? null : "musical-notes" };
}

const artBox = (cls, { art, style, icon, avatar, label }, attrs = "") =>
  `<div ${attrs} class="${cls} ${art}" ${style ? `style="${style}"` : ""}>${icon ? `<ion-icon name="${icon}"></ion-icon>` : ""}${avatar ? `<div class="art-avatar" data-composer="${esc(avatar)}"><ion-icon name="person"></ion-icon></div>` : ""}${label ? `<span class="art-label">${esc(label)}</span>` : ""}</div>`;

const shelf = (cards) => `<div class="shelf">${cards.map((c) => `
  <a class="shelf-card" href="${c.href}">
    ${artBox("shelf-art", c)}
    <span class="shelf-title">${esc(c.name)}</span>
    <span class="shelf-sub">${c.sub ? esc(c.sub) : `${c.count} tune${c.count === 1 ? "" : "s"}`}</span>
  </a>`).join("")}</div>`;

// Composers by the plays of all their tunes; HVSC credits unknown ones as "<?>".
function favoriteComposers() {
  const plays = new Map();
  for (const { path, count } of store.mostPlayed()) {
    const credit = index.get(path)?.author;
    const author = COMPOSER_ALIASES[credit] ?? credit;
    if (author && author !== "<?>") plays.set(author, (plays.get(author) ?? 0) + count);
  }
  return [...plays].sort((a, b) => b[1] - a[1]).slice(0, FAVORITE_COMPOSER_COUNT).map(([credit]) => composerChip(credit));
}

const asItem = (tune, song) => ({ ...tune, song: song ?? tune.start });

function resolveItems(items) {
  return items.map(({ path, song }) => {
    const tune = index?.get(path);
    return tune ? asItem(tune, Math.min(song, tune.songs)) : { path, song, missing: true };
  });
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function currentRoute() {
  // No hash (plain site URL) splits to [""]: treat it as Home.
  const [name, ...rest] = location.hash.replace(/^#\/?/, "").split("/");
  return { name: name || "home", arg: rest.length ? decodeURIComponent(rest.join("/")) : "" };
}

function setChrome({ title, back = null, actions = "", search = false, tab }) {
  dom.title.textContent = title;
  document.title = title ? `${title} · ShallowSID` : "ShallowSID - The easy C64 music web player";
  dom.titleToolbar.hidden = !title && !back && !actions;   // Home and search results show just the search bar
  dom.back.hidden = !back;
  // "history" goes back to wherever the page was opened from (Home when opened directly).
  dom.back.onclick = back === "history" ? () => (history.length > 1 ? history.back() : go("#/home")) : back ? () => go(back) : null;
  dom.actions.innerHTML = actions;
  dom.searchToolbar.hidden = !search;
  if (!search) recentOpen = false;
  dom.tabBar.selectedTab = tab;
}

// Render a (possibly long) list of tunes with infinite scrolling, or with
// `all` every row, a page per frame so a big folder (~1300 tunes) doesn't stall.
// `sections` ([{title, start, count}]) puts a heading above each part.
function showList(container, items, options = {}) {
  listItems = items;
  listOptions = options;
  listShown = 0;
  container.innerHTML = `<ion-list class="tune-list" id="tune-list"></ion-list>`;
  appendPage();
}

function appendPage() {
  const list = $("tune-list");
  if (!list) return;
  const isCurrent = currentMatcher(listItems);
  const favorites = favoriteKeys();
  const page = listItems.slice(listShown, listShown + PAGE_SIZE);
  const heading = (at) => {
    const section = listOptions.sections?.find((s) => s.start === at);
    return section ? `<ion-list-header><ion-label>${esc(section.title)}</ion-label></ion-list-header>` : "";
  };
  list.insertAdjacentHTML("beforeend", page.map((item, i) => heading(listShown + i) + tuneRow(item, listShown + i, {
    missing: item.missing,
    current: isCurrent(item),
    otherSubtune: isOtherSubtune(item),
    favorite: favorites.has(itemKey(item)),
    tags: item.missing ? [] : rowTags(item),
  })).join(""));
  listShown += page.length;
  const more = listShown < listItems.length;
  dom.infinite.disabled = !more || listOptions.all;
  // Until another list replaces this one.
  if (more && listOptions.all) requestAnimationFrame(() => list.isConnected && appendPage());
}

const itemKey = (item) => `${item.path}#${item.song}`;
const favoriteKeys = () => new Set((store.favorites()?.items ?? []).map(itemKey));

// Which of `items` is the tune playing. After a subtune switch that is still
// the row it was queued from, unless the list has a row for the new subtune.
function currentMatcher(items) {
  const cur = player.current;
  if (!cur) return () => false;
  const listed = items.some((item) => item.path === cur.path && item.song === cur.song);
  const song = listed ? cur.song : (cur.queuedSong ?? cur.song);
  return (item) => item.path === cur.path && item.song === song;
}

// A current row that is playing another of its subtunes than the one listed.
const isOtherSubtune = (item) => item.song !== player.current?.song;

// Update the "now playing" and favorite marks of the rows shown, in place.
function refreshRowMarks() {
  const isCurrent = currentMatcher(listItems);
  const favorites = favoriteKeys();
  document.querySelectorAll("#tune-list .tune-row[data-play]").forEach((row) => {
    const item = listItems[Number(row.dataset.play)];
    if (!item) return;
    row.classList.toggle("is-current", isCurrent(item));
    row.classList.toggle("is-other-subtune", isOtherSubtune(item));
    row.classList.toggle("is-favorite", favorites.has(itemKey(item)));
  });
}

// ---- views ------------------------------------------------------------------

// Home is the search view with the search cleared.
function renderHome() {
  searchQuery = "";
  lastResults = lastIds = null;
  dom.searchbar.value = "";
  renderSearch();
}

function renderSearch() {
  setChrome({ title: "", search: true, tab: "home" });
  if (!searchQuery && recentOpen && searchHistory.items.length) {
    dom.view.innerHTML = recentSearches();
    dom.infinite.disabled = true;
    return;
  }
  if (!searchQuery) {
    const composers = favoriteComposers();
    const cards = shelfCards();
    dom.view.innerHTML = `
      <section class="home">
        <h2 class="section-title">Popular composers</h2>
        ${chips(popularComposers())}
        ${composers.length ? `<h2 class="section-title">Your favorite composers</h2>${chips(composers)}` : ""}
        ${cards.length ? `<h2 class="section-title">Jump back in</h2>${shelf(cards)}` : ""}
        ${tagChips()}
        <h2 class="section-title">Mixes for you</h2>${shelf(mixCards())}
      </section>`;
    paintAvatars(dom.view);
    dom.infinite.disabled = true;
    return;
  }
  if (searchQuery.startsWith("#")) return renderTagSearch(searchQuery.slice(1));
  if (searchError) {
    dom.view.innerHTML = `<div class="empty"><p>Search is unavailable: ${esc(searchError)}</p><p>Browse still works.</p></div>`;
    dom.infinite.disabled = true;
    return;
  }
  if (searchFilter?.error) {
    dom.view.innerHTML = `<div class="empty"><p>${esc(searchFilter.error)}</p></div>`;
    dom.infinite.disabled = true;
    return;
  }
  const filter = searchFilter?.filter;
  const wordSearch = !!searchFilter?.text;
  if (!lastResults && index) {
    if (filter && !wordSearch) lastResults = filterTunes(index.tunes, filter);
    else if (lastIds) lastResults = filter ? filterTunes(lastIds.map((id) => index.tunes[id]), filter) : lastIds.map((id) => asItem(index.tunes[id]));
  }
  if ((wordSearch && !searchReady) || !lastResults) {
    dom.view.innerHTML = `<div class="empty"><ion-spinner></ion-spinner><p>${searchReady ? "Searching…" : "Indexing HVSC…"}</p></div>`;
    dom.infinite.disabled = true;
    return;
  }
  if (!lastResults.length) {
    const hint = fieldHint(searchFilter?.unknown);
    dom.view.innerHTML = `<div class="empty"><p>No tunes match “${esc(searchQuery)}”.</p>${hint ? `<p>${esc(hint)}</p>` : ""}</div>`;
    dom.infinite.disabled = true;
    return;
  }
  const shown = lastResults.length;
  const noun = filter && perSubtune(filter) ? "subtune" : "tune";
  const count = filter ? `${shown.toLocaleString()} ${noun}${shown === 1 ? "" : "s"} with ${describeFilter(filter)}`
    : lastTotal > shown ? `The best ${shown.toLocaleString()} of ${lastTotal.toLocaleString()} tunes. Add a word to narrow it down.`
    : shown === 1 ? "1 tune" : `${shown.toLocaleString()} tunes`;
  dom.view.innerHTML = `${sortBar("search", count)}<div id="results"></div>`;
  showList($("results"), sortResults(lastResults, sorts.search));
}

// A row's tag labels: the whole tune's, then the subtune's own.
function rowTags(item) {
  const { whole, sub } = tags.tagsFor(item);
  return [...whole, ...sub].map((id) => tags.label(id));
}

// The tunes passing a numeric filter: one item per subtune when it compares
// per-subtune values (BPM, length), else per tune, playing from its start song.
function filterTunes(tunes, filter) {
  const out = [];
  const each = perSubtune(filter);
  for (const tune of tunes) {
    const songs = each ? Array.from({ length: tune.songs }, (_, i) => i + 1) : [tune.start];
    for (const song of songs) {
      if (matches(filter, (field) => numericValue(tune, song, field))) out.push(asItem(tune, song));
    }
  }
  return out;
}

function numericValue(tune, song, field) {
  switch (field) {
    case "bpm": return tags.bpmFor({ path: tune.path, songs: tune.songs, song, bpmEstimates: tune.bpmEstimates }).bpm;
    case "length": return tune.lengths?.[song - 1] || null;
    case "year": return exactYear(tune.released);
    case "subtunes": return tune.songs;
    case "subtune": return song;
    case "speed": return sidFeatures(tune, song)?.speed ?? null;
    default: {
      // The 0/1 features; unknown (not analysed) never matches.
      const f = FIELDS[field]?.flag ? sidFeatures(tune, song) : null;
      return f ? Number(f[field]) : null;
    }
  }
}

// ---- sorting (Spotify-style: a sort button with a direction arrow) ----------
// Search results and tune lists have it in a row above the list, so the search
// bar keeps its width.
// "relevance" keeps a list's own order: the search ranking, or HVSC's order
// in a list (shown as "Default").

function loadSort(kind) {
  try {
    return normalizeSort(JSON.parse(localStorage.getItem(SORT_KEYS[kind])));
  } catch {
    return { ...DEFAULT_SORT };
  }
}

const sortDirection = ({ by, desc }) => (by === "year" ? (desc ? "newest first" : "oldest first") : desc ? "Z–A" : "A–Z");
const sortLabel = (kind, id) => (kind === "list" && id === "relevance" ? "Default" : SORTS.find((s) => s.id === id).label);

function sortCaption(kind, { by, desc }, long = false) {
  const label = sortLabel(kind, by);
  return long && by !== "relevance" ? `${label} (${sortDirection({ by, desc })})` : label;
}

// A folder page has no use for sorting by folder: it falls back to Default there.
const listSortsLeftOut = () => (currentRoute().name === "browse" ? ["folder"] : []);

function listSort() {
  const sort = sorts.list;
  return listSortsLeftOut().includes(sort.by) ? { ...DEFAULT_SORT } : sort;
}

// The row above a sortable tune list: its count (unless the page shows it
// already), the order's name (opens the choices) and an arrow that flips the
// direction in one tap. `kind` is "search" or "list".
function sortBar(kind, note) {
  const sort = kind === "list" ? listSort() : sorts.search;
  const arrow = sort.by === "relevance" ? "" : `
    <ion-button data-sort-direction="${kind}" class="sort-direction" fill="clear" size="small" aria-label="Reverse order (now ${sortDirection(sort)})">
      <ion-icon slot="icon-only" name="${sort.desc ? "arrow-down" : "arrow-up"}"></ion-icon>
    </ion-button>`;
  return `<div class="list-bar">
    <p class="result-count">${esc(note ?? "")}</p>
    <ion-button data-sort="${kind}" class="sort-button" fill="clear" size="small" aria-label="Sort by ${esc(sortCaption(kind, sort))}">${esc(sortCaption(kind, sort))}</ion-button>${arrow}
  </div>`;
}

const tuneCount = (count) => (count === 1 ? "1 tune" : `${count.toLocaleString()} tunes`);

function setSort(kind, next) {
  sorts[kind] = normalizeSort(next);
  try {
    localStorage.setItem(SORT_KEYS[kind], JSON.stringify(sorts[kind]));
  } catch {
    // storage blocked: the order lasts for this visit
  }
  if (kind === "search") {
    if (lastResults) renderSearch();
  } else {
    render();
  }
}

// Picking the current order again also reverses it; the arrow does it in one tap.
function chooseSort(kind) {
  const sort = kind === "list" ? listSort() : sorts.search;
  const leftOut = kind === "list" ? listSortsLeftOut() : [];
  actionSheet("Sort by", SORTS.filter((s) => !leftOut.includes(s.id)).map((s) => {
    const current = s.id === sort.by;
    return {
      text: current ? sortCaption(kind, sort, true) : sortLabel(kind, s.id),
      icon: current ? "checkmark" : undefined,
      cssClass: current ? "sort-current" : undefined,
      handler: () => setSort(kind, { by: s.id, desc: current ? !sort.desc : false }),
    };
  }));
}

function renderBrowse(dir) {
  const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  setChrome({
    title: dir ? dir.split("/").pop().replace(/_/g, " ") : "Browse",
    back: dir ? `#/browse/${encodeURIComponent(parent)}` : null,
    tab: "browse",
    actions: dir ? `<ion-button id="play-all" aria-label="Play all"><ion-icon slot="icon-only" name="play-circle"></ion-icon></ion-button>` : "",
  });
  const { dirs, tunes } = index.list(dir);
  dom.view.innerHTML = `
    ${dir ? `<p class="breadcrumb">${esc(dir)}</p>` : ""}
    <ion-list class="dir-list">${dirs.map((d) => `
      <ion-item button detail="true" href="#/browse/${encodeURIComponent(d)}" lines="full">
        <ion-icon slot="start" name="folder-outline" color="primary"></ion-icon>
        <ion-label>${esc(d.split("/").pop().replace(/_/g, " "))}</ion-label>
      </ion-item>`).join("")}
    </ion-list>
    ${tunes.length > 1 ? sortBar("list", tuneCount(tunes.length)) : ""}
    <div id="dir-tunes"></div>`;
  const items = sortResults(tunes.map((t) => asItem(t)), listSort());
  showList($("dir-tunes"), items, { all: true });
  $("play-all")?.addEventListener("click", () => items.length && player.setQueue(items, 0));
}

function renderSettingsPage(page) {
  if (page === "help" || page.startsWith("help/")) return renderHelp(page.slice(5));
  if (page === "roms") {
    setChrome({ title: "C64 ROMs", tab: "settings", back: "#/settings" });
    dom.infinite.disabled = true;
    dom.view.hidden = true;
    romSheet.open();
    return;
  }
  if (page !== "sound" && (page !== "sync" || !syncSheet)) return renderSettings();
  setChrome({ title: page === "sound" ? "Sound" : "Playlist cloud sync", tab: "settings", back: "#/settings" });
  dom.infinite.disabled = true;
  dom.view.hidden = true;
  if (page === "sound") {
    soundSheet.root.hidden = false;
    dom.actions.appendChild(soundSheet.revertButton);
    soundSheet.open();
  } else {
    syncSheet.root.hidden = false;
    syncSheet.render();
  }
}

function renderSettings() {
  setChrome({ title: "Settings", tab: "settings" });
  dom.infinite.disabled = true;
  dom.view.innerHTML = `<div class="settings-container sound-content"><ion-list inset class="settings-menu">
    ${syncSheet ? `<ion-item button detail="true" id="sync-open" href="#/settings/sync" lines="full">
      <ion-icon slot="start" name="${syncIcon()}"></ion-icon>
      <ion-label>Playlist cloud sync</ion-label>
    </ion-item>` : ""}
    <ion-item button detail="true" id="sound-open" href="#/settings/sound" lines="full">
      <ion-icon slot="start" name="options-outline"></ion-icon>
      <ion-label>Sound</ion-label>
    </ion-item>
    <ion-item button detail="true" href="#/settings/roms" lines="none">
      <ion-icon slot="start" name="hardware-chip-outline"></ion-icon>
      <ion-label>C64 ROMs</ion-label>
    </ion-item>
  </ion-list><ion-list inset class="settings-menu">
    <ion-item button detail="true" href="#/settings/help" lines="full">
      <ion-icon slot="start" name="help-circle-outline"></ion-icon>
      <ion-label>Help</ion-label>
    </ion-item>
    <ion-item button detail="true" href="#/help/about" lines="none">
      <ion-icon slot="start" name="information-circle-outline"></ion-icon>
      <ion-label>About</ion-label>
    </ion-item>
  </ion-list></div>`;
}

function renderHelp(topic) {
  const section = topic === "about" ? ABOUT : HELP.find((s) => s.id === topic);
  setChrome({ title: section?.title ?? "Help", tab: "settings", back: section && section !== ABOUT ? "#/settings/help" : "#/settings" });
  dom.infinite.disabled = true;
  dom.view.innerHTML = `<div class="settings-container sound-content">${section
    ? `<article class="help-content">${section.html}</article>`
    : `<ion-list inset class="settings-menu">${HELP.map((s, i) => `
      <ion-item button detail="true" href="#/help/${s.id}" lines="${i === HELP.length - 1 ? "none" : "full"}">
        <ion-icon slot="start" name="${s.icon}"></ion-icon><ion-label>${s.title}</ion-label>
      </ion-item>`).join("")}</ion-list>`}</div>`;
}

function renderPlaylists() {
  setChrome({
    title: "Playlists",
    tab: "playlists",
    actions: `<ion-button id="import-pl" aria-label="Import .m3u8 or .zip"><ion-icon slot="icon-only" name="document-attach-outline"></ion-icon></ion-button>
              <ion-button id="new-pl" aria-label="New playlist"><ion-icon slot="icon-only" name="add"></ion-icon></ion-button>`,
  });
  dom.infinite.disabled = true;
  const favorites = store.favorites();
  const playlists = favorites ? [favorites, ...store.playlists.filter((p) => p !== favorites)] : store.playlists;
  dom.view.innerHTML = playlists.length
    ? `<ion-list>${playlists.map((p) => `
        <ion-item button detail="true" href="#/playlist/${p.id}" lines="full">
          ${p.favorites
            ? `<div slot="start" class="thumb favorites-thumb"><ion-icon name="star"></ion-icon></div>`
            : artBox("thumb", playlistArt(p), 'slot="start"')}
          <ion-label><h2>${esc(p.name)}</h2><p>${p.items.length} tune${p.items.length === 1 ? "" : "s"}</p></ion-label>
        </ion-item>`).join("")}</ion-list>`
    : `<div class="empty"><ion-icon name="list" class="empty-icon"></ion-icon>
        <p>No playlists yet. Star a tune to start your Favorites, add tunes with <strong>⋯</strong>, or import an <code>.m3u8</code> or <code>.zip</code>.</p>
        <ion-button id="new-pl-empty">New playlist</ion-button></div>`;
  paintAvatars(dom.view);
  const create = async () => {
    const name = await prompt("New playlist", { placeholder: "Name", confirm: "Create", validate: playlistNameError });
    if (name !== null) go(`#/playlist/${store.create(name).id}`);
  };
  $("new-pl").addEventListener("click", create);
  $("new-pl-empty")?.addEventListener("click", create);
  $("import-pl").addEventListener("click", () => actionSheet("Import", [
    { text: "Import Playlist File…", icon: "document-attach-outline", handler: () => dom.importInput.click() },
    { text: "Open Playlist Link…", icon: "link", handler: () => openPlaylistLink() },
    { text: "Import User Data…", icon: "download-outline", handler: () => $("user-data-input").click() },
    { text: "Export User Data…", icon: "archive-outline", handler: () => exportUserData() },
  ]));
}

function renderPlaylist(id) {
  const pl = store.get(id);
  if (!pl) return go("#/playlists");
  setChrome({
    title: pl.name,
    back: "#/playlists",
    tab: "playlists",
    actions: `<ion-button id="pl-share" aria-label="Share"><ion-icon slot="icon-only" name="share-outline"></ion-icon></ion-button>
              <ion-button id="pl-more" aria-label="More"><ion-icon slot="icon-only" name="ellipsis-vertical"></ion-icon></ion-button>`,
  });
  const items = resolveItems(pl.items);
  dom.view.innerHTML = `
    <div class="playlist-head">
      <ion-button id="pl-play" ${items.length ? "" : "disabled"}><ion-icon slot="start" name="play"></ion-icon>Play</ion-button>
      <ion-button id="pl-shuffle" fill="outline" ${items.length ? "" : "disabled"}><ion-icon slot="start" name="shuffle"></ion-icon>Shuffle</ion-button>
    </div>
    ${pl.share ? `<ion-item button detail="false" lines="none" class="visibility-row" id="pl-visibility">
        <ion-icon slot="start" name="link" color="primary"></ion-icon>
        <ion-label><h3>Anyone with the link</h3><p>Viewers see your latest changes</p></ion-label>
      </ion-item>` : ""}
    ${items.length ? "" : `<div class="empty"><p>Empty. Add tunes with <strong>⋯</strong> on any song.</p></div>`}
    <ion-list id="tune-list"></ion-list>`;
  dom.infinite.disabled = true;
  const renderRows = () => {
    listItems = items;
    listOptions = { playlistId: id };
    const isCurrent = currentMatcher(items);
    const favorites = favoriteKeys();
    const list = $("tune-list");
    list.innerHTML = `<ion-reorder-group id="pl-reorder">${items.map((item, i) => tuneRow(item, i, {
      missing: item.missing,
      reorder: true,
      current: isCurrent(item),
      otherSubtune: isOtherSubtune(item),
      favorite: favorites.has(itemKey(item)),
      tags: item.missing ? [] : rowTags(item),
    })).join("")}</ion-reorder-group>`;
    const group = $("pl-reorder");
    group.disabled = false;
    group.addEventListener("ionItemReorder", (e) => {
      store.move(id, e.detail.from, e.detail.to);
      items.splice(e.detail.to, 0, items.splice(e.detail.from, 1)[0]);
      e.detail.complete(false);
      renderRows();
    });
  };
  renderRows();
  const playable = () => items.filter((i) => !i.missing);
  $("pl-play").addEventListener("click", () => {
    store.markPlayed(id);
    player.setQueue(playable(), 0);
  });
  $("pl-shuffle").addEventListener("click", () => {
    store.markPlayed(id);
    player.setQueue(shuffle(playable()), 0);
  });
  $("pl-share").addEventListener("click", () => sharePlaylist(pl));
  $("pl-visibility")?.addEventListener("click", () => visibilityMenu(pl));
  $("pl-more").addEventListener("click", () => actionSheet(pl.name, [
    { text: "Save playlist file…", icon: "download-outline", handler: () => exportPlaylist(pl) },
    { text: "Share…", icon: "share-outline", handler: () => sharePlaylist(pl) },
    ...(pl.share ? [{ text: "Stop Sharing Link", icon: "link-outline", handler: () => stopSharing(pl) }] : []),
    ...(pl.id === store.favorites()?.id ? [] : [{
      text: "Allow duplicates", toggle: { checked: !!pl.allowDuplicates, onChange: (on) => store.setAllowDuplicates(id, on) },
    }]),
    { text: "Rename", icon: "create-outline", handler: async () => {
      const name = await prompt("Rename playlist", { value: pl.name, validate: name => playlistNameError(name, id) });
      if (name !== null) { store.rename(id, name); render(); }
    } },
    { text: "Delete playlist", role: "destructive", icon: "trash-outline", handler: async () => {
      if (await confirmDialog("Delete playlist?", `“${esc(pl.name)}” will be removed from this browser.`)) { store.remove(id); go("#/playlists"); }
    } },
  ]));
}

// Snapshot link: the whole playlist is in the URL.
async function renderShare(blob) {
  setChrome({ title: "Shared playlist", back: "#/playlists", tab: "playlists" });
  dom.infinite.disabled = true;
  let shared;
  try {
    shared = await decodeShare(blob);
  } catch {
    dom.view.innerHTML = `<div class="empty"><p>This share link is broken or incomplete.</p></div>`;
    return;
  }
  showShared({ name: sanitizeName(shared.name), items: sanitizeItems(shared.items, (p) => !!index.get(p), Infinity) }, "shared with you");
}

// Live link: the playlist is read from lists/<id> and follows the owner's edits.
async function renderLive(id) {
  setChrome({ title: "Shared playlist", back: "#/playlists", tab: "playlists" });
  dom.infinite.disabled = true;
  dom.view.innerHTML = `<div class="empty"><ion-spinner></ion-spinner></div>`;
  let shared;
  try {
    shared = await liveShare.fetch(id, (p) => !!index.get(p));
  } catch (err) {
    dom.view.innerHTML = `<div class="empty"><p>Couldn't load this playlist: ${esc(err.message)}</p></div>`;
    return;
  }
  if (currentRoute().name !== "p" || currentRoute().arg !== id) return;   // navigated away meanwhile
  if (!shared || shared.deleted) {
    dom.view.innerHTML = `<div class="empty"><p>${shared?.deleted ? "This playlist is no longer shared." : "This link doesn't lead to a playlist."}</p></div>`;
    return;
  }
  showShared(shared, "shared with you · updates live");
}

// Lists generated from this device's playback; saving makes a regular playlist.
// ---- tune links --------------------------------------------------------------

// #/tune/<subtune>/<HVSC path>: the subtune first, so the path can be anything.
const tuneLink = (item) => `${location.origin}${location.pathname}#/tune/${item.song}/${encodePath(item.path)}`;

// The system share sheet (Copy is one of its choices), or copying where there is none.
function shareTune(item) {
  const title = item.songs > 1 ? `${item.title} (subtune ${item.song})` : item.title;
  const by = item.author !== "<?>" ? ` by ${item.author}` : "";
  return shareUrl(title, tuneLink(item), `${title}${by} – C64 music on ShallowSID`);
}

// Where a tune link lands. Browsers start audio only on a tap, so it waits for Play.
function renderTune(arg) {
  const [songText, ...parts] = arg.split("/");
  const tune = index.get(parts.join("/"));
  setChrome({ title: "", back: "history", tab: "home" });
  if (!tune) {
    dom.view.innerHTML = `<div class="empty"><p>This tune isn't in HVSC #${esc(index.version)}.</p></div>`;
    return;
  }
  const item = asItem(tune, Math.min(Math.max(Math.trunc(Number(songText)) || tune.start, 1), tune.songs));
  const author = item.author !== "<?>" ? `<a href="${composerHref(composerName(item.author))}">${esc(item.author)}</a>` : esc(item.author);
  dom.view.innerHTML = `
    <section class="composer-head">
      ${thumb(item, "thumb tune-cover")}
      <h1 class="composer-name">${esc(item.title)}</h1>
      <p class="composer-meta">${[author, esc(item.released)].filter(Boolean).join(" · ")}</p>
      ${item.songs > 1 ? `<p class="composer-meta">Subtune ${item.song} of ${item.songs}</p>` : ""}
      <div class="playlist-head composer-actions">
        <ion-button id="tune-play"><ion-icon slot="start" name="play"></ion-icon>Play</ion-button>
        <ion-button id="tune-folder" fill="clear"><ion-icon slot="start" name="folder-outline"></ion-icon>Folder</ion-button>
        <ion-button id="tune-share" fill="clear"><ion-icon slot="start" name="share-outline"></ion-icon>Share</ion-button>
      </div>
    </section>`;
  $("tune-play").addEventListener("click", () => player.setQueue([item], 0));
  $("tune-folder").addEventListener("click", () => go(`#/browse/${encodeURIComponent(item.dir)}`));
  $("tune-share").addEventListener("click", () => shareTune(item));
}

// ---- composer page ---------------------------------------------------------

const TOP_TUNES = 5;
// A composer is the name HVSC credits them by, or its alias (COMPOSER_ALIASES).
const composerHref = (name) => `#/composer/${encodeURIComponent(name)}`;
// Joint credits read "A & B" or "A, B & C".
const creditParts = (credit) => credit.split(/\s*[&,]\s*/);
const tuneYear = (tune) => Number(tune.released?.match(/\b(19|20)\d\d\b/)?.[0]);

// Their own tunes, and those credited jointly with others, in HVSC's order.
function composerTunes(name) {
  const own = [], shared = [];
  for (const t of index.tunes) {
    if (composerName(t.author) === name) own.push(t);
    else if (/[&,]/.test(t.author) && creditParts(t.author).some((part) => composerName(part) === name)) shared.push(t);
  }
  return { own, shared };
}

// Like an artist page: who, how much and when, what you play most, then everything.
function renderComposer(name) {
  const [label] = composerChip(name);
  const realName = name.replace(/\s*\([^)]*\)\s*$/, "");
  const sorted = (list) => sortResults(list.map((t) => asItem(t)), listSort());
  const { own: ownTunes, shared: sharedTunes } = composerTunes(name);
  const own = sorted(ownTunes), shared = sorted(sharedTunes);
  const tunes = [...own, ...shared];
  const paths = new Set(tunes.map((t) => t.path));
  const top = resolveItems(store.mostPlayed().filter((p) => paths.has(p.path)).slice(0, TOP_TUNES)).filter((i) => !i.missing);
  const years = tunes.map(tuneYear).filter(Number.isFinite);
  const span = years.length ? [...new Set([Math.min(...years), Math.max(...years)])].join("–") : "";
  const dirs = new Set(ownTunes.map((t) => t.dir));
  const folder = dirs.size === 1 ? [...dirs][0] : null;
  const meta = [realName !== label && realName, `${tunes.length.toLocaleString()} tune${tunes.length === 1 ? "" : "s"}`, span].filter(Boolean);
  setChrome({ title: "", back: "history", tab: "home" });
  dom.view.innerHTML = `
    <section class="composer-head">
      <div class="composer-avatar" data-composer="${esc(name)}" data-animate><ion-icon name="person"></ion-icon></div>
      <h1 class="composer-name">${esc(label)}</h1>
      <p class="composer-meta">${meta.map(esc).join(" · ")}</p>
      <div class="playlist-head composer-actions">
        <ion-button id="top-play" ${tunes.length ? "" : "disabled"}><ion-icon slot="start" name="play"></ion-icon>Play</ion-button>
        <ion-button id="top-shuffle" fill="outline" ${tunes.length ? "" : "disabled"}><ion-icon slot="start" name="shuffle"></ion-icon>Shuffle</ion-button>
        ${folder ? `<ion-button id="composer-folder" fill="clear"><ion-icon slot="start" name="folder-outline"></ion-icon>Folder</ion-button>` : ""}
        <ion-button id="composer-search" fill="clear"><ion-icon slot="start" name="search"></ion-icon>Search</ion-button>
      </div>
    </section>
    ${tunes.length ? (tunes.length > 1 ? sortBar("list") : "") : `<div class="empty"><p>No tunes are credited to ${esc(name)}.</p></div>`}
    <div id="composer-tunes"></div>`;
  paintAvatars(dom.view);
  const parts = [["Your top tunes", top], ["Tunes", own], ["With others", shared]].filter(([, items]) => items.length);
  let start = 0;
  const sections = parts.map(([title, items]) => ({ title, start: (start += items.length) - items.length, count: items.length }));
  showList($("composer-tunes"), parts.flatMap(([, items]) => items), { all: true, sections });
  $("top-play").addEventListener("click", () => player.setQueue(tunes, 0));
  $("top-shuffle").addEventListener("click", () => player.setQueue(shuffle(tunes), 0));
  $("composer-folder")?.addEventListener("click", () => go(`#/browse/${encodeURIComponent(folder)}`));
  $("composer-search").addEventListener("click", () => searchFor(name));
}

// ---- tags ------------------------------------------------------------------

const tagHref = (id) => `#/tag/${encodeURIComponent(id)}`;
const HOME_TAGS = 12;

// Tunes with a tag: those tagged as a whole (playing from their start song),
// then subtunes tagged on their own.
// The tunes and subtunes carrying any of the tag ids.
function tagItems(wanted) {
  const tunes = [], subtunes = [];
  for (const { path, song, tags: ids } of tags.entries()) {
    const tune = ids.some((id) => wanted.includes(id)) && index.get(path);
    if (!tune) continue;
    if (song === WHOLE_TUNE) tunes.push(asItem(tune));
    else if (song <= tune.songs) subtunes.push(asItem(tune, song));
  }
  return { tunes: sortResults(tunes, listSort()), subtunes: sortResults(subtunes, listSort()) };
}

// A tag's tunes, with Tunes and Subtunes headings when there are both.
function showTagItems(container, { tunes, subtunes }) {
  const parts = [["Tunes", tunes], ["Subtunes", subtunes]].filter(([, items]) => items.length);
  let start = 0;
  const sections = parts.length > 1 ? parts.map(([title, items]) => ({ title, start: (start += items.length) - items.length, count: items.length })) : undefined;
  showList(container, [...tunes, ...subtunes], { all: true, sections });
}

const tagChip = (id, count) => `<ion-chip data-open-tag="${esc(id)}" class="tag-chip">${esc(tags.label(id))}${count != null ? `<span class="tag-count">${count}</span>` : ""}</ion-chip>`;

// Home: the most used tags, and a way to all of them.
function tagChips() {
  const top = [...tags.counts()].sort((a, b) => b[1] - a[1]).slice(0, HOME_TAGS);
  if (!top.length) return "";
  return `<h2 class="section-title">Tags</h2>
    <div class="chips">${top.map(([id, count]) => tagChip(id, count)).join("")}<ion-chip data-all-tags outline>All tags</ion-chip></div>`;
}

// "#fu" in the search bar: tags whose name matches, those in use first, and
// below them the tunes carrying any of those tags.
function renderTagSearch(text) {
  const q = text.trim().toLowerCase();
  const counts = tags.counts();
  const found = [...tags.vocab.byId.values()]
    .filter((t) => !q || t.label.toLowerCase().includes(q) || t.id.includes(q))
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.label.localeCompare(b.label));
  dom.infinite.disabled = true;
  if (!found.length) {
    dom.view.innerHTML = `<div class="empty"><p>No tag matches “${esc(text)}”.</p></div>`;
    return;
  }
  const items = q ? tagItems(found.map((t) => t.id)) : { tunes: [], subtunes: [] };
  const total = items.tunes.length + items.subtunes.length;
  dom.view.innerHTML = `<p class="result-count">Tags</p><div class="chips">${found.map((t) => tagChip(t.id, counts.get(t.id) ?? 0)).join("")}</div>`
    + (total ? `<p class="result-count">${tuneCount(total)}</p><div id="tag-tunes"></div>` : "");
  if (total) showTagItems($("tag-tunes"), items);
}

function renderAllTags() {
  setChrome({ title: "Tags", back: "history", tab: "home" });
  dom.infinite.disabled = true;
  const counts = tags.counts();
  dom.view.innerHTML = tags.vocab.groups.map((g) => `
    <h2 class="section-title">${esc(g.name)}</h2>
    <div class="chips">${g.tags.map((t) => tagChip(t.id, counts.get(t.id) ?? 0)).join("")}</div>`).join("");
}

function renderTag(id) {
  const tag = tags.vocab.byId.get(id);
  setChrome({ title: "", back: "history", tab: "home" });
  if (!tag) {
    dom.infinite.disabled = true;
    dom.view.innerHTML = `<div class="empty"><p>There's no tag “${esc(id)}”.</p></div>`;
    return;
  }
  const items = tagItems([id]);
  const all = [...items.tunes, ...items.subtunes];
  const meta = [tag.group, tuneCount(all.length)].filter(Boolean);
  dom.view.innerHTML = `
    <section class="composer-head">
      <div class="tag-avatar"><ion-icon name="pricetag"></ion-icon></div>
      <h1 class="composer-name">${esc(tag.label)}</h1>
      <p class="composer-meta">${meta.map(esc).join(" · ")}</p>
      ${tag.description ? `<p class="composer-meta">${esc(tag.description)}</p>` : ""}
      <div class="playlist-head composer-actions">
        <ion-button id="top-play" ${all.length ? "" : "disabled"}><ion-icon slot="start" name="play"></ion-icon>Play</ion-button>
        <ion-button id="top-shuffle" fill="outline" ${all.length ? "" : "disabled"}><ion-icon slot="start" name="shuffle"></ion-icon>Shuffle</ion-button>
      </div>
    </section>
    ${all.length ? (all.length > 1 ? sortBar("list") : "") : `<div class="empty"><p>No tunes have this tag yet.</p></div>`}
    <div id="tag-tunes"></div>`;
  showTagItems($("tag-tunes"), items);
  $("top-play").addEventListener("click", () => player.setQueue(all, 0));
  $("top-shuffle").addEventListener("click", () => player.setQueue(shuffle(all), 0));
}

// ---- curation: invites, curators, their edits --------------------------------------

let pendingInvite = null;       // an invite link's secret, kept out of the address bar
let curationSeq = 0;

// An invite link opens #/curate/<secret>: move it out of the address (and
// history) at once, then show it on the Curation page.
function openInviteLink(secret) {
  pendingInvite = isInviteSecret(secret) ? secret : "invalid";
  history.replaceState(null, "", "#/curation");
  renderCuration("");
}

const ROLE_NAMES = { curator: "Curator", admin: "Admin" };

// The Curation tab ("Admin" for admins): an invite to accept, your role and
// edits and, for admins, invites and curators to turn off and on.
async function renderCuration(arg) {
  const title = arg ? "Edits" : tags.isAdmin ? "Admin" : "Curation";
  setChrome({ title, back: arg ? "history" : null, tab: tags.cid ? "curation" : "home" });
  dom.infinite.disabled = true;
  const seq = ++curationSeq;
  const stale = () => seq !== curationSeq || currentRoute().name !== "curation";
  if (!tags.configured) {
    dom.view.innerHTML = `<div class="empty"><p>Tagging isn't set up on this site.</p></div>`;
    return;
  }
  if (arg === "hot-tunes") return renderHotTunesAdmin(stale);
  if (arg) return renderEdits(arg, stale);
  dom.view.innerHTML = `<div class="empty"><ion-spinner></ion-spinner></div>`;
  const sections = [];
  if (pendingInvite) sections.push(await inviteCard(pendingInvite));
  if (stale()) return;
  if (tags.cid) {
    const role = tags.role;
    sections.push(`<section class="composer-head">
      <div class="tag-avatar"><ion-icon name="${role === "admin" ? "shield-checkmark" : role ? "pricetags" : "close"}"></ion-icon></div>
      <h1 class="composer-name">${role ? `You're ${role === "admin" ? "an admin" : "a curator"}` : "Your curator rights are off"}</h1>
      <p class="composer-meta">${role
        ? `Tag tunes with <strong>Tag</strong> in Now Playing, <strong>Edit Tags…</strong> in a tune's <strong>⋯</strong> menu, or the <strong>T</strong> key.`
        : "An admin has turned your curator rights off. They can turn them back on."}</p>
      ${sync.enabled || !role ? "" : `<p class="composer-meta">Turn on Sync in <strong>Settings</strong> to tag from your other devices too.</p>`}
      <div class="playlist-head composer-actions">
        <ion-button id="my-edits" fill="outline" href="#/curation/${esc(tags.cid)}">Your Edits</ion-button>
        <ion-button id="leave-curation" fill="clear" color="medium">Stop Curating Here…</ion-button>
      </div>
    </section>`);
  }
  if (tags.isAdmin) {
    sections.push(`<div class="playlist-head"><ion-button id="manage-tags">Manage Tags</ion-button><ion-button id="manage-lists" fill="outline">Manage Lists</ion-button></div><section id="tag-management" hidden></section><section id="list-management" hidden></section><h2 class="section-title">Curators</h2>
      <div class="playlist-head"><ion-button id="new-invite"><ion-icon slot="start" name="person-add-outline"></ion-icon>Invite a Curator…</ion-button></div>
      <ion-list id="curator-list"><div class="empty"><ion-spinner></ion-spinner></div></ion-list>`);
  }
  if (!sections.length) sections.push(`<div class="empty"><p>Curators tag tunes. You need an invite link from an admin to become one.</p></div>`);
  dom.view.innerHTML = sections.join("");
  $("accept-invite")?.addEventListener("click", acceptInvite);
  $("dismiss-invite")?.addEventListener("click", () => { pendingInvite = null; render(); });
  $("leave-curation")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Stop curating here?", "This device, and your devices syncing with it, can't tag tunes any more. You'd need a new invite to start again.", "Stop Curating"))) return;
    tags.leave();
    render();
  });
  $("manage-tags")?.addEventListener("click", () => manageTags(stale));
  $("manage-lists")?.addEventListener("click", () => manageLists(stale));
  $("new-invite")?.addEventListener("click", newInvite);
  if (tags.isAdmin) fillCurators(stale);
}

// All tags, published and pending, from any admin. Opening the panel reads
// the definitions again, so other admins' changes show.
async function manageTags(stale, refresh = true) {
  const panel = $("tag-management");
  if (!panel) return;
  panel.hidden = false;
  panel.innerHTML = `<div class="empty"><ion-spinner></ion-spinner></div>`;
  try {
    const definitions = await tags.definitions(refresh);
    if (stale()) return;
    const rows = tagCatalog(tags.vocab, definitions);
    const byId = new Map(rows.map(t => [t.id, t]));
    const status = t => t.pending ? (t.published ? "Pending update" : "Pending") : "Published";
    const author = t => t.by ? (t.by === tags.cid ? ", by you" : ", by another admin") : "";
    panel.innerHTML = `<h2 class="section-title">Manage Tags</h2>
      <div class="playlist-head"><ion-button id="refresh-tag-definitions" fill="outline">Refresh</ion-button></div>
      <form id="add-tag-form" class="composer-head tag-definition-form">
        <h3 id="tag-form-title">Add Tag</h3>
        <label>Name <input name="label" required maxlength="80"></label>
        <label>Tag ID <input name="id" readonly></label>
        <label>Category <select name="group">${TAG_GROUPS.map(g => `<option>${g}</option>`).join("")}</select></label>
        <label>Description <textarea name="description" maxlength="500" placeholder="Optional"></textarea></label>
        <button type="submit">Add Tag</button><button type="button" id="cancel-tag-edit" hidden>Cancel</button><p id="add-tag-error" role="alert"></p>
      </form>
      <p class="composer-meta">${rows.length} tags, ${rows.filter(t => t.pending).length} pending (dashed). Tap a tag to edit it.</p>
      <div id="tag-definition-list">${TAG_GROUPS.map(g => [g, rows.filter(t => t.group === g)]).filter(([, list]) => list.length).map(([g, list]) => `
        <h3 class="sound-section">${esc(g)}</h3>
        <div class="chips tag-chips">${list.map(t => `<ion-chip data-edit-tag="${esc(t.id)}" class="tag-toggle${t.pending ? " is-pending" : ""}"
            title="${esc([t.description, `${status(t)}: ${t.id}${author(t)}`].filter(Boolean).join("\n"))}">
          ${t.pending ? `<ion-icon name="time-outline" aria-label="${status(t)}"></ion-icon>` : ""}<ion-label>${esc(t.label)}</ion-label>
        </ion-chip>`).join("")}</div>`).join("")}</div>`;
    const form = $("add-tag-form");
    let editing = null;
    const setMode = (tag) => {
      editing = tag?.id ?? null;
      for (const chip of panel.querySelectorAll("[data-edit-tag]")) chip.classList.toggle("is-on", chip.dataset.editTag === editing);
      $("tag-form-title").textContent = tag ? "Edit Tag" : "Add Tag";
      form.querySelector("button[type=submit]").textContent = tag ? "Save Tag" : "Add Tag";
      $("cancel-tag-edit").hidden = !tag;
      $("add-tag-error").textContent = "";
      form.elements.label.value = tag?.label ?? "";
      form.elements.id.value = tag?.id ?? "";
      form.elements.group.value = tag?.group ?? TAG_GROUPS[0];
      form.elements.description.value = tag?.description ?? "";
    };
    $("refresh-tag-definitions").onclick = () => manageTags(stale, true);
    $("cancel-tag-edit").onclick = () => setMode(null);
    $("tag-definition-list").onclick = event => {
      const tag = byId.get(event.target.closest("[data-edit-tag]")?.dataset.editTag);
      if (!tag) return;
      setMode(tag);
      form.scrollIntoView({ behavior: "smooth", block: "start" });
      form.elements.label.focus();
    };
    form.elements.label.oninput = event => { if (!editing) form.elements.id.value = definitionId(event.target.value); };
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      const { label, group, description } = form.elements;
      button.disabled = true;
      try {
        if (editing) await tags.editDefinition(editing, label.value, group.value, description.value);
        else await tags.addDefinition(label.value, group.value, description.value);
        if (!stale()) await manageTags(stale, false);
      } catch (err) { if (!stale()) $("add-tag-error").textContent = err.message; }
      finally { button.disabled = false; }
    };
  } catch (err) { if (!stale()) panel.innerHTML = `<p role="alert">${esc(err.message)}</p><ion-button id="retry-tag-definitions">Refresh</ion-button>`; $("retry-tag-definitions")?.addEventListener("click", () => manageTags(stale, true)); }
}

// The curated lists (js/curated-lists.json): popular composers, groups with
// a mix and changes to the Hot tunes. An admin searches the HVSC index and
// adds or removes a match. Changes are pending until the nightly sync
// publishes them.
const LIST_HELP = {
  composers: "Composers as HVSC credits them, for the Popular composers chips and the composer mixes.",
  groups: "Music groups and labels as they show in the released credit, for the group mixes.",
  "hot-tunes": "Tunes to add to the Hot tunes mix or to take out of it. Only the changes to the generated list show below.",
};
const LIST_SEARCH = { composers: "Search composers", groups: "Search groups", "hot-tunes": "Search tune titles or paths" };
const SUGGESTIONS = 8;

// Tunes per composer credit and per group name, counted once.
let listCounts = null;
function listCountsFor(list) {
  if (!listCounts) {
    const authors = new Map(), groups = new Map();
    for (const t of index.tunes) {
      authors.set(t.author, (authors.get(t.author) ?? 0) + 1);
      // The released credit is the year, then groups joined by "/".
      for (const name of new Set((t.released ?? "").replace(/^\S+\s*/, "").split("/").map((g) => g.trim()).filter(Boolean))) {
        groups.set(name, (groups.get(name) ?? 0) + 1);
      }
    }
    listCounts = { composers: authors, groups };
  }
  return listCounts[list];
}

// What matches `text`, best first: a match at the start of a word before one
// inside a word, then the most tunes (or the title). Rows: {key, label, note}.
function listSuggestions(list, text) {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return [];
  const rank = (s) => { const i = s.toLowerCase().indexOf(q); return i < 0 ? -1 : i === 0 || /\W/.test(s[i - 1]) ? 0 : 1; };
  if (list === "hot-tunes") {
    const found = [];
    for (const t of index.tunes) {
      const r = rank(t.title);
      const r2 = q.includes("/") && t.path.toLowerCase().includes(q) ? 0 : -1;
      if (r >= 0 || r2 >= 0) found.push({ t, rank: r2 >= 0 ? r2 : r });
    }
    return found.sort((a, b) => a.rank - b.rank || a.t.title.localeCompare(b.t.title)).slice(0, SUGGESTIONS)
      .map(({ t }) => ({ key: t.path, label: t.title, note: `${composerName(t.author)}, ${t.path}` }));
  }
  return [...listCountsFor(list)].map(([name, count]) => ({ name, count, rank: rank(name) })).filter((c) => c.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.count - a.count || a.name.localeCompare(b.name)).slice(0, SUGGESTIONS)
    .map((c) => ({ key: c.name, label: c.name, note: tuneCount(c.count) }));
}
const listLabel = (list, key) => {
  if (list !== "hot-tunes") return key;
  const tune = index.get(key);
  return tune ? `${tune.title} (${composerName(tune.author)})` : key;
};

async function manageLists(stale, list = "composers", refresh = true) {
  const panel = $("list-management");
  if (!panel) return;
  panel.hidden = false;
  panel.innerHTML = `<div class="empty"><ion-spinner></ion-spinner></div>`;
  let items;
  try {
    items = await tags.listItems(list, refresh);
  } catch (err) {
    if (stale()) return;
    panel.innerHTML = `<p role="alert">${esc(err.message)}</p><ion-button id="retry-list-items">Refresh</ion-button>`;
    $("retry-list-items").addEventListener("click", () => manageLists(stale, list, true));
    return;
  }
  if (stale()) return;
  panel.innerHTML = `<h2 class="section-title">Manage Lists</h2>
    <ion-segment id="list-choice" value="${list}">${LISTS.map((l) => `<ion-segment-button value="${l}"><ion-label>${LIST_NAMES[l]}</ion-label></ion-segment-button>`).join("")}</ion-segment>
    <div class="playlist-head"><ion-button id="refresh-list-items" fill="outline">Refresh</ion-button></div>
    <section class="composer-head tag-definition-form">
      <p class="composer-meta">${esc(LIST_HELP[list])}</p>
      <input id="list-search" type="search" placeholder="${LIST_SEARCH[list]}" maxlength="200" autocomplete="off" spellcheck="false" aria-label="${LIST_SEARCH[list]}">
      <ion-list id="list-suggestions" class="list-suggestions" lines="full" hidden></ion-list>
      <p id="list-error" role="alert"></p>
    </section>
    ${list === "hot-tunes" ? `<ion-list inset lines="none"><ion-item button href="#/curation/hot-tunes" detail="true">
      <ion-icon slot="start" name="flame-outline" color="primary"></ion-icon>
      <ion-label>Hot tunes<p>${curated.hot.size.toLocaleString()} tunes, with the pending changes</p></ion-label>
    </ion-item></ion-list>` : ""}
    <p class="composer-meta" id="list-summary"></p>
    <div id="list-item-chips" class="chips tag-chips"></div>`;

  let rows, byKey;
  // Whether `key` is in the list, with the pending changes.
  const inList = (key) => { const r = byKey.get(key); return r ? !r.hidden : list === "hot-tunes" && HOT_TUNES.has(key); };
  const status = (r) => (r.pending ? (r.hidden ? "Pending removal" : "Pending") : r.hidden ? "Removed" : "Published");
  const search = $("list-search");
  const suggestions = $("list-suggestions");
  const paint = () => {
    rows = listCatalog(list, curated.lists, items, HOT_TUNES);
    byKey = new Map(rows.map((r) => [r.key, r]));
    $("list-summary").textContent = `${rows.filter((r) => !r.hidden).length} shown, ${rows.filter((r) => r.pending).length} pending (dashed). Tap an item to take it out or to put it back.`;
    $("list-item-chips").innerHTML = rows.map((r) => `<ion-chip data-list-key="${esc(r.key)}" class="tag-toggle${r.pending ? " is-pending" : ""}${r.hidden ? " is-hidden" : ""}"
        title="${esc(`${status(r)}: ${r.key}${r.by ? (r.by === tags.cid ? ", by you" : ", by another admin") : ""}`)}">
      ${r.pending ? `<ion-icon name="time-outline" aria-label="${status(r)}"></ion-icon>` : ""}<ion-label>${esc(listLabel(list, r.key))}</ion-label>
    </ion-chip>`).join("");
    const found = listSuggestions(list, search.value);
    suggestions.hidden = !found.length;
    suggestions.innerHTML = found.map((s) => {
      const on = inList(s.key);
      const pending = byKey.get(s.key)?.pending;
      return `<ion-item>
        <ion-label>${pending ? `<ion-icon name="time-outline" aria-label="Pending"></ion-icon> ` : ""}${esc(s.label)}<p>${esc(s.note)}</p></ion-label>
        <ion-button slot="end" fill="clear" color="${on ? "danger" : "success"}" data-toggle="${esc(s.key)}" aria-label="${on ? "Remove" : "Add"} ${esc(s.label)}">
          <ion-icon slot="icon-only" name="${on ? "remove-circle" : "add-circle"}"></ion-icon>
        </ion-button>
      </ion-item>`;
    }).join("");
  };
  const toggle = async (key, button) => {
    if (button) button.disabled = true;
    $("list-error").textContent = "";
    try {
      await tags.setListItem(list, key, inList(key));
    } catch (err) {
      if (!stale()) $("list-error").textContent = err.message;
    }
    if (!stale()) paint();
  };
  paint();
  search.oninput = paint;
  search.onkeydown = (event) => { if (event.key === "Escape") { search.value = ""; paint(); } };
  suggestions.onclick = (event) => {
    const button = event.target.closest("[data-toggle]");
    if (button) toggle(button.dataset.toggle, button);
  };
  $("list-choice").addEventListener("ionChange", (event) => manageLists(stale, event.detail.value, false));
  $("refresh-list-items").onclick = () => manageLists(stale, list, true);
  $("list-item-chips").onclick = async (event) => {
    const row = byKey.get(event.target.closest("[data-list-key]")?.dataset.listKey);
    if (!row) return;
    const label = listLabel(list, row.key);
    const ok = row.hidden
      ? await confirmDialog("Put it back?", `${label} goes back into ${LIST_NAMES[list]} after the next sync.`, "Put Back")
      : await confirmDialog("Take it out?", `${label} leaves ${LIST_NAMES[list]} after the next sync.`, "Take Out");
    if (ok && !stale()) toggle(row.key);
  };
}

// Whether `path` is in the Hot tunes, with the pending changes this admin
// has read (the published set until the list is loaded).
function hotTuneOn(path) {
  const item = tags.listCache?.get("hot-tunes")?.find((i) => i.key === path);
  return item ? !item.hidden : curated.hot.has(path);
}

async function toggleHotTune(item) {
  const on = hotTuneOn(item.path);
  try {
    await tags.setListItem("hot-tunes", item.path, on);
    if (currentRoute().name === "curation" && currentRoute().arg === "hot-tunes") render();
  } catch (err) { toast(err.message, { color: "danger" }); }
}

// The Hot tunes as a playlist, for admins: pending additions and removals
// first, then the list. A tune's ⋯ menu adds or removes it.
async function renderHotTunesAdmin(stale) {
  setChrome({ title: "Hot tunes", back: "#/curation", tab: "curation" });
  if (!tags.isAdmin) return go("#/curation");
  dom.view.innerHTML = `<div class="empty"><ion-spinner></ion-spinner></div>`;
  let changes;
  try {
    changes = await tags.listItems("hot-tunes");
  } catch (err) {
    if (!stale()) dom.view.innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
    return;
  }
  if (stale()) return;
  const rows = listCatalog("hot-tunes", curated.lists, changes, HOT_TUNES).filter((r) => r.pending);
  const adding = rows.filter((r) => !r.hidden).map((r) => r.key);
  const removing = new Set(rows.filter((r) => r.hidden).map((r) => r.key));
  const listed = [...curated.hot].filter((path) => !removing.has(path));
  const toItems = (paths) => paths.map((path) => index.get(path)).filter(Boolean).map((t) => asItem(t));
  const groups = [["Pending additions", toItems(adding)], ["Pending removals", toItems([...removing])], ["Hot tunes", toItems(listed)]];
  const sections = [];
  const items = [];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    if (groups.some(([, l], i) => i < 2 && l.length)) sections.push({ start: items.length, title });
    items.push(...list);
  }
  const playable = [...toItems(adding), ...toItems(listed)];
  dom.view.innerHTML = `
    <div class="playlist-head">
      <ion-button id="hot-play" ${playable.length ? "" : "disabled"}><ion-icon slot="start" name="play"></ion-icon>Play</ion-button>
      <ion-button id="hot-shuffle" fill="outline" ${playable.length ? "" : "disabled"}><ion-icon slot="start" name="shuffle"></ion-icon>Shuffle</ion-button>
    </div>
    <p class="result-count">${tuneCount(playable.length)}${rows.length ? `, ${rows.length} pending until the next sync` : ""}. Add or remove a tune with <strong>⋯</strong>.</p>
    <div id="hot-list"></div>`;
  showList($("hot-list"), items, { sections });
  $("hot-play").addEventListener("click", () => player.setQueue(playable, 0));
  $("hot-shuffle").addEventListener("click", () => player.setQueue(shuffle(playable), 0));
}

async function inviteCard(secret) {
  const card = (title, text, buttons = "") => `<section class="composer-head invite-card">
    <div class="tag-avatar"><ion-icon name="mail-open-outline"></ion-icon></div>
    <h1 class="composer-name">${title}</h1><p class="composer-meta">${text}</p>
    <div class="playlist-head composer-actions">${buttons}<ion-button id="dismiss-invite" fill="clear" color="medium">${buttons ? "Not Now" : "OK"}</ion-button></div>
  </section>`;
  if (secret === "invalid") return card("Broken invite", "This invite link is incomplete. Ask for a new one.");
  let status;
  try {
    status = await tags.checkInvite(secret);
  } catch (err) {
    return card("Couldn't check the invite", esc(err.message));
  }
  if (status.status === "missing") return card("Unknown invite", "This invite doesn't exist. Ask for a new one.");
  if (status.status === "used") return card("Invite already used", "Each invite works once. Ask for a new one if it wasn't you.");
  if (status.status === "expired") return card("Invite expired", "Invites last two weeks. Ask for a new one.");
  if (status.status === "cancelled") return card("Invite cancelled", "An admin expired this invite. Ask for a new one if you need it.");
  if (tags.role === "admin" || (tags.role && status.role === "curator")) return card("You're already " + (tags.role === "admin" ? "an admin" : "a curator"), "Keep this invite for someone else.");
  return card(`You're invited to tag tunes`, status.role === "admin"
    ? `As an admin you can tag tunes, invite curators and turn them off.${syncNote()}`
    : `As a curator you pick tags for tunes and subtunes from a fixed list. Everyone sees them.${syncNote()}`,
    `<ion-button id="accept-invite">Become ${status.role === "admin" ? "an Admin" : "a Curator"}</ion-button>`);
}

// Curating turns Sync on (or back on): the curator identity lives in this
// browser and in the synced data, so this keeps it safe and lets the user's
// other devices curate too.
const syncNote = () => (sync.configured && !sync.enabled ? " Accepting also turns on Sync, which keeps your rights on all your devices." : "");

async function acceptInvite() {
  try {
    await tags.claim(pendingInvite);
    pendingInvite = null;
  } catch (err) {
    toast(`Couldn't join: ${err.message}`, { color: "danger" });
    return render();
  }
  if (!sync.configured || sync.enabled) {
    return render();
  }
  await (sync.hasKey ? sync.resume() : sync.turnOn());
  if (sync.status === "error") {
    toast(`Sync couldn't start: ${sync.error} Turn it on from Settings → Playlist cloud sync.`, { color: "warning", duration: 8000 });
  }
  render();
}

async function newInvite() {
  const note = await prompt("Invite a Curator", { placeholder: "Who it's for (only you see this)", confirm: "Create Link" });
  if (note === null) return;
  try {
    const link = await tags.createInvite(note);
    await shareUrl("ShallowSID curator invite", link, "Tag C64 tunes on ShallowSID: this link works once, for two weeks");
  } catch (err) {
    toast(`Couldn't create an invite: ${err.message}`, { color: "danger" });
  }
  render();
}

// An invite nobody has used yet, still in time: it can be expired now.
const waiting = (row) => !row.curator && !row.used && !row.missing && !row.cancelled && row.exp > Date.now();

function inviteStatus(row) {
  if (row.curator) return row.curator.active ? ROLE_NAMES[row.curator.role] ?? "Curator" : "Off";
  if (row.missing) return "Not found";
  if (row.cancelled) return "Expired by an admin, unused";
  if (!row.exp || row.exp <= Date.now()) return "Expired, unused";
  return `Waiting · expires ${new Date(row.exp).toLocaleDateString()}`;
}

async function fillCurators(stale) {
  let rows;
  try {
    rows = await tags.invites();
  } catch (err) {
    if (!stale()) $("curator-list").innerHTML = `<div class="empty"><p>Couldn't load: ${esc(err.message)}</p></div>`;
    return;
  }
  if (stale()) return;
  const list = $("curator-list");
  // Curators get an on/off switch; admins are managed with tools/curators.py.
  const toggle = (c) => (c.role === "curator"
    ? `<ion-toggle slot="end" data-curator-active="${esc(c.cid)}" ${c.active ? "checked" : ""} aria-label="Can tag"></ion-toggle>` : "");
  list.innerHTML = rows.length ? rows.map((row) => `
    <ion-item lines="full" class="curator-row">
      <ion-icon slot="start" name="${row.curator?.active ? "person-outline" : row.curator ? "person-remove-outline" : "hourglass-outline"}" color="${row.curator?.active ? "primary" : "medium"}"></ion-icon>
      <ion-label><h3>${esc(row.note || "No name")}</h3><p>${esc(inviteStatus(row))} · invited ${esc(new Date(row.created).toLocaleDateString())}</p></ion-label>
      ${row.curator ? `<ion-button slot="end" fill="clear" size="small" href="#/curation/${esc(row.curator.cid)}">Edits</ion-button>${toggle(row.curator)}` : ""}
      ${waiting(row) ? `<ion-button slot="end" fill="clear" size="small" color="danger" data-expire-invite="${esc(row.hash)}" data-note="${esc(row.note)}">Expire</ion-button>` : ""}
    </ion-item>`).join("")
    : `<div class="empty"><p>No invites yet. Invites you make show here.</p></div>`;
  list.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-expire-invite]");
    if (!button) return;
    const note = button.dataset.note || "this person";
    if (!(await confirmDialog("Expire invite?", `The link for ${note} stops working now. You can send a new one later.`, "Expire"))) return;
    try {
      await tags.expireInvite(button.dataset.expireInvite);
    } catch (err) {
      toast(`Couldn't expire the invite: ${err.message}`, { color: "danger" });
    }
    render();
  });
  list.addEventListener("ionChange", async (e) => {
    const cid = e.target.dataset?.curatorActive;
    if (!cid) return;
    const on = e.detail.checked;
    const note = rows.find((r) => r.curator?.cid === cid)?.note || "Curator";
    e.target.disabled = true;
    try {
      await tags.setActive(cid, on);
    } catch (err) {
      toast(`Couldn't change ${note}: ${err.message}`, { color: "danger" });
    }
    render();
  });
}

// A curator's latest edits: to themself, and to admins.
async function renderEdits(cid, stale) {
  if (!isCuratorId(cid) || (cid !== tags.cid && !tags.isAdmin)) {
    dom.view.innerHTML = `<div class="empty"><p>Only admins can see others' edits.</p></div>`;
    return;
  }
  dom.view.innerHTML = `<div class="empty"><ion-spinner></ion-spinner></div>`;
  let edits;
  try {
    edits = await tags.editsBy(cid);
  } catch (err) {
    if (!stale()) dom.view.innerHTML = `<div class="empty"><p>Couldn't load edits: ${esc(err.message)}</p></div>`;
    return;
  }
  if (stale()) return;
  const items = edits.map((e) => ({ edit: e, tune: index.get(e.path) })).filter((x) => x.tune)
    .map(({ edit, tune }) => asItem(tune, edit.song === WHOLE_TUNE ? tune.start : Math.min(edit.song, tune.songs)));
  const who = cid === tags.cid ? "Your" : "Their";
  dom.view.innerHTML = `<p class="result-count">${who} ${items.length === 1 ? "latest edit" : `latest ${items.length} edits, newest first`}</p><div id="edit-list"></div>`;
  if (!items.length) $("edit-list").innerHTML = `<div class="empty"><p>No edits yet.</p></div>`;
  else showList($("edit-list"), items, { all: true });
}

function renderGenerated(title, items, note) {
  setChrome({ title, back: "#/home", tab: "home" });
  dom.view.innerHTML = `
    <div class="playlist-head">
      <ion-button id="top-play" ${items.length ? "" : "disabled"}><ion-icon slot="start" name="play"></ion-icon>Play</ion-button>
      <ion-button id="top-shuffle" fill="outline" ${items.length ? "" : "disabled"}><ion-icon slot="start" name="shuffle"></ion-icon>Shuffle</ion-button>
      <ion-button id="top-save" fill="clear" ${items.length ? "" : "disabled"}>Save as Playlist</ion-button>
    </div>
    <p class="result-count">${esc(note)}</p>
    <div id="top-list"></div>`;
  showList($("top-list"), items);
  $("top-play").addEventListener("click", () => player.setQueue(items, 0));
  $("top-shuffle").addEventListener("click", () => player.setQueue(shuffle(items), 0));
  $("top-save").addEventListener("click", () => {
    const pl = store.create(title, items);
    go(`#/playlist/${pl.id}`);
  });
}

// Both link kinds: name and items are already sanitised; all text is escaped.
function showShared(shared, note) {
  const items = resolveItems(shared.items);
  dom.title.textContent = shared.name;
  dom.view.innerHTML = `
    <div class="playlist-head">
      <ion-button id="share-play" ${items.length ? "" : "disabled"}><ion-icon slot="start" name="play"></ion-icon>Play</ion-button>
      <ion-button id="share-save" fill="outline"><ion-icon slot="start" name="bookmark-outline"></ion-icon>Save to my playlists</ion-button>
    </div>
    <p class="result-count">${items.length === 1 ? "1 tune" : `${items.length} tunes`} ${esc(note)}</p>
    <div id="share-list"></div>`;
  showList($("share-list"), items);
  $("share-play").addEventListener("click", () => player.setQueue(items.filter((i) => !i.missing), 0));
  $("share-save").addEventListener("click", () => {
    const pl = store.create(shared.name, shared.items);
    go(`#/playlist/${pl.id}`);
  });
}

let renderedRoute = null;

function render() {
  if (!index) return;
  const { name, arg } = currentRoute();
  // Updating the current view (subtune, favorites, removal, sync, etc.)
  // keeps its scroll position. Only navigation starts at the top.
  const route = JSON.stringify([name, arg]);
  if (route !== renderedRoute) dom.content.scrollToTop?.();
  renderedRoute = route;
  if (name !== "settings" || arg !== "sound") soundSheet.close();
  dom.view.hidden = false;
  soundSheet.root.hidden = true;
  romSheet.root.hidden = true;
  if (syncSheet) syncSheet.root.hidden = true;
  switch (name) {
    case "browse": return renderBrowse(arg);
    case "playlists": return renderPlaylists();
    case "settings": return renderSettingsPage(arg);
    case "help": return renderHelp(arg);
    case "playlist": return renderPlaylist(arg);
    case "share": return renderShare(arg);
    case "p": return renderLive(arg);
    case "sync": return joinSyncLink(arg);
    case "composer": return renderComposer(arg);
    case "tune": return renderTune(arg);
    case "tag": return renderTag(arg);
    case "tags": return renderAllTags();
    case "curate": return openInviteLink(arg);
    case "curation": return renderCuration(arg);
    case "most-played": return renderGenerated("Your most played", mostPlayedItems(), `Your ${MOST_PLAYED_COUNT} most played tunes ${playedWhere()}`);
    case "mix": return renderMix(arg);
    case "recent": return renderGenerated("Recently played", recentItems(), `The tunes you played last ${playedWhere()}`);
    case "home": return renderHome();
    default: return renderSearch();
  }
}

// A scanned sync QR code opens #/sync/<key>. Drop the key from the address
// (and history) right away, then ask before joining sync.
function joinSyncLink(key) {
  history.replaceState(null, "", "#/settings");
  renderSettings();
  if (syncSheet) syncSheet.joinFromLink(key);
  else toast("Sync isn't available here", { color: "warning" });
}

// ---- actions ----------------------------------------------------------------

function toggleFavorite(item) {
  store.toggleFavorite(item);
  nowPlaying.refreshFavorite();
  const { name, arg } = currentRoute();
  if (name === "playlist" && arg === store.favorites()?.id) render();
  else refreshRowMarks();
}

function playlistNameError(name, exceptId) {
  const clean = sanitizeName(name, "");
  if (!clean) return "Enter a playlist name.";
  return store.nameExists(clean, exceptId) ? "A playlist with this name already exists. Choose another name." : null;
}

function addToPlaylist(item) {
  actionSheet("Add to playlist", [
    { text: "New playlist…", icon: "add", handler: async () => {
      const name = await prompt("New playlist", { placeholder: "Name", confirm: "Create", validate: playlistNameError });
      if (name === null) return;
      store.create(name, [{ path: item.path, song: item.song }]);
    } },
    ...store.playlists.map((pl) => ({
      text: pl.name,
      icon: "list",
      handler: () => addToExisting(pl, item),
    })),
  ]);
}

// Tunes already there are asked about first, unless the playlist allows
// duplicates. Favorites hold each tune once.
async function addToExisting(pl, item) {
  if (store.has(pl.id, item) && !pl.allowDuplicates) {
    if (pl.id === store.favorites()?.id) return;
    const answer = await duplicateDialog(item.title, pl.name);
    if (answer === "cancel") return;
    if (answer === "always") store.setAllowDuplicates(pl.id, true);
  }
  store.add(pl.id, item);
}

async function setPlaylistSubtune(playlistId, item, position) {
  const entry = store.get(playlistId)?.items[position];
  if (!entry) return;
  const song = await subtuneDialog(item);
  if (song === null || song === item.song || !Number.isInteger(song) || song < 1 || song > item.songs) return;
  const pl = store.get(playlistId);
  // An overlay can outlive a synced update or a playlist deletion.
  if (pl?.items[position] !== entry) return;
  if (store.has(pl.id, { path: item.path, song }) && !pl.allowDuplicates) {
    if (pl.id === store.favorites()?.id) return;
    const answer = await duplicateDialog(item.title, pl.name);
    if (answer === "cancel") return;
    if (store.get(playlistId)?.items[position] !== entry) return;
    if (answer === "always") store.setAllowDuplicates(pl.id, true);
  }
  store.setSubtune(playlistId, position, song);
  if (currentRoute().name === "playlist" && currentRoute().arg === playlistId) render();
}

function rowMenu(item, position) {
  const buttons = [];
  if (!item.missing) {
    const favorite = store.isFavorite(item);
    buttons.push(
      { text: favorite ? "Remove from Favorites" : "Add to Favorites", icon: favorite ? "star-outline" : "star", handler: () => toggleFavorite(item) },
      { text: "Play next", icon: "return-down-forward", handler: () => (player.current ? player.playNext(item) : player.setQueue([item])) },
      { text: "Add to queue", icon: "list", handler: () => (player.current ? player.enqueue(item) : player.setQueue([item])) },
      { text: "Add to playlist…", icon: "add-circle-outline", handler: () => setTimeout(() => addToPlaylist(item), 300) },
      { text: "Go to folder", icon: "folder-open-outline", handler: () => go(`#/browse/${encodeURIComponent(item.dir)}`) },
      { text: "Share…", icon: "share-outline", handler: () => shareTune(item) },
      ...(tags.canTag ? [{ text: "Edit Tags…", icon: "pricetags-outline", handler: () => tagSheet.open(item) }] : []),
      ...(tags.isAdmin ? [hotTuneOn(item.path)
        ? { text: "Remove from Hot Tunes", icon: "flame-outline", handler: () => toggleHotTune(item) }
        : { text: "Add to Hot Tunes", icon: "flame", handler: () => toggleHotTune(item) }] : []),
    );
  }
  if (listOptions.playlistId) {
    const playlistId = listOptions.playlistId;
    if (!item.missing && item.songs > 1) {
      buttons.push({ text: "Set subtune…", icon: "musical-notes-outline",
        handler: () => setTimeout(() => setPlaylistSubtune(playlistId, item, position), 300) });
    }
    buttons.push({ text: "Remove from playlist", role: "destructive", icon: "trash-outline", handler: () => {
      store.removeAt(listOptions.playlistId, position);
      render();
    } });
  }
  actionSheet(item.title || item.path, buttons);
}

async function exportPlaylist(pl) {
  const text = toM3U8(pl, {
    baseUrl: SID_SOURCES[0],
    meta: (path, song) => {
      const t = index.get(path);
      return t && { title: t.title, author: t.author, seconds: t.lengths?.[song - 1] ?? -1 };
    },
  });
  const fileName = safeFileName(pl.name);
  await saveFile(fileName, text, "audio/x-mpegurl", { title: pl.name });
}

// Share: a shared playlist sends its live link; otherwise choose live or snapshot.
async function sharePlaylist(pl) {
  if (pl.share) return shareUrl(pl.name, liveShare.link(pl.share));
  if (!liveShare.configured) return shareSnapshot(pl);
  actionSheet(`Share “${pl.name}”`, [
    { text: "Live Link", icon: "link", handler: () => startSharing(pl) },
    { text: "Snapshot Link", icon: "copy-outline", handler: () => shareSnapshot(pl) },
  ], { subHeader: "A live link always shows your latest version. A snapshot link is a copy of the playlist as it is now." });
}

async function shareSnapshot(pl) {
  shareUrl(pl.name, `${location.origin}${location.pathname}#/share/${await encodeShare(pl)}`);
}

async function startSharing(pl) {
  try {
    const share = await liveShare.publish(pl);
    render();
    await shareUrl(pl.name, liveShare.link(share));
  } catch (err) {
    toast(`Couldn't share: ${err.message}`, { color: "danger" });
  }
}

async function stopSharing(pl) {
  if (!(await confirmDialog("Stop sharing?", "The link stops working for everyone who has it. The playlist stays here.", "Stop Sharing"))) return;
  try {
    await liveShare.stop(pl);
    render();
  } catch (err) {
    toast(`Couldn't stop sharing: ${err.message}`, { color: "danger" });
  }
}

function visibilityMenu(pl) {
  const url = liveShare.link(pl.share);
  actionSheet("Anyone with the link", [
    { text: "Copy Link", icon: "copy-outline", handler: () => copyText(url) },
    { text: "Share…", icon: "share-outline", handler: () => shareUrl(pl.name, url) },
    { text: "Stop Sharing", role: "destructive", icon: "close-circle-outline", handler: () => stopSharing(pl) },
  ], { subHeader: url });
}

async function shareUrl(title, url, text = `${title} – a C64 playlist on ShallowSID`) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
      // e.g. no user gesture left after a network wait: fall back to copying
    }
  }
  await copyText(url);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    prompt("Copy this link", { value: text, confirm: "Done" });
  }
}

// A pasted ShallowSID link opens the playlist's preview; "Save to my playlists"
// there is the confirmation. Only the link's #fragment is used.
async function openPlaylistLink() {
  const text = await prompt("Open playlist link", { placeholder: "https://…/#/p/… or #/share/…", confirm: "Open" });
  if (text === null || !text.trim()) return;
  const link = parsePlaylistLink(text);
  if (!link) return toast("That isn't a ShallowSID playlist link", { color: "warning" });
  go(link.kind === "live" ? `#/p/${link.id}` : `#/share/${link.blob}`);
}

// All the user's data as one file, and back (see user-data.js).
async function exportUserData() {
  const text = JSON.stringify(toBundle(sync.snapshot(), searchHistory.items));
  await saveFile(userDataFileName(), text, "application/json", { title: "ShallowSID data", description: "ShallowSID data (unencrypted; keep this file private)", extension: ".json" });
}

async function importUserData(file) {
  let imported;
  try {
    imported = parseBundle(await file.text());
  } catch (err) {
    return toast(err.message, { color: "warning" });
  }
  if (!(await confirmDialog("Import data?",
    "Adds the playlists, favorites, sound presets and play history from the file to the ones here. Nothing here is removed.", "Import"))) return;
  const local = sync.snapshot();
  sync.applyData(mergeImport(local, imported.data), local);
  searchHistory.merge(imported.searches);
}

async function saveImportedPlaylist(name, items, skipped = 0) {
  name = sanitizeName(name, "Imported playlist");
  items = sanitizeItems(items, undefined, Infinity);
  if (!items.length) {
    toast("No valid SID entries found", { color: "warning" });
    return null;
  }
  const matches = store.playlists.filter(pl => nameKey(pl.name) === nameKey(name));
  if (!matches.length) return store.create(name, items);
  const identical = matches.find(pl => sameItems(pl.items, items));
  if (identical) {
    go(`#/playlist/${identical.id}`);
    return null;
  }
  const result = await playlistImportSheet(matches, { name, items }, index, skipped);
  if (!result) return null;
  if (result.kind === "copy") return store.create(nextPlaylistName(name, store.playlists), items);
  // Sync or another tab may have changed the target while the sheet was open.
  const current = store.get(result.target.id);
  if (!current || !sameItems(current.items, result.original)) {
    toast("Playlist changed. Import again to review the latest version.", { color: "warning" });
    return null;
  }
  current.items = result.items;
  store.save(current);
  return current;
}

async function importFile(file) {
  if (/\.zip$/i.test(file.name)) {
    try {
      const { items, skipped } = await matchZip(file, index);
      if (!items.length) return toast(`No matching SID files found${skipped ? ` (${skipped} skipped)` : ""}`, { color: "warning" });
      const pl = await saveImportedPlaylist(nameFromFileName(file.name), items, skipped);
      if (!pl) return;
      if (skipped) toast(`${skipped} SID files not found`, { color: "warning" });
      go(`#/playlist/${pl.id}`);
    } catch (err) {
      toast(err.message || "Could not import ZIP", { color: "warning" });
    }
    return;
  }
  const parsed = parseM3U8(await file.text(), nameFromFileName(file.name));
  if (!parsed.items.length) return toast("No SID files found in that playlist", { color: "warning" });
  const pl = await saveImportedPlaylist(parsed.name, parsed.items);
  if (!pl) return;
  const missing = resolveItems(pl.items).filter((i) => i.missing).length;
  if (missing) toast(`${missing} SID files not found`, { color: "warning" });
  go(`#/playlist/${pl.id}`);
}

// ---- wiring -----------------------------------------------------------------

function listItemAt(el) {
  return listItems[Number(el.dataset.play ?? el.dataset.menu)];
}

dom.view.addEventListener("click", (e) => {
  const recentRemove = e.target.closest("[data-recent-remove]");
  if (recentRemove) {
    e.stopPropagation();
    searchHistory.remove(Number(recentRemove.dataset.recentRemove));
    return renderSearch();
  }
  if (e.target.closest("[data-clear-searches]")) {
    searchHistory.clear();
    return renderSearch();
  }
  const recent = e.target.closest("[data-recent]");
  if (recent) {
    const i = Number(recent.dataset.recent);
    return openRecent(searchHistory.items[i], i);
  }
  const sortButton = e.target.closest("[data-sort]");
  if (sortButton) return chooseSort(sortButton.dataset.sort);
  const direction = e.target.closest("[data-sort-direction]")?.dataset.sortDirection;
  if (direction) {
    const sort = direction === "list" ? listSort() : sorts.search;
    return setSort(direction, { ...sort, desc: !sort.desc });
  }
  const menu = e.target.closest("[data-menu]");
  if (menu) {
    e.stopPropagation();
    return rowMenu(listItemAt(menu), Number(menu.dataset.menu));
  }
  const composer = e.target.closest("[data-open-composer]");
  if (composer) return go(composerHref(composer.dataset.openComposer));
  const tag = e.target.closest("[data-open-tag]");
  if (tag) return go(tagHref(tag.dataset.openTag));
  if (e.target.closest("[data-all-tags]")) return go("#/tags");
  const row = e.target.closest("[data-play]");
  if (row && !e.target.closest("ion-reorder")) {
    const pos = Number(row.dataset.play);
    // A list in sections queues just the section played from.
    const section = listOptions.sections?.find((s) => pos >= s.start && pos < s.start + s.count);
    const playable = (section ? listItems.slice(section.start, section.start + section.count) : listItems).filter((i) => !i.missing);
    if (listOptions.playlistId) store.markPlayed(listOptions.playlistId);
    if (searchQuery && currentRoute().name === "search") searchHistory.add({ path: listItems[pos].path, song: listItems[pos].song });
    player.setQueue(playable, playable.indexOf(listItems[pos]));
  }
});

dom.searchbar.addEventListener("ionInput", (e) => runSearch(e.target.value || ""));
dom.infinite.addEventListener("ionInfinite", (e) => {
  appendPage();
  e.target.complete();
});
dom.tabBar.addEventListener("ionTabButtonClick", (e) => {
  recentOpen = false;
  go(`#/${e.detail.tab}`);
});
$("user-data-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) importUserData(file);
});
dom.importInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) importFile(file);
});

// A play counts once heard for a while, so skipping through a list doesn't.
let uncounted = null;
player.addEventListener("time", ({ detail: { position, duration } }) => {
  if (uncounted && position >= Math.min(PLAY_COUNT_SECONDS, duration / 2)) {
    store.addPlay(uncounted);
    uncounted = null;
  }
});
player.addEventListener("track", ({ detail: { item } }) => {
  const token = player.token;
  player.romsReady.then(() => {
    if (token !== player.token || player.u64 || !sidFeatures(item, item.song)?.basic) return;
    if (player.roms?.basic && player.roms?.kernal) return;
    toast("This BASIC tune needs C64 ROMs.", {
      duration: 6000,
      buttons: [{ text: "Add C64 ROMs", handler: () => go("#/settings/roms") }],
    });
  });
  // Curators see others' edits at once; everyone else reads the deployed index,
  // so playing tunes still doesn't talk to Firestore.
  if (tags.canTag) tags.refresh(item).catch((err) => console.error("tags:", err));
  uncounted = item;
  store.addRecent(item);
  refreshRowMarks();
});
player.addEventListener("error", ({ detail }) => {
  if (/memory access out of bounds/i.test(detail.message)) {
    console.error("Playback engine failed:", detail.message);
    const action = install.installed ? "restart the app" : "reload the page";
    toast(`Oops! Something went wrong. Please ${action}.`, { color: "danger", duration: 6000 });
  } else {
    toast(detail.message, { color: "danger" });
  }
});
window.addEventListener("hashchange", render);

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.("input, textarea, ion-searchbar, ion-input, ion-alert")) return;
  if (e.code === "Space") { e.preventDefault(); player.toggle(); }
  else if (e.key === "ArrowRight" && e.shiftKey) player.next();
  else if (e.key === "ArrowLeft" && e.shiftKey) player.previous();
  else if (e.key === "f" && player.current) toggleFavorite(player.current);
  else if (e.key === "t" && player.current && tags.canTag) tagSheet.open(player.current);
});

try {
  const tagsReady = tags.init();
  const noticesReady = notices.load();
  const curatedReady = loadCurated();
  index = await loadIndex({ onText: (text) => searchWorker.postMessage({ type: "load", text }) });
  await Promise.all([tagsReady, curatedReady]);
  $("hvsc-version").textContent = index.version ? `HVSC #${index.version}` : "HVSC";
  dom.searchbar.placeholder = `Search High Voltage SID Collection ${index.tunes.length.toLocaleString()} tunes, composers, groups, …`;
  // Read before render(): those links drop themselves from the address.
  const openedByLink = ["sync", "curate"].includes(currentRoute().name);
  render();
  await noticesReady;
  // Not over the dialog a sync key or invite link opens: once the user moves on.
  if (openedByLink) window.addEventListener("hashchange", () => notices.start(), { once: true });
  else notices.start();
} catch (err) {
  searchError = err.message;
  dom.view.innerHTML = `<div class="empty"><p>${esc(err.message)}</p><p>Run <code>python3 tools/build_index.py</code> first.</p></div>`;
}

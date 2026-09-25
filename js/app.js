// ShallowSID: hash router + views (Search, Browse, Playlists, Share).

import { loadIndex } from "./index-store.js";
import { NowPlaying } from "./now-playing.js";
import { Player } from "./player/player.js";
import { connectMediaSession } from "./player/media-session.js";
import { decodeShare, encodeShare, nameFromFileName, parseM3U8, safeFileName, toM3U8 } from "./playlist-format.js";
import { PlaylistStore } from "./playlists.js";
import { toEngineConfig } from "./sound-profile.js";
import { SoundSettings } from "./sound-settings.js";
import { SoundSheet } from "./sound-sheet.js";
import { COMPOSERS, COMPOSER_ALIASES } from "./suggestions.js";
import { DEFAULT_SORT, SORTS, normalizeSort, sortResults } from "./result-sort.js";
import { SyncService } from "./sync.js";
import { LiveShare } from "./live-share.js";
import { parsePlaylistLink, sanitizeItems, sanitizeName } from "./live-share-core.js";
import { SyncSheet } from "./sync-sheet.js";
import { paintAvatars } from "./avatars.js";
import { Install, registerServiceWorker } from "./install.js";
import { actionSheet, confirmDialog, esc, prompt, saveFile, toast, tuneRow } from "./ui.js";

const PAGE_SIZE = 100;
// SID files come from the official HVSC site (CORS-enabled, fetched one by one).
// A local copy under hvsc/ (tools/fetch_hvsc.py) is the fallback.
const SID_SOURCES = ["https://www.hvsc.c64.org/download/C64Music/", new URL("../hvsc/", import.meta.url).href];
const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
const SUGGESTION_COUNT = 10;
const FAVORITE_COMPOSER_COUNT = 10;
const SHELF_COUNT = 10;
const MOST_PLAYED_COUNT = 50;
const PLAY_COUNT_SECONDS = 30;   // heard this long (or half of a shorter tune) counts as a play
const SORT_KEY = "shallowsid.searchSort";

const $ = (id) => document.getElementById(id);
const dom = {
  title: $("title"), back: $("back"), actions: $("toolbar-actions"), searchToolbar: $("search-toolbar"),
  searchbar: $("searchbar"), content: $("content"), view: $("view"), infinite: $("infinite"),
  tabBar: $("tab-bar"), importInput: $("import-input"), titleToolbar: $("title-toolbar"),
};

const store = new PlaylistStore();
const sound = new SoundSettings();
const player = new Player({ sidUrls: (item) => SID_SOURCES.map((base) => base + encodePath(item.path)), prerender: sound.prerender });
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
});
soundSheet.addEventListener("preview", (e) => applySound({ ...sound.current, ...e.detail }));
soundSheet.addEventListener("adjusting", (e) => player.setAdjusting(e.detail));
applySound();
const sync = new SyncService({ store, sound });
const syncSheet = sync.configured ? new SyncSheet(sync) : null;
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
globalThis.shallowsid = { player, store, sound, sync };   // handy from the devtools console
const nowPlaying = new NowPlaying(player, {
  onAddToPlaylist: (item) => addToPlaylist(item),
  onShowFolder: (dir) => go(`#/browse/${encodeURIComponent(dir)}`),
  onOpenComposer: (credit) => go(composerHref(composerName(credit))),
  isFavorite: (item) => store.isFavorite(item),
  onToggleFavorite: (item) => toggleFavorite(item),
  onOpenSound: () => soundSheet.open(),
});

let index = null;               // IndexStore, once loaded
let listItems = [];             // queue items backing the list currently shown
let listShown = 0;
let listOptions = {};           // {playlistId} when the list is a playlist
let searchQuery = "";
let searchSeq = 0;
let lastResults = null;
let searchSort = loadSort();     // last used order is the default

// ---- search worker ----------------------------------------------------------

const searchWorker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
let searchReady = false;
let searchError = null;
let lastIds = null;             // result ids; turned into tunes once the index is in
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

function runSearch(query) {
  searchQuery = query.trim();
  // Results live at #/search, an empty search is Home (no history entry per keystroke).
  const route = currentRoute().name;
  if (searchQuery && route !== "search") history.replaceState(null, "", "#/search");
  else if (!searchQuery && route === "search") history.replaceState(null, "", "#/home");
  lastResults = lastIds = null;
  if (searchQuery) searchWorker.postMessage({ type: "search", id: ++searchSeq, query: searchQuery });
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
const suggestions = shuffle(COMPOSERS).slice(0, SUGGESTION_COUNT).map(composerChip);
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
  if (recent) cards.push({ href: "#/recent", name: "Recently played", count: recent, art: "recent-art", icon: "time" });
  for (const p of store.recentPlaylists()) if (p !== favorites) cards.push({ playlist: p });
  return cards.slice(0, SHELF_COUNT).map((c) => c.playlist
    ? { href: `#/playlist/${c.playlist.id}`, name: c.playlist.name, count: c.playlist.items.length,
        art: c.playlist.favorites ? "favorites-thumb" : "playlist-thumb", icon: c.playlist.favorites ? "star" : "musical-notes",
        avatar: c.playlist.favorites ? null : c.playlist.id }
    : c);
}

const shelf = (cards) => `<div class="shelf">${cards.map((c) => `
  <a class="shelf-card" href="${c.href}">
    <div class="shelf-art ${c.art}" ${c.avatar ? `data-avatar="${esc(c.avatar)}"` : ""}><ion-icon name="${c.icon}"></ion-icon></div>
    <span class="shelf-title">${esc(c.name)}</span>
    <span class="shelf-sub">${c.count} tune${c.count === 1 ? "" : "s"}</span>
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
  showSortButton();
  dom.title.textContent = title;
  dom.titleToolbar.hidden = !title && !back && !actions;   // Home and search results show just the search bar
  dom.back.hidden = !back;
  // "history" goes back to wherever the page was opened from (Home when opened directly).
  dom.back.onclick = back === "history" ? () => (history.length > 1 ? history.back() : go("#/home")) : back ? () => go(back) : null;
  dom.actions.innerHTML = actions;
  dom.searchToolbar.hidden = !search;
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
  const cur = player.current;
  const favorites = favoriteKeys();
  const page = listItems.slice(listShown, listShown + PAGE_SIZE);
  const heading = (at) => {
    const section = listOptions.sections?.find((s) => s.start === at);
    return section ? `<ion-list-header><ion-label>${esc(section.title)}</ion-label></ion-list-header>` : "";
  };
  list.insertAdjacentHTML("beforeend", page.map((item, i) => heading(listShown + i) + tuneRow(item, listShown + i, {
    missing: item.missing,
    current: cur && cur.path === item.path && cur.song === item.song,
    favorite: favorites.has(itemKey(item)),
  })).join(""));
  listShown += page.length;
  const more = listShown < listItems.length;
  dom.infinite.disabled = !more || listOptions.all;
  // Until another list replaces this one.
  if (more && listOptions.all) requestAnimationFrame(() => list.isConnected && appendPage());
}

const itemKey = (item) => `${item.path}#${item.song}`;
const favoriteKeys = () => new Set((store.favorites()?.items ?? []).map(itemKey));

// Update the "now playing" and favorite marks of the rows shown, in place.
function refreshRowMarks() {
  const cur = player.current;
  const favorites = favoriteKeys();
  document.querySelectorAll("#tune-list .tune-row[data-play]").forEach((row) => {
    const item = listItems[Number(row.dataset.play)];
    if (!item) return;
    row.classList.toggle("is-current", !!cur && item.path === cur.path && item.song === cur.song);
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
  if (!searchQuery) {
    const composers = favoriteComposers();
    const cards = shelfCards();
    dom.view.innerHTML = `
      <section class="home">
        <h2 class="section-title">Popular composers</h2>
        ${chips(suggestions)}
        ${composers.length ? `<h2 class="section-title">Your favorite composers</h2>${chips(composers)}` : ""}
        ${cards.length ? `<h2 class="section-title">Jump back in</h2>${shelf(cards)}` : ""}
        <div class="empty"><p>Search ${index ? index.tunes.length.toLocaleString() : "the"} C64 tunes of the High Voltage SID Collection.</p></div>
      </section>`;
    paintAvatars(dom.view);
    dom.infinite.disabled = true;
    return;
  }
  if (searchError) {
    dom.view.innerHTML = `<div class="empty"><p>Search is unavailable: ${esc(searchError)}</p><p>Browse still works.</p></div>`;
    dom.infinite.disabled = true;
    return;
  }
  if (lastIds && !lastResults && index) lastResults = lastIds.map((id) => asItem(index.tunes[id]));
  if (!searchReady || !lastResults) {
    dom.view.innerHTML = `<div class="empty"><ion-spinner></ion-spinner><p>${searchReady ? "Searching…" : "Indexing HVSC…"}</p></div>`;
    dom.infinite.disabled = true;
    return;
  }
  if (!lastResults.length) {
    dom.view.innerHTML = `<div class="empty"><p>No tunes match “${esc(searchQuery)}”.</p></div>`;
    dom.infinite.disabled = true;
    return;
  }
  const shown = lastResults.length;
  const count = lastTotal > shown ? `The best ${shown.toLocaleString()} of ${lastTotal.toLocaleString()} tunes. Add a word to narrow it down.`
    : shown === 1 ? "1 tune" : `${shown.toLocaleString()} tunes`;
  dom.view.innerHTML = `<p class="result-count">${count}</p><div id="results"></div>`;
  showList($("results"), sortResults(lastResults, searchSort));
}

// ---- result sorting (Spotify-style: a sort button beside the search field) --

function loadSort() {
  try {
    return normalizeSort(JSON.parse(localStorage.getItem(SORT_KEY)));
  } catch {
    return { ...DEFAULT_SORT };
  }
}

const sortDirection = ({ by, desc }) => (by === "year" ? (desc ? "newest first" : "oldest first") : desc ? "Z–A" : "A–Z");

function sortCaption({ by, desc }, long = false) {
  const label = SORTS.find((s) => s.id === by).label;
  return long && by !== "relevance" ? `${label} (${sortDirection({ by, desc })})` : label;
}

function showSortButton() {
  const visible = currentRoute().name === "search" && !!searchQuery;
  $("sort-button").hidden = !visible;
  $("sort-label").textContent = sortCaption(searchSort);
  const direction = $("sort-direction");
  direction.hidden = !visible || searchSort.by === "relevance";
  direction.querySelector("ion-icon").name = searchSort.desc ? "arrow-down" : "arrow-up";
  // ion-button throws on aria changes while it is still loading
  const label = () => direction.setAttribute("aria-label", `Reverse order (now ${sortDirection(searchSort)})`);
  const ready = direction.componentOnReady?.();
  if (ready) ready.then(label);
  else label();
}

function setSort(next) {
  searchSort = normalizeSort(next);
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(searchSort));
  } catch {
    // storage blocked: the order lasts for this visit
  }
  showSortButton();
  if (lastResults) renderSearch();
}

// Picking the current order again also reverses it; the arrow button does it in one tap.
function chooseSort() {
  actionSheet("Sort by", SORTS.map((s) => {
    const current = s.id === searchSort.by;
    return {
      text: current ? sortCaption(searchSort, true) : s.label,
      icon: current ? "checkmark" : undefined,
      cssClass: current ? "sort-current" : undefined,
      handler: () => setSort({ by: s.id, desc: current ? !searchSort.desc : false }),
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
    <div id="dir-tunes"></div>`;
  const items = tunes.map((t) => asItem(t));
  showList($("dir-tunes"), items, { all: true });
  $("play-all")?.addEventListener("click", () => items.length && player.setQueue(items, 0));
}

function renderPlaylists() {
  setChrome({
    title: "Playlists",
    tab: "playlists",
    actions: `${syncSheet ? `<ion-button id="sync-open" aria-label="Sync"><ion-icon slot="icon-only" name="${syncIcon()}"></ion-icon></ion-button>` : ""}
              <ion-button id="import-pl" aria-label="Import .m3u8"><ion-icon slot="icon-only" name="document-attach-outline"></ion-icon></ion-button>
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
            : `<div slot="start" class="thumb playlist-thumb" data-avatar="${esc(p.id)}"><ion-icon name="musical-notes"></ion-icon></div>`}
          <ion-label><h2>${esc(p.name)}</h2><p>${p.items.length} tune${p.items.length === 1 ? "" : "s"}</p></ion-label>
        </ion-item>`).join("")}</ion-list>`
    : `<div class="empty"><ion-icon name="list" class="empty-icon"></ion-icon>
        <p>No playlists yet. Star a tune to start your Favorites, add tunes with <strong>⋯</strong>, or import an <code>.m3u8</code>.</p>
        <ion-button id="new-pl-empty">New playlist</ion-button></div>`;
  paintAvatars(dom.view);
  const create = async () => {
    const name = await prompt("New playlist", { placeholder: "Name", confirm: "Create" });
    if (name !== null) go(`#/playlist/${store.create(name).id}`);
  };
  $("new-pl").addEventListener("click", create);
  $("new-pl-empty")?.addEventListener("click", create);
  $("import-pl").addEventListener("click", () => actionSheet("Import playlist", [
    { text: "Import File…", icon: "document-attach-outline", handler: () => dom.importInput.click() },
    { text: "Open Link…", icon: "link", handler: () => openPlaylistLink() },
  ]));
  $("sync-open")?.addEventListener("click", () => syncSheet.open());
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
      <ion-button id="pl-edit" fill="clear" ${items.length ? "" : "disabled"}>Edit</ion-button>
    </div>
    ${pl.share ? `<ion-item button detail="false" lines="none" class="visibility-row" id="pl-visibility">
        <ion-icon slot="start" name="link" color="primary"></ion-icon>
        <ion-label><h3>Anyone with the link</h3><p>Viewers see your latest changes</p></ion-label>
      </ion-item>` : ""}
    ${items.length ? "" : `<div class="empty"><p>Empty. Add tunes with <strong>⋯</strong> on any song.</p></div>`}
    <ion-list id="tune-list"></ion-list>`;
  dom.infinite.disabled = true;
  const renderRows = (editing) => {
    listItems = items;
    listOptions = { playlistId: id };
    const cur = player.current;
    const favorites = favoriteKeys();
    const list = $("tune-list");
    list.classList.toggle("is-editing", editing);
    list.innerHTML = `<ion-reorder-group id="pl-reorder">${items.map((item, i) => tuneRow(item, i, {
      missing: item.missing,
      reorder: editing,
      current: cur?.path === item.path && cur?.song === item.song,
      favorite: favorites.has(itemKey(item)),
    })).join("")}</ion-reorder-group>`;
    const group = $("pl-reorder");
    group.disabled = !editing;
    group.addEventListener("ionItemReorder", (e) => {
      store.move(id, e.detail.from, e.detail.to);
      items.splice(e.detail.to, 0, items.splice(e.detail.from, 1)[0]);
      e.detail.complete(false);
      renderRows(true);
    });
  };
  let editing = false;
  renderRows(editing);
  $("pl-edit").addEventListener("click", (e) => {
    editing = !editing;
    e.target.textContent = editing ? "Done" : "Edit";
    renderRows(editing);
  });
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
    { text: "Rename", icon: "create-outline", handler: async () => {
      const name = await prompt("Rename playlist", { value: pl.name });
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
// ---- composer page ---------------------------------------------------------

const TOP_TUNES = 5;
// A composer is the name HVSC credits them by, or its alias (COMPOSER_ALIASES).
const composerName = (credit) => COMPOSER_ALIASES[credit] ?? credit;
const composerHref = (name) => `#/composer/${encodeURIComponent(name)}`;
// Joint credits read "A & B" or "A, B & C".
const creditParts = (credit) => credit.split(/\s*[&,]\s*/);
const tuneYear = (tune) => Number(tune.released?.match(/\b(19|20)\d\d\b/)?.[0]);
const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

// Their own tunes, and those credited jointly with others.
function composerTunes(name) {
  const own = [], shared = [];
  for (const t of index.tunes) {
    if (composerName(t.author) === name) own.push(t);
    else if (/[&,]/.test(t.author) && creditParts(t.author).some((part) => composerName(part) === name)) shared.push(t);
  }
  return { own: own.sort(byTitle), shared: shared.sort(byTitle) };
}

// Like an artist page: who, how much and when, what you play most, then everything.
function renderComposer(name) {
  const [label] = composerChip(name);
  const realName = name.replace(/\s*\([^)]*\)\s*$/, "");
  const { own, shared } = composerTunes(name);
  const tunes = [...own, ...shared].map((t) => asItem(t));
  const paths = new Set(tunes.map((t) => t.path));
  const top = resolveItems(store.mostPlayed().filter((p) => paths.has(p.path)).slice(0, TOP_TUNES)).filter((i) => !i.missing);
  const years = tunes.map(tuneYear).filter(Number.isFinite);
  const span = years.length ? [...new Set([Math.min(...years), Math.max(...years)])].join("–") : "";
  const dirs = new Set(own.map((t) => t.dir));
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
    ${tunes.length ? "" : `<div class="empty"><p>No tunes are credited to ${esc(name)}.</p></div>`}
    <div id="composer-tunes"></div>`;
  paintAvatars(dom.view);
  const parts = [["Your top tunes", top], ["Tunes", own.map((t) => asItem(t))], ["With others", shared.map((t) => asItem(t))]].filter(([, items]) => items.length);
  let start = 0;
  const sections = parts.map(([title, items]) => ({ title, start: (start += items.length) - items.length, count: items.length }));
  showList($("composer-tunes"), parts.flatMap(([, items]) => items), { all: true, sections });
  $("top-play").addEventListener("click", () => player.setQueue(tunes, 0));
  $("top-shuffle").addEventListener("click", () => player.setQueue(shuffle(tunes), 0));
  $("composer-folder")?.addEventListener("click", () => go(`#/browse/${encodeURIComponent(folder)}`));
  $("composer-search").addEventListener("click", () => searchFor(name));
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
    toast(`Saved “${pl.name}”`);
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
    toast(`Saved “${pl.name}”`);
    go(`#/playlist/${pl.id}`);
  });
}

function render() {
  if (!index) return;
  const { name, arg } = currentRoute();
  dom.content.scrollToTop?.();
  switch (name) {
    case "browse": return renderBrowse(arg);
    case "playlists": return renderPlaylists();
    case "playlist": return renderPlaylist(arg);
    case "share": return renderShare(arg);
    case "p": return renderLive(arg);
    case "sync": return joinSyncLink(arg);
    case "composer": return renderComposer(arg);
    case "most-played": return renderGenerated("Your most played", mostPlayedItems(), `Your ${MOST_PLAYED_COUNT} most played tunes ${playedWhere()}`);
    case "recent": return renderGenerated("Recently played", recentItems(), `The tunes you played last ${playedWhere()}`);
    case "home": return renderHome();
    default: return renderSearch();
  }
}

// A scanned sync QR code opens #/sync/<key>. Drop the key from the address
// (and history) right away, then let the Sync sheet ask before joining.
function joinSyncLink(key) {
  history.replaceState(null, "", "#/playlists");
  renderPlaylists();
  if (syncSheet) syncSheet.joinFromLink(key);
  else toast("Sync isn't available here", { color: "warning" });
}

// ---- actions ----------------------------------------------------------------

function shuffle(items) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toggleFavorite(item) {
  const on = store.toggleFavorite(item);
  toast(on ? "Added to Favorites" : "Removed from Favorites", { duration: 1200 });
  nowPlaying.refreshFavorite();
  const { name, arg } = currentRoute();
  if (name === "playlist" && arg === store.favorites()?.id) render();
  else refreshRowMarks();
}

function addToPlaylist(item) {
  actionSheet("Add to playlist", [
    { text: "New playlist…", icon: "add", handler: async () => {
      const name = await prompt("New playlist", { placeholder: "Name", confirm: "Create" });
      if (name === null) return;
      const pl = store.create(name, [{ path: item.path, song: item.song }]);
      toast(`Added to “${pl.name}”`);
    } },
    ...store.playlists.map((pl) => ({
      text: pl.name,
      icon: "list",
      handler: () => { store.add(pl.id, item); toast(`Added to “${pl.name}”`); },
    })),
  ]);
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
    );
  }
  if (listOptions.playlistId) {
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
  const outcome = await saveFile(fileName, text, "audio/x-mpegurl", { title: pl.name });
  if (outcome === "saved" || outcome === "downloaded") toast(`Saved “${fileName}”`);
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
    toast("Link no longer works");
    render();
  } catch (err) {
    toast(`Couldn't stop sharing: ${err.message}`, { color: "danger" });
  }
}

function visibilityMenu(pl) {
  const url = liveShare.link(pl.share);
  actionSheet("Anyone with the link", [
    { text: "Copy Link", icon: "copy-outline", handler: () => copyText(url, "Link copied") },
    { text: "Share…", icon: "share-outline", handler: () => shareUrl(pl.name, url) },
    { text: "Stop Sharing", role: "destructive", icon: "close-circle-outline", handler: () => stopSharing(pl) },
  ], { subHeader: url });
}

async function shareUrl(title, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text: `${title} – a C64 playlist on ShallowSID`, url });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
      // e.g. no user gesture left after a network wait: fall back to copying
    }
  }
  await copyText(url, "Share link copied");
}

async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
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

async function importFile(file) {
  const parsed = parseM3U8(await file.text(), nameFromFileName(file.name));
  if (!parsed.items.length) return toast("No SID files found in that playlist", { color: "warning" });
  const pl = store.create(parsed.name, parsed.items);
  const missing = resolveItems(parsed.items).filter((i) => i.missing).length;
  toast(`Imported ${parsed.items.length} tunes${missing ? ` (${missing} not found)` : ""}`);
  go(`#/playlist/${pl.id}`);
}

// ---- wiring -----------------------------------------------------------------

function listItemAt(el) {
  return listItems[Number(el.dataset.play ?? el.dataset.menu)];
}

dom.view.addEventListener("click", (e) => {
  const menu = e.target.closest("[data-menu]");
  if (menu) {
    e.stopPropagation();
    return rowMenu(listItemAt(menu), Number(menu.dataset.menu));
  }
  const composer = e.target.closest("[data-open-composer]");
  if (composer) return go(composerHref(composer.dataset.openComposer));
  const row = e.target.closest("[data-play]");
  if (row && !row.closest(".is-editing")) {
    const pos = Number(row.dataset.play);
    // A list in sections queues just the section played from.
    const section = listOptions.sections?.find((s) => pos >= s.start && pos < s.start + s.count);
    const playable = (section ? listItems.slice(section.start, section.start + section.count) : listItems).filter((i) => !i.missing);
    if (listOptions.playlistId) store.markPlayed(listOptions.playlistId);
    player.setQueue(playable, playable.indexOf(listItems[pos]));
  }
});

dom.searchbar.addEventListener("ionInput", (e) => runSearch(e.target.value || ""));
$("sort-button").addEventListener("click", chooseSort);
$("sort-direction").addEventListener("click", () => setSort({ ...searchSort, desc: !searchSort.desc }));
dom.infinite.addEventListener("ionInfinite", (e) => {
  appendPage();
  e.target.complete();
});
dom.tabBar.addEventListener("ionTabButtonClick", (e) => go(`#/${e.detail.tab}`));
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
  uncounted = item;
  store.addRecent(item);
  refreshRowMarks();
});
player.addEventListener("error", ({ detail }) => toast(detail.message, { color: "danger" }));
window.addEventListener("hashchange", render);

document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, ion-searchbar, ion-input, ion-alert")) return;
  if (e.code === "Space") { e.preventDefault(); player.toggle(); }
  else if (e.key === "ArrowRight" && e.shiftKey) player.next();
  else if (e.key === "ArrowLeft" && e.shiftKey) player.previous();
  else if (e.key === "f" && player.current) toggleFavorite(player.current);
});

try {
  index = await loadIndex({ onText: (text) => searchWorker.postMessage({ type: "load", text }) });
  $("hvsc-version").textContent = index.version ? `HVSC #${index.version}` : "HVSC";
  render();
} catch (err) {
  searchError = err.message;
  dom.view.innerHTML = `<div class="empty"><p>${esc(err.message)}</p><p>Run <code>python3 tools/build_index.py</code> first.</p></div>`;
}

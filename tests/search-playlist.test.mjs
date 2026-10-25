import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PlaylistStore } from "../js/playlists.js";
import { sortResults } from "../js/result-sort.js";
import { describe, fieldHint, parseQuery, perSubtune } from "../js/num-query.js";

globalThis.localStorage = { getItem: () => null, setItem() {} };

const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const functions = [
  ["function renderSearch(", "// A row's tag labels"],
  ["function renderTagSearch(", "function renderAllTags("],
  ["function saveAsPlaylist(", "function renderGenerated("],
  ["function sortBar(", "const tuneCount"],
].map(([start, end]) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))).join("\n");

const item = (n, song = 1) => ({ path: `MUSICIANS/A/Tune_${n}.sid`, song, title: `Tune ${n}`, author: "Composer" });

function setup(results, query = "Tune") {
  const elements = new Map();
  const store = new PlaylistStore();
  store.playlists = [];
  const context = vm.createContext({
    store, sortResults, perSubtune, fieldHint, describeFilter: describe,
    searchQuery: query, searchExact: false, searchFilter: parseQuery(query), lastResults: results, lastIds: null, lastTotal: results?.length ?? 0,
    index: {}, searchReady: true, searchError: null, recentOpen: false,
    sorts: { search: { by: "name", desc: true } },
    dom: { view: {}, infinite: {} },
    $(id) {
      if (!elements.has(id)) elements.set(id, { addEventListener(_event, handler) { this.click = handler; } });
      return elements.get(id);
    },
    setChrome() {}, esc: (text) => text,
    sortDirection: () => "Z–A", sortCaption: () => "Name", listSort: () => ({ by: "name", desc: false }),
    actionSheet(_title, buttons) { context.buttons = buttons; return { dismiss() { context.dismissed = true; } }; },
    setTimeout(fn) { fn(); },
    toast(message) { context.error = message; },
    runSearch(query) { context.searched = query; },
    showList(_element, items) { context.shown = items; },
    showTagItems(_element, items) { context.shown = [...items.tunes, ...items.subtunes]; },
    go(hash) { context.destination = hash; },
    tuneCount: (n) => `${n} tunes`, tagChip: () => "",
    tags: { counts: () => new Map(), vocab: { byId: new Map([["ring", { id: "ring", label: "Ring mod" }]]) } },
  });
  vm.runInContext(functions, context);
  return { context, elements, store };
}

test("saving search results preserves all items, subtunes, and displayed order", () => {
  const results = Array.from({ length: 5002 }, (_, n) => item(n, n % 2 + 1));
  const { context, elements, store } = setup(results);
  context.renderSearch();
  assert.match(context.dom.view.innerHTML, /aria-label="Search actions"/);
  assert.ok(!context.dom.view.innerHTML.includes("Save as Playlist"), "secondary actions stay in More");
  elements.get("search-more").click();
  context.buttons.find((b) => b.text === "Save as Playlist").handler();
  const playlist = store.playlists[0];
  assert.equal(playlist.name, "Tune");
  assert.equal(playlist.items.length, 5002);
  assert.deepEqual(playlist.items, context.shown.map(({ path, song }) => ({ path, song })));
  assert.equal(context.destination, `#/playlist/${playlist.id}`);
  context.searchQuery = "Other";
  results.length = 0;
  assert.equal(playlist.items.length, 5002, "saved playlist is a snapshot");
});

test("tag search saves both whole tunes and individual subtunes", () => {
  const { context, elements, store } = setup(null, "#ring");
  const tunes = [item(1)], subtunes = [item(2, 3)];
  context.tagItems = () => ({ tunes, subtunes });
  context.renderSearch();
  elements.get("search-more").click();
  context.buttons.find((b) => b.text === "Save as Playlist").handler();
  assert.equal(store.playlists[0].name, "#ring");
  assert.deepEqual(store.playlists[0].items, [...tunes, ...subtunes].map(({ path, song }) => ({ path, song })));
});

test("loading, empty and invalid searches offer no save action", () => {
  for (const results of [null, []]) {
    const { context, elements, store } = setup(results);
    context.renderSearch();
    if (elements.has("search-more")) {
      elements.get("search-more").click();
      assert.ok(!context.buttons.some((b) => b.text === "Save as Playlist"));
    }
    assert.equal(store.playlists.length, 0);
  }
  const { context, elements } = setup([], "bpm>");
  context.renderSearch();
  assert.ok(!elements.has("search-more"));
});

test("tag searches without matching tunes offer no save action", () => {
  const { context, elements } = setup(null, "#ring");
  context.tagItems = () => ({ tunes: [], subtunes: [] });
  context.renderSearch();
  assert.ok(!elements.has("search-more"));
});

test("exact matching can be turned off after a search returns no matches", () => {
  const { context, elements } = setup([], "Teppo");
  context.searchExact = true;
  context.renderSearch();
  elements.get("search-more").click();
  const toggle = context.buttons.find((b) => b.text === "Exact matches").toggle;
  assert.equal(toggle.checked, true);
  toggle.onChange(false);
  assert.equal(context.searchExact, false);
  assert.equal(context.searched, "Teppo");
  assert.equal(context.dismissed, true, "close the menu so saving cannot use the old result set");
});

test("adding search results appends to the latest playlist and skips duplicates", () => {
  const { context, elements, store } = setup([item(1), item(2, 3)]);
  const playlist = store.create("Mix", [item(1)]);
  context.renderSearch();
  elements.get("search-more").click();
  context.buttons.find((b) => b.text === "Add to playlist…").handler();
  const choose = context.buttons.find((b) => b.text === "Mix").handler;
  store.add(playlist.id, item(4));
  let changes = 0;
  store.addEventListener("change", () => changes++);
  choose();
  assert.deepEqual(playlist.items, [item(1), item(4), item(2, 3)].map(({ path, song }) => ({ path, song })));
  assert.equal(changes, 1);
  assert.equal(context.destination, `#/playlist/${playlist.id}`);
});

test("a playlist deleted while the picker is open is rechecked", () => {
  const { context, store } = setup([item(1)]);
  const playlist = store.create("Mix");
  context.addSearchToPlaylist([item(1)]);
  const choose = context.buttons[0].handler;
  store.remove(playlist.id);
  choose();
  assert.equal(context.error, "Playlist no longer exists.");
  assert.equal(context.destination, undefined);
});

test("bulk additions honour duplicate settings, keep subtunes distinct and save once", () => {
  const { store } = setup([]);
  const playlist = store.create("Mix", [item(1)]);
  store.addItems(playlist.id, [item(1), item(1, 2), item(1, 2)]);
  assert.deepEqual(playlist.items.map((i) => i.song), [1, 2]);
  store.setAllowDuplicates(playlist.id, true);
  store.addItems(playlist.id, [item(1), item(1)]);
  assert.equal(playlist.items.length, 4);
  playlist.favorites = true;
  store.addItems(playlist.id, [item(1)]);
  assert.equal(playlist.items.length, 4);
  assert.doesNotThrow(() => store.addItems("deleted", [item(2)]));
});

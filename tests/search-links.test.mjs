import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseQuery } from "../js/num-query.js";

const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const functions = [
  ["function searchFor(", "// ---- recent searches"],
  ["function searchHash(", "// ---- helpers"],
  ["function currentRoute(", "function setChrome("],
  ["function render()", "// A scanned sync QR"],
].map(([start, end]) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))).join("\n");

function setup(hash = "#/home") {
  const messages = [];
  const replacements = [];
  const location = { hash };
  const context = vm.createContext({
    URLSearchParams, parseQuery, location,
    history: { replaceState(_state, _title, hash) { replacements.push(hash); location.hash = hash; } },
    searchQuery: "", searchExact: false, searchSeq: 0, lastResults: null, lastIds: null, searchFilter: null,
    index: {}, renderedRoute: null,
    dom: { searchbar: { value: "" }, content: {}, view: {} },
    soundSheet: { close() {}, root: {} }, romSheet: { root: {} }, syncSheet: null,
    searchWorker: { postMessage(message) { messages.push(message); } },
    renderSearch() {},
    applyAppearance() {},
    renderHome() { context.searchQuery = ""; context.dom.searchbar.value = ""; },
    renderBrowse() {},
  });
  vm.runInContext(functions, context);
  return { context, location, messages, replacements };
}

test("search links round-trip operators, tags, quotes, accents and URL punctuation", () => {
  const { context, location } = setup();
  for (const query of [
    'title=Fish release=Chips year=2038 composer="Rob Hubbard"',
    'bpm>=120 & bpm<130 | year=1988', '#ring', 'Hülsbeck', 'A+B / C? D# E% F=G',
  ]) {
    location.hash = context.searchHash(query);
    assert.equal(context.currentRoute().name, "search");
    assert.equal(context.currentRoute().arg, query);
  }
});

test("typing replaces the address; clearing returns Home", () => {
  const { context, location, replacements, messages } = setup();
  context.runSearch("  hubbard  ");
  assert.equal(location.hash, "#/search?q=hubbard");
  context.runSearch("hubbard bpm>120");
  assert.equal(context.currentRoute().arg, "hubbard bpm>120");
  assert.equal(replacements.length, 2);
  assert.equal(messages.at(-1).query, "hubbard");
  assert.equal(messages.at(-1).all, true, "request every match so a playlist is not truncated");
  context.runSearch("");
  assert.equal(location.hash, "#/home");
  assert.equal(context.searchQuery, "");
});

test("opening a shared filter link restores the search bar and parsed filters", () => {
  const { context, location } = setup();
  const query = 'title=Commando composer=Hubbard release=Elite year=1985';
  location.hash = context.searchHash(query);
  context.render();
  assert.equal(context.dom.searchbar.value, query);
  assert.equal(context.searchQuery, query);
  assert.equal(context.searchFilter.filter[0].length, 4);
  const sequence = context.searchSeq;
  context.render();
  assert.equal(context.searchSeq, sequence, "routine renders do not repeat searches");
});

test("navigation restores different searches and ignores queries on other routes", () => {
  const { context, location, messages } = setup();
  const first = context.searchHash("hubbard");
  const second = context.searchHash("galway");
  for (const hash of [first, second, first]) {
    location.hash = hash;
    context.render();
    assert.equal(context.dom.searchbar.value, context.currentRoute().arg);
    assert.equal(messages.at(-1).query, context.currentRoute().arg);
  }
  location.hash = "#/home";
  context.render();
  assert.equal(context.searchQuery, "");
  location.hash = first;
  context.render();
  assert.equal(context.searchQuery, "hubbard");
  location.hash = "#/browse/MUSICIANS%2FH";
  context.render();
  assert.equal(context.currentRoute().arg, "MUSICIANS/H");
  assert.equal(location.hash, "#/browse/MUSICIANS%2FH");
});

test("recent and composer searches produce shareable addresses", () => {
  const { context, location } = setup("#/composer/Rob%20Hubbard");
  context.searchFor("Rob Hubbard");
  assert.equal(context.currentRoute().arg, "Rob Hubbard");
  context.render();
  assert.equal(context.dom.searchbar.value, "Rob Hubbard");
  context.searchFor("#ring");
  assert.equal(context.currentRoute().arg, "#ring");
  assert.ok(location.hash.includes("%23ring"));
});

test("legacy search routes and empty shared queries remain usable", () => {
  const { context, location } = setup("#/search");
  context.render();
  assert.equal(context.currentRoute().name, "search");
  assert.equal(context.searchQuery, "");
  location.hash = "#/search?q=+++";
  context.render();
  assert.equal(location.hash, "#/home");
  assert.equal(context.searchQuery, "");
});

test("exact matching is shared and restored when navigating between searches", () => {
  const { context, location, messages } = setup();
  location.hash = "#/search?q=Teppo&exact=1";
  context.render();
  assert.equal(context.searchExact, true);
  assert.equal(messages.at(-1).exact, true);
  assert.equal(context.searchHash("Teppo"), "#/search?q=Teppo&exact=1");
  location.hash = "#/search?q=Teppo";
  context.render();
  assert.equal(context.searchExact, false);
  assert.equal(messages.at(-1).exact, false);
});

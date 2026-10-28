import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { HELP } from "../js/help.js";
import { matches, parseQuery } from "../js/num-query.js";

test("Privacy uses the Help layout and handles failed loading without changing a later page", async () => {
  const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  for (const connected of [true, false]) {
    const article = { isConnected: connected, innerHTML: "later page" };
    const view = { innerHTML: "", querySelector: () => article };
    let chrome;
    const context = vm.createContext({
      dom: { view, infinite: {} }, HELP, ABOUT: {},
      setChrome: (value) => { chrome = value; },
      fetch: async (url) => { assert.equal(url, "privacy.html"); return { ok: false }; },
    });
    vm.runInContext(source.slice(source.indexOf("async function renderHelp("), source.indexOf("function renderPlaylists(")), context);
    await context.renderHelp("privacy");
    assert.equal(chrome.title, "Privacy");
    assert.equal(chrome.back, "#/settings");
    assert.match(view.innerHTML, /article class="help-content"/);
    if (connected) assert.match(article.innerHTML, /Could not load Privacy/);
    else assert.equal(article.innerHTML, "later page");
  }
});

test("search help examples use supported filters", () => {
  const html = HELP.find((section) => section.id === "search").html;
  const decode = (text) => text.replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
  const examples = [...html.matchAll(/<code>(.*?)<\/code>/g)]
    .map((m) => decode(m[1])).filter((s) => /[a-z]+[><!=]/.test(s));
  assert.ok(examples.length >= 9);
  const values = { title: "Fish", release: "Chips", composer: "Rob Hubbard", bpm: 125, year: 1988, length: 301, subtunes: 2, subtune: 2, speed: 2, ring: 1, filter: 1 };
  for (const example of examples) {
    const query = parseQuery(example);
    assert.equal(query.error, null, example);
    assert.ok(query.filter, example);
    assert.equal(matches(query.filter, (field) => values[field] ?? null), !["hubbard bpm>140", "title=Commando composer=Hubbard release=Elite year=1985"].includes(example), example);
  }
});

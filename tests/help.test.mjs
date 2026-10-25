import { test } from "node:test";
import assert from "node:assert/strict";
import { HELP } from "../js/help.js";
import { matches, parseQuery } from "../js/num-query.js";

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
    assert.equal(matches(query.filter, (field) => values[field] ?? null), !["hubbard bpm>140", "title=Fish release=Chips year=2038"].includes(example), example);
  }
});

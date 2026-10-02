import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Notices, isDue, nextShowing, parseDuration, parseNotice, parseNotices, renderHtml, usedBy } from "../js/notices.js";

const DAY = 86_400_000;
const FROM = Date.parse("2026-10-01T00:00:00Z");
const raw = {
  id: "n",
  schedule: { from: "2026-10-01T00:00:00Z", until: "2026-11-01T00:00:00Z", times: 3, every: "7d" },
  title: "News",
  html: ["<p>Hello", "{icon:library} there</p>"],
};
const notice = parseNotice(raw);
const released = JSON.parse(readFileSync(new URL("../js/notices.json", import.meta.url)));

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = v) };
}

test("durations", () => {
  assert.equal(parseDuration("7d"), 7 * DAY);
  assert.equal(parseDuration("12h"), DAY / 2);
  assert.equal(parseDuration("2w"), 14 * DAY);
  for (const bad of ["7", "d", "7 days", "", null]) assert.throws(() => parseDuration(bad), String(bad));
});

test("a notice is checked as it's read", () => {
  assert.deepEqual(notice, { id: "n", from: FROM, until: Date.parse("2026-11-01T00:00:00Z"), times: 3, every: 7 * DAY, canHide: false, title: "News", html: "<p>Hello\n{icon:library} there</p>" });
  assert.equal(parseNotice({ ...raw, schedule: { ...raw.schedule, times: 1, every: undefined } }).every, 0);
  for (const schedule of [{ ...raw.schedule, from: "soon" }, { ...raw.schedule, until: raw.schedule.from }, { ...raw.schedule, times: 0 }, { ...raw.schedule, every: "0d" }]) {
    assert.throws(() => parseNotice({ ...raw, schedule }));
  }
  assert.throws(() => parseNotice({ ...raw, id: "" }));
});

test("a broken notice is left out, not the rest", (t) => {
  t.mock.method(console, "warn", () => {});
  assert.deepEqual(parseNotices([{ id: "broken" }, raw]).map((n) => n.id), ["n"]);
  assert.throws(() => parseNotices({}));
});

test("{icon:name} becomes an app icon", () => {
  assert.equal(renderHtml("a {icon:cloud-outline} b"), 'a <ion-icon name="cloud-outline" aria-hidden="true"></ion-icon> b');
  assert.equal(renderHtml("{icon:Bad Name}"), "{icon:Bad Name}");
});

test("{widget:name arg} becomes a placeholder for the app's widget", () => {
  assert.equal(renderHtml("{widget:sync https://a.example/?x=\"1\"}"), '<div class="notice-widget" data-widget="sync" data-arg="https://a.example/?x=&quot;1&quot;"></div>');
  assert.equal(renderHtml("{widget:sync}"), '<div class="notice-widget" data-widget="sync" data-arg=""></div>');
});

test("shown at from, then every interval, `times` times", () => {
  assert.equal(nextShowing(notice), FROM);
  assert.equal(nextShowing(notice, { used: 1 }), FROM + 7 * DAY);
  assert.equal(nextShowing(notice, { used: 2 }), FROM + 14 * DAY);
  assert.equal(nextShowing(notice, { used: 3 }), null);
});

test("nothing before from, nothing from until on", () => {
  assert.ok(!isDue(notice, undefined, FROM - 1));
  assert.ok(isDue(notice, undefined, FROM));
  const short = parseNotice({ ...raw, schedule: { ...raw.schedule, until: "2026-10-10T00:00:00Z" } });
  assert.equal(nextShowing(short, { used: 1 }), FROM + 7 * DAY);
  assert.equal(nextShowing(short, { used: 2 }), null);   // day 14 is past until
});

test("showings missed while away are shown once, the next at its usual moment", () => {
  assert.equal(usedBy(notice, FROM), 1);
  assert.equal(usedBy(notice, FROM + 15 * DAY), 3);   // away for two: shown once, all three used
  assert.equal(usedBy(notice, FROM + 8 * DAY), 2);
  assert.equal(nextShowing(notice, { used: 2 }), FROM + 14 * DAY);
  assert.equal(usedBy(notice, FROM + 99 * DAY), 3);
});

test("counts are kept per notice and survive a reload", () => {
  const storage = memoryStorage();
  let now = FROM + DAY;
  const notices = new Notices({ notices: [notice], storage, now: () => now });
  assert.equal(notices.due(), notice);
  notices.markShown(notice);
  assert.equal(notices.due(), null);
  assert.equal(notices.upcoming(), FROM + 7 * DAY);
  now = FROM + 7 * DAY;
  assert.equal(new Notices({ notices: [notice], storage, now: () => now }).due(), notice);
  assert.deepEqual(JSON.parse(storage.data["shallowsid.notices"]), { n: { used: 1 } });
});

test("Don't Show Again ends the remaining showings", () => {
  const notices = new Notices({ notices: [notice], storage: memoryStorage(), now: () => FROM });
  notices.markShown(notice);
  notices.hide("n");
  assert.deepEqual(notices.records.n, { used: 1, hidden: true });
  assert.equal(notices.upcoming(), null);
});

test("unreadable or blocked storage: counted for the visit, no throw", () => {
  const junk = new Notices({ notices: [notice], storage: memoryStorage({ "shallowsid.notices": "{oops" }), now: () => FROM });
  assert.equal(junk.due(), notice);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const notices = new Notices({ notices: [notice], storage: blocked, now: () => FROM });
  notices.markShown(notice);
  assert.equal(notices.due(), null);
});

test("notices.json: every notice is well formed, with unique ids", () => {
  const parsed = released.map(parseNotice);   // throws on a malformed one
  assert.equal(new Set(parsed.map((n) => n.id)).size, parsed.length);
  for (const n of released) assert.equal(typeof n.schedule.canHide, "boolean", n.id);
});

// What users see says nothing of the schedule.
const METADATA = [
  /\d{4}-\d{2}/,                                            // ISO dates
  /\b\d{1,2}[.:/]\d{1,2}\b/,                                 // 2.10., 12:00, 10/2
  /\b\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|times?|[smhdw])\b/i,
  /\b(until|expires?|every|daily|weekly|monthly|deadline|times? left)\b/i,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i,
];
const visibleText = (n) => `${n.title} ${n.html.replace(/<[^>]*>|\{(icon|widget):[^}]*\}/g, " ")}`;

test("notices.json: texts carry no timestamps, intervals or counts", () => {
  for (const n of released.map(parseNotice)) for (const pattern of METADATA) assert.doesNotMatch(visibleText(n), pattern, n.id);
});

test("the metadata check catches what it should", () => {
  for (const text of ["Shown until 1.12.", "Again in 7 days", "From 2026-10-02", "Every week", "3 times left", "Dec 1", "next in 7d"]) {
    assert.ok(METADATA.some((p) => p.test(text)), text);
  }
});

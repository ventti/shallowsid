// Notices: news shown in a sheet a set number of times, within a time window.
// The notices themselves are data, in notices.json:
//
//   { id, schedule: { from, until, times, every, canHide }, title, html }
//   * id        never changes once released
//   * from      first showing (ISO date); never shown at or after `until`
//   * times     showings at from, from + every, … from + (times - 1) × every
//   * every     time between showings: "30m", "12h", "7d", "2w"
//   * canHide   offer "Don't Show Again", which ends the remaining showings
//   * title, html  all that's shown, so they say nothing of the schedule (no
//               dates, counts or intervals). `html` is trusted markup, as one
//               string or a list of lines; {icon:name} puts in an app icon,
//               {widget:name arg} a live part the app provides (`widgets`),
//               e.g. {widget:sync https://example.org/} (see notice-widgets.js).
//
// A showing is due when the app opens after its moment, or comes up at that
// moment while the app is open. Showings missed while away are shown once on
// return, together: someone away for two intervals sees the notice once, and
// the next one at its usual moment. What was shown is kept in this browser's
// localStorage (not synced); without storage the count starts over every visit.

const STORAGE_KEY = "shallowsid.notices";
const NOTICES_URL = new URL("./notices.json", import.meta.url).href;
const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
const MAX_TIMER = UNITS.w;   // setTimeout overflows past ~24.8 days: wake up and look again

export function parseDuration(text) {
  const match = /^(\d+(?:\.\d+)?)\s*([smhdw])$/.exec(String(text ?? "").trim());
  if (!match) throw new Error(`not a duration: ${JSON.stringify(text)} (use e.g. "12h" or "7d")`);
  return Number(match[1]) * UNITS[match[2]];
}

// One notice from notices.json, checked and with its times in ms; throws
// on anything malformed.
export function parseNotice(raw) {
  const { id, schedule: s = {}, title, html } = raw ?? {};
  if (typeof id !== "string" || !id) throw new Error("a notice needs an id");
  const from = Date.parse(s.from), until = Date.parse(s.until);
  if (!(from < until)) throw new Error(`${id}: from and until must be dates, from first`);
  if (!Number.isInteger(s.times) || s.times < 1) throw new Error(`${id}: times must be 1 or more`);
  const every = s.times > 1 ? parseDuration(s.every) : 0;
  if (s.times > 1 && every <= 0) throw new Error(`${id}: every must be longer than zero`);
  if (typeof title !== "string" || !(typeof html === "string" || Array.isArray(html))) throw new Error(`${id}: needs a title and html`);
  return { id, from, until, times: s.times, every, canHide: s.canHide === true, title, html: [html].flat().join("\n") };
}

// Every well-formed notice; a broken one is left out (and logged), not the rest.
export function parseNotices(list) {
  if (!Array.isArray(list)) throw new Error("notices.json must be a list");
  return list.flatMap((raw) => {
    try {
      return [parseNotice(raw)];
    } catch (err) {
      console.warn("notices.json:", err.message);
      return [];
    }
  });
}

const escapeAttr = (text) => text.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]);

// {icon:name} as the app's icons, {widget:name arg} as placeholders the
// widgets fill in. Names are checked: the rest of html is trusted.
export const renderHtml = (html) => html
  .replace(/\{icon:([a-z0-9-]+)\}/g, '<ion-icon name="$1" aria-hidden="true"></ion-icon>')
  .replace(/\{widget:([a-z0-9-]+)(?:\s+([^}]*))?\}/g, (_, name, arg = "") => `<div class="notice-widget" data-widget="${name}" data-arg="${escapeAttr(arg.trim())}"></div>`);

// When `notice` is next shown (ms), given `record` ({ used, hidden } or
// undefined), or null when it won't be again.
export function nextShowing(notice, record = { used: 0 }) {
  if (record.hidden || record.used >= notice.times) return null;
  const at = notice.from + record.used * notice.every;
  return at < notice.until ? at : null;
}

export const isDue = (notice, record, now) => {
  const at = nextShowing(notice, record);
  return at !== null && at <= now;
};

// Showings used up once shown at `now`: every moment passed so far, so missed
// ones aren't shown again.
export const usedBy = (notice, now) =>
  notice.every ? Math.min(notice.times, Math.max(1, Math.floor((now - notice.from) / notice.every) + 1)) : notice.times;

export class Notices {
  // widgets: { name: (element, arg) => cleanup function or nothing }
  constructor({ notices = [], widgets = {}, storage = globalThis.localStorage, now = Date.now } = {}) {
    this.notices = notices;
    this.widgets = widgets;
    this.storage = storage;
    this.now = now;
    this.records = {};
    this.open = false;
    this.timer = null;
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY));
      if (saved && typeof saved === "object") this.records = saved;
    } catch {
      // unreadable or blocked: nothing shown yet
    }
  }

  // Fetched rather than imported, so a broken notices.json can't stop the app.
  async load(url = NOTICES_URL) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.notices = parseNotices(await response.json());
    } catch (err) {
      console.warn("notices:", err.message);
    }
  }

  // The first notice due now, or null.
  due() {
    const now = this.now();
    return this.notices.find((n) => isDue(n, this.records[n.id], now)) ?? null;
  }

  // The earliest upcoming showing (ms), or null.
  upcoming() {
    const times = this.notices.map((n) => nextShowing(n, this.records[n.id])).filter((t) => t !== null);
    return times.length ? Math.min(...times) : null;
  }

  markShown(notice) {
    this.update(notice.id, { used: usedBy(notice, this.now()) });
  }

  // "Don't Show Again": no more showings of this one.
  hide(id) {
    this.update(id, { hidden: true });
  }

  update(id, changes) {
    this.records = { ...this.records, [id]: { used: 0, ...this.records[id], ...changes } };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch {
      // storage blocked: counted for this visit only
    }
  }

  // Shows what's due now, one notice at a time, then waits for the next showing.
  start() {
    clearTimeout(this.timer);
    if (this.open) return;
    if (document.hidden) return document.addEventListener("visibilitychange", () => this.start(), { once: true });
    const notice = this.due();
    if (notice) {
      this.markShown(notice);
      this.open = true;
      return this.show(notice).then((hide) => {
        if (hide) this.hide(notice.id);
        this.open = false;
        this.start();
      });
    }
    const at = this.upcoming();
    if (at !== null) this.timer = setTimeout(() => this.start(), Math.min(Math.max(at - this.now(), 0), MAX_TIMER));
  }

  // Resolves when closed: true for "Don't Show Again". Also handy from the
  // console: shallowsid.notices.show(shallowsid.notices.notices[0]).
  show(notice) {
    const modal = document.createElement("ion-modal");
    modal.className = "notice-modal";
    // As iOS welcome sheets: a card over the page on phones (swipe down to
    // close), a large title, the choices stacked at the bottom.
    modal.presentingElement = document.getElementById("main-page") ?? undefined;
    // No ion-content, so the card can be as tall as its text (see app.css).
    modal.innerHTML = `
      <div class="ion-page">
        <div class="notice">
          <h1 class="notice-title"></h1>
          ${renderHtml(notice.html)}
        </div>
        <div class="notice-actions">
          <ion-button expand="block" data-close>Got It</ion-button>
          ${notice.canHide ? `<ion-button expand="block" fill="clear" data-hide>Don't Show Again</ion-button>` : ""}
        </div>
      </div>`;
    modal.querySelector(".notice-title").textContent = notice.title;
    modal.setAttribute("aria-label", notice.title);
    // A widget the app doesn't have is left out.
    const cleanups = [...modal.querySelectorAll("[data-widget]")].map((el) => {
      const widget = this.widgets[el.dataset.widget];
      if (!widget) return el.remove();
      return widget(el, el.dataset.arg);
    });
    let hide = false;
    modal.querySelector("[data-close]").addEventListener("click", () => modal.dismiss());
    modal.querySelector("[data-hide]")?.addEventListener("click", () => {
      hide = true;
      modal.dismiss();
    });
    document.querySelector("ion-app").appendChild(modal);
    return new Promise((resolve) => {
      modal.addEventListener("didDismiss", () => {
        for (const cleanup of cleanups) cleanup?.();
        setTimeout(() => modal.remove(), 0);   // next tick, as in ui.js
        resolve(hide);
      });
      modal.present();
    });
  }
}

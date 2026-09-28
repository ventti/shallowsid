// The "Tags" sheet, for curators: pick a tune's tags from the vocabulary, for
// the whole tune or just the subtune playing. Chips toggle; Done (or swiping
// the sheet away) saves, Cancel doesn't.

import { MAX_TAGS, WHOLE_TUNE } from "./tags-core.js";
import { esc, toast } from "./ui.js";

const SCOPE_KEY = "shallowsid.tagScope";

function ago(time) {
  if (!time) return "";
  const days = Math.floor((Date.now() - time) / 86_400_000);
  return days < 1 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : new Date(time).toLocaleDateString();
}

export class TagSheet {
  constructor(tags) {
    this.tags = tags;
    this.modal = document.getElementById("tag-modal");
    this.root = document.getElementById("tag-sheet");
    this.item = null;
    this.draft = null;         // {whole: Set, sub: Set}
    this.saved = null;         // the same, as loaded
    this.cancelled = false;
    this.filter = "";
    this.scope = loadScope();
    document.getElementById("tag-cancel").addEventListener("click", () => {
      this.cancelled = true;
      this.modal.dismiss();
    });
    document.getElementById("tag-done").addEventListener("click", () => this.modal.dismiss());
    this.modal.addEventListener("didDismiss", () => this.finish());
    this.root.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-toggle-tag]");
      if (chip && !chip.hasAttribute("disabled")) this.toggle(chip.dataset.toggleTag);
    });
    this.root.addEventListener("ionChange", (e) => {
      if (e.target.id === "tag-scope") {
        this.scope = e.detail.value;
        saveScope(this.scope);
        this.renderChips();
      }
    });
    this.root.addEventListener("ionInput", (e) => {
      if (e.target.id === "tag-filter") {
        this.filter = String(e.detail.value ?? "").trim().toLowerCase();
        this.renderChips();
      }
    });
  }

  async open(item) {
    if (!this.tags.canTag || !item) return;
    this.item = item;
    this.cancelled = false;
    this.filter = "";
    this.draft = null;
    this.render();
    await this.modal.present();
    try {
      await this.tags.refresh(item);   // someone else may have tagged it since the deploy
    } catch (err) {
      console.error("tags:", err);
    }
    if (this.tags.isAdmin) this.tags.invites().then((list) => (this.invites = list)).catch(() => {});
    if (this.item !== item) return;
    const { whole, sub } = this.tags.tagsFor(item);
    this.saved = { whole: new Set(whole), sub: new Set(sub) };
    this.draft = { whole: new Set(whole), sub: new Set(sub) };
    this.render();
  }

  get subtunes() {
    return this.item?.songs > 1;
  }

  get activeScope() {
    return this.subtunes && this.scope === "sub" ? "sub" : "whole";
  }

  toggle(id) {
    const set = this.draft[this.activeScope];
    if (set.has(id)) set.delete(id);
    else if (set.size >= MAX_TAGS) return toast(`At most ${MAX_TAGS} tags each`, { color: "warning" });
    else set.add(id);
    this.renderChips();
  }

  render() {
    const item = this.item;
    const song = item.songs > 1 ? ` · subtune ${item.song} of ${item.songs}` : "";
    this.root.innerHTML = `
      <div class="tag-sheet-head">
        <h2>${esc(item.title)}</h2>
        <p>${esc(item.author)}${esc(song)}</p>
      </div>
      ${this.subtunes ? `
        <ion-segment id="tag-scope" value="${this.activeScope}" class="tag-scope">
          <ion-segment-button value="whole"><ion-label>Whole Tune</ion-label></ion-segment-button>
          <ion-segment-button value="sub"><ion-label>Subtune ${item.song}</ion-label></ion-segment-button>
        </ion-segment>` : ""}
      <ion-searchbar id="tag-filter" placeholder="Filter tags" debounce="0" autocapitalize="off" spellcheck="false"></ion-searchbar>
      <div id="tag-chips">${this.draft ? "" : `<div class="empty"><ion-spinner></ion-spinner></div>`}</div>
      <p class="sound-note" id="tag-audit"></p>
      <p class="sound-note">Everyone else sees changes after the next site update, within a day.</p>`;
    if (this.draft) this.renderChips();
  }

  renderChips() {
    const box = this.root.querySelector("#tag-chips");
    if (!box || !this.draft) return;
    const scope = this.activeScope;
    const own = this.draft[scope];
    const inherited = scope === "sub" ? this.draft.whole : new Set();
    const match = (t) => !this.filter || t.label.toLowerCase().includes(this.filter) || t.id.includes(this.filter);
    const groups = this.tags.vocab.groups.map((g) => [g, g.tags.filter(match)]).filter(([, list]) => list.length);
    box.innerHTML = groups.length ? groups.map(([g, list]) => `
      <h3 class="sound-section">${esc(g.name)}</h3>
      <div class="chips tag-chips">${list.map((t) => {
        const fromWhole = inherited.has(t.id);
        const on = fromWhole || own.has(t.id);
        return `<ion-chip data-toggle-tag="${esc(t.id)}" class="tag-toggle${on ? " is-on" : ""}${fromWhole ? " is-inherited" : ""}"
            ${fromWhole ? "disabled" : ""} role="checkbox" aria-checked="${on}" ${t.description || fromWhole ? `title="${esc(fromWhole ? "From the whole tune" : t.description)}"` : ""}>
          ${on ? `<ion-icon name="checkmark"></ion-icon>` : ""}<ion-label>${esc(t.label)}</ion-label>
        </ion-chip>`;
      }).join("")}</div>`).join("")
      : `<div class="empty"><p>No tag matches “${esc(this.filter)}”.</p></div>`;
    const note = scope === "sub" && inherited.size ? "Tags from the whole tune apply to every subtune; change them under Whole Tune. " : "";
    this.root.querySelector("#tag-audit").textContent = note + this.auditText(scope);
  }

  // Who changed these last: shown to that curator and to admins only.
  auditText(scope) {
    const edited = this.tags.tagsFor(this.item).edited?.[scope];
    if (!edited?.by) return "";
    const who = this.tags.whoIs(edited.by, this.invites ?? []);
    if (who === "you") return `Last edited by you, ${ago(edited.at)}.`;
    if (!this.tags.isAdmin) return "";
    return `Last edited by ${who ?? "a curator"}, ${ago(edited.at)}.`;
  }

  changes() {
    if (!this.draft) return [];
    const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    const out = [];
    if (!same(this.draft.whole, this.saved.whole)) out.push({ song: WHOLE_TUNE, tags: [...this.draft.whole] });
    // A subtune keeps only what the whole tune doesn't already say.
    const sub = new Set([...this.draft.sub].filter((id) => !this.draft.whole.has(id)));
    if (this.subtunes && !same(sub, this.saved.sub)) out.push({ song: this.item.song, tags: [...sub] });
    return out;
  }

  async finish() {
    const item = this.item, changes = this.cancelled ? [] : this.changes();
    this.item = null;
    if (!changes.length) return;
    try {
      await this.tags.save(item.path, changes);
      toast("Tags saved", { duration: 1200 });
    } catch (err) {
      toast(`Couldn't save tags: ${err.message}`, { color: "danger" });
    }
  }
}

function loadScope() {
  try {
    return localStorage.getItem(SCOPE_KEY) === "sub" ? "sub" : "whole";
  } catch {
    return "whole";
  }
}

function saveScope(scope) {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    // storage blocked: the choice lasts for this visit
  }
}

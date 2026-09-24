// The "Sound" sheet: pick a chip preset, adjust reSIDfp's knobs, and save,
// export or import your own variants. Laid out like iOS Settings.

import { safeFileName } from "./playlist-format.js";
import { BUILTIN_PRESETS } from "./sound-profile.js";
import { actionSheet, confirmDialog, esc, prompt, saveFile, toast } from "./ui.js";

const RANGES = [
  { key: "filter6581Curve", label: "6581 filter curve", chip: "6581" },
  { key: "filter6581Range", label: "6581 filter range", chip: "6581" },
  { key: "filter8580Curve", label: "8580 filter curve", chip: "8580" },
];

const segment = (key, value, options) => `
  <ion-segment data-setting="${key}" value="${esc(value)}">
    ${options.map(([v, text]) => `<ion-segment-button value="${esc(v)}"><ion-label>${esc(text)}</ion-label></ion-segment-button>`).join("")}
  </ion-segment>`;

const PREVIEW_INTERVAL_MS = 80;   // live slider updates while dragging

// Events: "adjusting" {detail: bool} when the sheet opens/closes,
//         "preview" {detail: partial settings} while a slider is dragged.
export class SoundSheet extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.lastPreview = 0;
    this.modal = document.getElementById("sound-modal");
    this.root = document.getElementById("sound-sheet");
    this.importInput = document.getElementById("sound-import-input");
    this.revertButton = document.getElementById("sound-revert");
    this.revertButton.addEventListener("click", () => this.settings.revert());
    document.getElementById("sound-done").addEventListener("click", () => this.modal.dismiss());
    this.modal.addEventListener("willPresent", () => {
      this.render();
      this.dispatchEvent(new CustomEvent("adjusting", { detail: true }));
    });
    this.modal.addEventListener("didDismiss", () => this.dispatchEvent(new CustomEvent("adjusting", { detail: false })));
    settings.addEventListener("change", () => this.render());
    this.bind();
  }

  open() {
    this.modal.present();
  }

  presetRow(p) {
    const active = p.id === this.settings.activeId;
    const menu = p.builtin ? "" : `<ion-button slot="end" fill="clear" data-preset-menu="${p.id}" aria-label="More"><ion-icon slot="icon-only" name="ellipsis-horizontal"></ion-icon></ion-button>`;
    return `<ion-item button detail="false" data-preset="${p.id}">
      <ion-label>
        <h3>${esc(p.name)}${active && this.settings.isEdited ? ` <span class="edited-mark">Edited</span>` : ""}</h3>
        ${p.description ? `<p>${esc(p.description)}</p>` : ""}
      </ion-label>
      ${active ? `<ion-icon slot="end" name="checkmark" color="primary" aria-label="Selected"></ion-icon>` : ""}
      ${menu}
    </ion-item>`;
  }

  render() {
    this.revertButton.hidden = !this.settings.isEdited;
    const s = this.settings.current;
    // Gray out the other chip's knobs when one chip is forced; with Auto both may apply.
    const off = (chip) => (s.chip !== "auto" && s.chip !== chip ? " disabled" : "");
    const mine = this.settings.presets;
    this.root.innerHTML = `
      <h3 class="sound-section">Measured chips</h3>
      <ion-list inset>
        ${BUILTIN_PRESETS.map((p) => this.presetRow(p)).join("")}
      </ion-list>
      <h3 class="sound-section">My presets</h3>
      <ion-list inset>
        ${mine.map((p) => this.presetRow(p)).join("")}
        <ion-item button detail="false" id="sound-save-new" lines="none">
          <ion-icon slot="start" name="add-circle-outline" color="primary"></ion-icon>
          <ion-label color="primary">Save as Preset…</ion-label>
        </ion-item>
      </ion-list>

      <h3 class="sound-section">Adjust</h3>
      <ion-list inset>
        <ion-item><ion-label>Chip</ion-label>${segment("chip", s.chip, [["auto", "Auto"], ["6581", "6581"], ["8580", "8580"]])}</ion-item>
        <ion-item><ion-label>Machine</ion-label>${segment("machine", s.machine, [["auto", "Auto"], ["PAL", "PAL"], ["NTSC", "NTSC"]])}</ion-item>
        ${RANGES.map(({ key, label, chip }) => `
          <ion-item>
            <ion-range data-setting="${key}" min="0" max="1" step="0.01" value="${s[key]}" aria-label="${label}"${off(chip)}>
              <div slot="label">${label} <span class="range-value" data-value-for="${key}">${s[key].toFixed(2)}</span></div>
            </ion-range>
          </ion-item>`).join("")}
        <ion-item><ion-toggle data-setting="old6581Caps" ${s.old6581Caps ? "checked" : ""}${off("6581")}>Old 6581 capacitors</ion-toggle></ion-item>
        <ion-item><ion-label>Combined waveforms</ion-label>${segment("combinedWaveforms", s.combinedWaveforms, [["WEAK", "Weak"], ["AVERAGE", "Avg"], ["STRONG", "Strong"]])}</ion-item>
        <ion-item lines="none"><ion-toggle data-setting="digiBoost" ${s.digiBoost ? "checked" : ""}${off("8580")}>8580 digi boost</ion-toggle></ion-item>
      </ion-list>
      <p class="sound-note">Changes play at once. Editing a measured chip makes an edited copy; your own presets save automatically.</p>

      <h3 class="sound-section">Playback</h3>
      <ion-list inset>
        <ion-item lines="none"><ion-toggle id="sound-prerender" ${this.settings.prerender ? "checked" : ""}>Pre-render tunes</ion-toggle></ion-item>
      </ion-list>
      <p class="sound-note">Renders the whole tune ahead for instant seeking and scrubbing. Paused while this sheet is open. Turn off to save memory and battery.</p>

      <ion-list inset>
        ${mine.length ? `<ion-item button detail="false" id="sound-export">
          <ion-icon slot="start" name="share-outline" color="primary"></ion-icon><ion-label>Export my presets…</ion-label>
        </ion-item>` : ""}
        <ion-item button detail="false" id="sound-import" lines="none">
          <ion-icon slot="start" name="cloud-upload-outline" color="primary"></ion-icon><ion-label>Import presets…</ion-label>
        </ion-item>
      </ion-list>`;
  }

  bind() {
    const root = this.root;
    root.addEventListener("click", (e) => {
      const menu = e.target.closest("[data-preset-menu]");
      if (menu) {
        e.stopPropagation();
        return this.presetMenu(menu.dataset.presetMenu);
      }
      const row = e.target.closest("[data-preset]");
      if (row) return this.settings.select(row.dataset.preset);
      if (e.target.closest("#sound-save-new")) return this.saveAsNew();
      if (e.target.closest("#sound-export")) return this.exportPresets(this.settings.presets.map((p) => p.id));
      if (e.target.closest("#sound-import")) return this.importInput.click();
    });
    // Segments, toggles and sliders (on release) change the sound.
    root.addEventListener("ionChange", (e) => {
      if (e.target.id === "sound-prerender") return this.settings.setPrerender(e.detail.checked);
      const key = e.target.dataset?.setting;
      if (!key) return;
      const value = e.target.tagName === "ION-TOGGLE" ? e.detail.checked : e.detail.value;
      this.settings.update({ [key]: typeof value === "number" ? Math.round(value * 100) / 100 : value });
    });
    // While dragging: update the value label and let the sound follow (not saved until release).
    root.addEventListener("ionInput", (e) => {
      const key = e.target.dataset?.setting;
      const label = key && root.querySelector(`[data-value-for="${key}"]`);
      if (!label) return;
      const value = Math.round(Number(e.detail.value) * 100) / 100;
      label.textContent = value.toFixed(2);
      const now = performance.now();
      if (now - this.lastPreview < PREVIEW_INTERVAL_MS) return;
      this.lastPreview = now;
      this.dispatchEvent(new CustomEvent("preview", { detail: { [key]: value } }));
    });
    this.importInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const added = this.settings.importText(await file.text(), file.name.replace(/\.json$/i, "").replace(/^ShallowSID - (Sound - )?/, ""));
        toast(added.length === 1 ? `Imported “${added[0].name}”` : `Imported ${added.length} presets`);
      } catch (err) {
        toast(`Couldn't import: ${err.message}`, { color: "danger" });
      }
    });
  }

  async saveAsNew() {
    const base = this.settings.preset.name;
    const name = await prompt("Save as Preset", { value: this.settings.isEdited ? `${base} (edited)` : `${base} copy`, confirm: "Save" });
    if (name !== null) toast(`Saved “${this.settings.saveAsNew(name).name}”`);
  }

  presetMenu(id) {
    const p = this.settings.find(id);
    if (!p) return;
    actionSheet(p.name, [
      { text: "Export…", icon: "share-outline", handler: () => this.exportPresets([id]) },
      { text: "Rename", icon: "create-outline", handler: async () => {
        const name = await prompt("Rename preset", { value: p.name });
        if (name !== null) this.settings.rename(id, name);
      } },
      { text: "Delete", role: "destructive", icon: "trash-outline", handler: async () => {
        if (await confirmDialog("Delete preset?", `“${esc(p.name)}” will be removed from this browser.`)) this.settings.remove(id);
      } },
    ]);
  }

  async exportPresets(ids) {
    if (!ids.length) return;
    const single = ids.length === 1 ? this.settings.find(ids[0]) : null;
    const fileName = safeFileName(`Sound - ${single ? single.name : "My presets"}`, ".json");
    const outcome = await saveFile(fileName, this.settings.exportText(ids), "application/json", {
      title: single?.name ?? "ShallowSID sound presets", description: "ShallowSID sound preset", extension: ".json",
    });
    if (outcome === "saved" || outcome === "downloaded") toast(`Saved “${fileName}”`);
  }
}

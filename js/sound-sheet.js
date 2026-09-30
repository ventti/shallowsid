// The "Sound" sheet: pick the chip and machine, a 6581 and an 8580 preset,
// adjust reSIDfp's knobs, and save, export or import your own variants. Laid
// out like iOS Settings.

import { safeFileName } from "./playlist-format.js";
import { PRESET_CHIPS } from "./sound-profile.js";
import { actionSheet, confirmDialog, esc, prompt, saveFile, toast } from "./ui.js";

const RANGES = {
  6581: [{ key: "filter6581Curve", label: "Filter curve" }, { key: "filter6581Range", label: "Filter range" }],
  8580: [{ key: "filter8580Curve", label: "Filter curve" }],
};
const TOGGLES = {
  6581: [{ key: "old6581Caps", label: "Old capacitors" }],
  8580: [{ key: "digiBoost", label: "Digi boost" }],
};

// `chip` marks a per-chip knob; without it the setting is global.
const segment = (key, value, options, chip = "") => `
  <ion-segment data-setting="${key}"${chip ? ` data-chip="${chip}"` : ""} value="${esc(value)}">
    ${options.map(([v, text]) => `<ion-segment-button value="${esc(v)}"><ion-label>${esc(text)}</ion-label></ion-segment-button>`).join("")}
  </ion-segment>`;

const PREVIEW_INTERVAL_MS = 80;   // live slider updates while dragging

// Events: "adjusting" {detail: bool} when the sheet opens/closes,
//         "preview" {detail: {chip, knobs}} while a slider is dragged.
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
    const active = p.id === this.settings.selected[p.chip];
    const menu = p.builtin ? "" : `<ion-button slot="end" fill="clear" data-preset-menu="${p.id}" aria-label="More"><ion-icon slot="icon-only" name="ellipsis-horizontal"></ion-icon></ion-button>`;
    return `<ion-item button detail="false" data-preset="${p.id}">
      <ion-label>
        <h3>${esc(p.name)}${active && this.settings.isEdited(p.chip) ? ` <span class="edited-mark">Edited</span>` : ""}</h3>
      </ion-label>
      ${active ? `<ion-icon slot="end" name="checkmark" color="primary" aria-label="Selected"></ion-icon>` : ""}
      ${menu}
    </ion-item>`;
  }

  // One chip's presets and knobs. Grayed out while the other chip is forced.
  chipSection(chip) {
    const { builtin, mine } = this.settings.presetsFor(chip);
    const k = this.settings.knobs(chip);
    const off = this.settings.chip !== "auto" && this.settings.chip !== chip ? " disabled" : "";
    return `
      <h3 class="sound-section">${chip} presets</h3>
      <ion-list inset>
        ${[...builtin, ...mine].map((p) => this.presetRow(p)).join("")}
        <ion-item button detail="false" data-save-new="${chip}" lines="none">
          <ion-icon slot="start" name="add-circle-outline" color="primary"></ion-icon>
          <ion-label color="primary">Save as ${chip} Preset…</ion-label>
        </ion-item>
      </ion-list>
      <ion-list inset>
        ${RANGES[chip].map(({ key, label }) => `
          <ion-item>
            <ion-range data-setting="${key}" data-chip="${chip}" min="0" max="1" step="0.01" value="${k[key]}" aria-label="${chip} ${label}"${off}>
              <div slot="label">${label} <span class="range-value" data-value-for="${key}">${k[key].toFixed(2)}</span></div>
            </ion-range>
          </ion-item>`).join("")}
        ${TOGGLES[chip].map(({ key, label }) => `
          <ion-item><ion-toggle data-setting="${key}" data-chip="${chip}" ${k[key] ? "checked" : ""}${off}>${label}</ion-toggle></ion-item>`).join("")}
        <ion-item lines="none"><ion-label>Combined waveforms</ion-label>${segment("combinedWaveforms", k.combinedWaveforms, [["WEAK", "Weak"], ["AVERAGE", "Avg"], ["STRONG", "Strong"]], chip)}</ion-item>
      </ion-list>`;
  }

  render() {
    this.revertButton.hidden = !this.settings.anyEdited;
    const mine = this.settings.presets;
    this.root.innerHTML = `
      <h3 class="sound-section">Emulation</h3>
      <ion-list inset>
        <ion-item><ion-label>Chip</ion-label>${segment("chip", this.settings.chip, [["auto", "Auto"], ["6581", "6581"], ["8580", "8580"]])}</ion-item>
        <ion-item lines="none"><ion-label>Machine</ion-label>${segment("machine", this.settings.machine, [["auto", "Auto"], ["PAL", "PAL"], ["NTSC", "NTSC"]])}</ion-item>
      </ion-list>
      <p class="sound-note">Auto plays each tune on the chip and machine it was written for, using the preset selected for that chip.</p>

      ${PRESET_CHIPS.map((chip) => this.chipSection(chip)).join("")}

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
      const saveNew = e.target.closest("[data-save-new]");
      if (saveNew) return this.saveAsNew(saveNew.dataset.saveNew);
      if (e.target.closest("#sound-export")) return this.exportPresets(this.settings.presets.map((p) => p.id));
      if (e.target.closest("#sound-import")) return this.importInput.click();
    });
    // Segments, toggles and sliders (on release) change the sound.
    root.addEventListener("ionChange", (e) => {
      if (e.target.id === "sound-prerender") return this.settings.setPrerender(e.detail.checked);
      const { setting: key, chip } = e.target.dataset ?? {};
      if (!key) return;
      const value = e.target.tagName === "ION-TOGGLE" ? e.detail.checked : e.detail.value;
      const partial = { [key]: typeof value === "number" ? Math.round(value * 100) / 100 : value };
      if (chip) this.settings.update(chip, partial);
      else this.settings.setGlobal(partial);
    });
    // While dragging: update the value label and let the sound follow (not saved until release).
    root.addEventListener("ionInput", (e) => {
      const { setting: key, chip } = e.target.dataset ?? {};
      const label = key && e.target.querySelector(`[data-value-for="${key}"]`);
      if (!label) return;
      const value = Math.round(Number(e.detail.value) * 100) / 100;
      label.textContent = value.toFixed(2);
      const now = performance.now();
      if (now - this.lastPreview < PREVIEW_INTERVAL_MS) return;
      this.lastPreview = now;
      this.dispatchEvent(new CustomEvent("preview", { detail: { chip, knobs: { [key]: value } } }));
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

  async saveAsNew(chip) {
    const base = this.settings.preset(chip).name;
    const name = await prompt(`Save as ${chip} Preset`, { value: this.settings.isEdited(chip) ? `${base} (edited)` : `${base} copy`, confirm: "Save" });
    if (name !== null) toast(`Saved “${this.settings.saveAsNew(chip, name).name}”`);
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

import { ROM_TYPES, fetchRom } from "./roms.js";
import { esc, prompt } from "./ui.js";

export class RomSheet {
  constructor(store, onChange) {
    this.store = store;
    this.onChange = onChange;
    this.root = document.getElementById("rom-sheet");
    this.entries = {};
    this.busy = false;
    this.root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-rom-action]");
      if (!button || this.busy) return;
      const { romAction: action, type } = button.dataset;
      if (action === "file") {
        this.type = type;
        this.root.querySelector("input").click();
      } else if (action === "remove") this.run(() => this.store.remove(type));
      else this.fromUrl(type);
    });
    this.root.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const type = this.type;
      this.run(async () => {
        if (file.size !== ROM_TYPES[type].size) throw new Error(`${ROM_TYPES[type].label} must be exactly ${ROM_TYPES[type].size.toLocaleString("en-US")} bytes.`);
        await this.store.save(type, new Uint8Array(await file.arrayBuffer()), file.name);
      });
    });
  }

  async open() {
    this.root.hidden = false;
    await this.run();
  }

  async fromUrl(type) {
    const address = await prompt(`${ROM_TYPES[type].label} URL`, { placeholder: "https://", confirm: "Load" });
    if (address === null) return;
    await this.run(async () => {
      const { bytes, name } = await fetchRom(type, address.trim());
      await this.store.save(type, bytes, name);
    });
  }

  async run(action) {
    this.busy = true;
    this.render();
    let error = "";
    try {
      if (action) await action();
      this.entries = await this.store.load();
      if (action) this.onChange(this.entries);
    } catch (err) {
      error = err.message;
    } finally {
      this.busy = false;
      this.render(error);
    }
  }

  render(error = "") {
    this.root.innerHTML = `<p class="sound-note">Saved in this browser only. BASIC tunes need BASIC and KERNAL ROMs. Changing ROMs restarts the current tune.</p>
      <ion-list inset>${Object.entries(ROM_TYPES).map(([type, spec]) => `<ion-item>
        <ion-label><h2>${spec.label}</h2><p>${esc(this.entries[type]?.name || "Not added")} · ${spec.size / 1024} KB</p>
          <ion-button fill="clear" size="small" data-rom-action="file" data-type="${type}" ${this.busy ? "disabled" : ""}>Choose file</ion-button>
          <ion-button fill="clear" size="small" data-rom-action="url" data-type="${type}" ${this.busy ? "disabled" : ""}>Load from URL</ion-button>
          ${this.entries[type] ? `<ion-button fill="clear" size="small" color="danger" data-rom-action="remove" data-type="${type}" ${this.busy ? "disabled" : ""}>Remove</ion-button>` : ""}
        </ion-label></ion-item>`).join("")}</ion-list>
      ${error ? `<p class="sound-note" role="alert">${esc(error)}</p>` : ""}
      <input type="file" hidden>`;
  }
}

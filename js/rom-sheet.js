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
    const off = this.busy ? " disabled" : "";
    this.root.innerHTML = `${Object.entries(ROM_TYPES).map(([type, spec]) => `
      <h3 class="sound-section">${spec.label}</h3>
      <ion-list inset>
        <ion-item lines="none">
          <ion-label><h3>${esc(this.entries[type]?.name || "Not added")}</h3><p>${spec.size / 1024} KB</p></ion-label>
          <ion-button slot="end" fill="clear" data-rom-action="file" data-type="${type}" aria-label="Browse for ${spec.label}"${off}><ion-icon slot="icon-only" name="folder-open-outline"></ion-icon></ion-button>
          <ion-button slot="end" fill="clear" data-rom-action="url" data-type="${type}" aria-label="${spec.label} from URL"${off}><ion-icon slot="icon-only" name="link-outline"></ion-icon></ion-button>
          ${this.entries[type] ? `<ion-button slot="end" fill="clear" color="danger" data-rom-action="remove" data-type="${type}" aria-label="Remove ${spec.label}"${off}><ion-icon slot="icon-only" name="trash-outline"></ion-icon></ion-button>` : ""}
        </ion-item>
      </ion-list>`).join("")}
      ${error ? `<p class="sound-note" role="alert">${esc(error)}</p>` : ""}
      <p class="sound-note">ShallowSID does not supply ROMs and does not encourage the use of copyrighted material. ShallowSID takes no responsibility for material added by the user. ROMs are stored in this browser only. Provide only ROMs you have the right to use.</p>
      <input type="file" hidden>`;
  }
}

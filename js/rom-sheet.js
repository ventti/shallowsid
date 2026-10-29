import { ROM_TYPES, fetchRom } from "./roms.js";
import { actionSheet, esc, prompt } from "./ui.js";

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
      if (action === "add") {
        actionSheet(`Add ${ROM_TYPES[type].label}`, [
          { text: "Choose File", icon: "folder-open-outline", handler: () => this.fromFile(type) },
          { text: "Load from URL", icon: "link-outline", handler: () => this.fromUrl(type) },
        ]);
      } else if (action === "file") this.fromFile(type);
      else if (action === "remove") this.run(() => this.store.remove(type));
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

  fromFile(type) {
    this.type = type;
    this.root.querySelector("input").click();
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
        ${this.entries[type] ? `
        <ion-item lines="none">
          <ion-label><h3>${esc(this.entries[type].name)}</h3></ion-label>
          <ion-button slot="end" fill="clear" data-rom-action="file" data-type="${type}" aria-label="Browse for ${spec.label}"${off}><ion-icon slot="icon-only" name="folder-open-outline"></ion-icon></ion-button>
          <ion-button slot="end" fill="clear" data-rom-action="url" data-type="${type}" aria-label="${spec.label} from URL"${off}><ion-icon slot="icon-only" name="link-outline"></ion-icon></ion-button>
          <ion-button slot="end" fill="clear" color="danger" data-rom-action="remove" data-type="${type}" aria-label="Remove ${spec.label}"${off}><ion-icon slot="icon-only" name="trash-outline"></ion-icon></ion-button>
        </ion-item>` : `
        <ion-item button detail="false" lines="none" data-rom-action="add" data-type="${type}" aria-label="Add ${spec.label}"${off}>
          <ion-icon slot="start" name="add-circle-outline" color="primary" aria-hidden="true"></ion-icon>
          <ion-label color="primary">Add ROM</ion-label>
        </ion-item>`}
      </ion-list>`).join("")}
      ${error ? `<p class="sound-note" role="alert">${esc(error)}</p>` : ""}
      <p class="sound-note">ShallowSID supplies no ROMs. You are responsible for using only ROMs you have the right to use. ROMs stay in this browser.</p>
      <input type="file" hidden>`;
  }
}

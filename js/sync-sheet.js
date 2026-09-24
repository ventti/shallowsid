// The "Sync" sheet: turn end-to-end encrypted sync on/off, show or enter the
// sync key, delete the synced copy. Laid out like iOS Settings.

import { confirmDialog, esc, prompt, toast } from "./ui.js";

const PRIVACY_URL = new URL("../privacy.html", import.meta.url).href;

function ago(time) {
  if (!time) return "";
  const s = Math.round((Date.now() - time) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : new Date(time).toLocaleString();
}

export class SyncSheet {
  constructor(sync) {
    this.sync = sync;
    this.modal = document.getElementById("sync-modal");
    this.root = document.getElementById("sync-sheet");
    document.getElementById("sync-done").addEventListener("click", () => this.modal.dismiss());
    this.modal.addEventListener("willPresent", () => this.render());
    sync.addEventListener("status", () => this.render());
    this.root.addEventListener("click", (e) => this.onClick(e));
  }

  open() {
    this.modal.present();
  }

  statusText() {
    const s = this.sync;
    if (s.status === "syncing") return "Syncing…";
    if (s.status === "error") return `Couldn't sync: ${s.error}`;
    if (s.lastSynced) return `Synced ${ago(s.lastSynced)}`;
    return "Waiting to sync";
  }

  render() {
    const s = this.sync;
    const intro = `<p class="sound-note">Keeps your playlists, favorites and sound presets the same on all your devices.
      Everything is encrypted on this device with a sync key only your devices know. There are no accounts,
      and the server stores nothing it can read. <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy</a></p>`;
    if (!s.enabled) {
      this.root.innerHTML = `
        <h3 class="sound-section">Sync</h3>
        <ion-list inset>
          <ion-item button detail="false" id="sync-on">
            <ion-icon slot="start" name="cloud-upload-outline" color="primary"></ion-icon><ion-label color="primary">Turn On Sync</ion-label>
          </ion-item>
          <ion-item button detail="false" id="sync-join" lines="none">
            <ion-icon slot="start" name="key-outline" color="primary"></ion-icon><ion-label color="primary">Use a Key from Another Device…</ion-label>
          </ion-item>
        </ion-list>
        ${intro}`;
      return;
    }
    this.root.innerHTML = `
      <h3 class="sound-section">Sync</h3>
      <ion-list inset>
        <ion-item>
          <ion-icon slot="start" name="${s.status === "error" ? "alert-circle-outline" : "cloud-done-outline"}" color="${s.status === "error" ? "danger" : "primary"}"></ion-icon>
          <ion-label class="ion-text-wrap">${esc(this.statusText())}</ion-label>
          ${s.status === "syncing" ? `<ion-spinner slot="end" name="crescent"></ion-spinner>` : ""}
        </ion-item>
        <ion-item button detail="false" id="sync-now" lines="none">
          <ion-icon slot="start" name="sync-outline" color="primary"></ion-icon><ion-label color="primary">Sync Now</ion-label>
        </ion-item>
      </ion-list>

      <h3 class="sound-section">Sync key</h3>
      <ion-list inset>
        <ion-item lines="none"><ion-label class="sync-key">${esc(s.key)}</ion-label></ion-item>
        <ion-item button detail="false" id="sync-copy" lines="none">
          <ion-icon slot="start" name="copy-outline" color="primary"></ion-icon><ion-label color="primary">Copy Key</ion-label>
        </ion-item>
      </ion-list>
      <p class="sound-note">Enter this key on your other devices with <strong>Use a Key from Another Device</strong>.
        Keep it somewhere safe: without it the synced copy can't be recovered, not even by us.</p>

      <ion-list inset>
        <ion-item button detail="false" id="sync-off">
          <ion-label color="danger">Turn Off on This Device</ion-label>
        </ion-item>
        <ion-item button detail="false" id="sync-delete" lines="none">
          <ion-label color="danger">Delete Synced Data…</ion-label>
        </ion-item>
      </ion-list>
      ${intro}`;
  }

  async onClick(e) {
    const id = e.target.closest("ion-item[id]")?.id;
    const s = this.sync;
    try {
      switch (id) {
        case "sync-on":
          await s.turnOn();
          break;
        case "sync-join": {
          const key = await prompt("Use a sync key", { placeholder: "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX", confirm: "Use" });
          if (key === null) return;
          await s.useKey(key);
          if (s.status === "synced") toast("Synced with your other devices");
          break;
        }
        case "sync-now":
          await s.syncNow();
          break;
        case "sync-copy":
          await navigator.clipboard.writeText(s.key);
          toast("Sync key copied");
          break;
        case "sync-off":
          if (await confirmDialog("Turn off sync?", "This device stops syncing. Your data stays here and in the synced copy.", "Turn Off")) s.turnOff();
          break;
        case "sync-delete":
          if (await confirmDialog("Delete synced data?", "The encrypted copy is deleted from the server and sync turns off. Data on your devices stays.", "Delete")) {
            await s.deleteRemote();
            toast("Synced data deleted");
          }
          break;
      }
    } catch (err) {
      toast(err.message, { color: "danger" });
    }
    this.render();
  }
}

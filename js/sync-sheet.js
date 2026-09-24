// The "Sync" sheet: turn end-to-end encrypted sync on/off, show or enter the
// sync key, delete the synced copy. Laid out like iOS Settings.

import { parseKey } from "./sync-crypto.js";
import { canScan, keyFromText, qrSvg, scanQR, syncLink } from "./sync-qr.js";
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

function since(time) {
  const m = Math.round((Date.now() - time) / 60_000);
  if (m < 10) return "Active now";   // devices refresh their entry every 10 minutes
  if (m < 60) return `Synced ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Synced ${h} h ago`;
  const d = Math.round(h / 24);
  return d < 14 ? `Synced ${d} day${d === 1 ? "" : "s"} ago` : `Synced ${new Date(time).toLocaleDateString()}`;
}

const DEVICE_ICONS = { iPhone: "phone-portrait-outline", Android: "phone-portrait-outline", iPad: "tablet-portrait-outline", macOS: "laptop-outline", ChromeOS: "laptop-outline" };

function deviceRow(d, self, last) {
  const name = d.app ? `ShallowSID app on ${d.os}` : `${d.browser} on ${d.os}`;
  const detail = [d.place, self ? "This device" : since(d.updated)].filter(Boolean).join(" · ");
  return `<ion-item ${self ? "" : `button detail="false" data-device="${esc(d.id)}"`} ${last ? `lines="none"` : ""}>
    <ion-icon slot="start" name="${DEVICE_ICONS[d.os] ?? "desktop-outline"}" color="${self ? "primary" : "medium"}"></ion-icon>
    <ion-label><h3>${esc(name)}</h3><p>${esc(detail)}</p></ion-label>
  </ion-item>`;
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
    this.root.addEventListener("ionChange", (e) => {
      if (e.target.id === "sync-toggle") e.target.checked ? sync.resume() : sync.pause();
    });
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

  // Ways to take the key another device already uses.
  joinItems(last = true) {
    const scan = canScan();
    return `
      <ion-item button detail="false" id="sync-join" ${last && !scan ? `lines="none"` : ""}>
        <ion-icon slot="start" name="key-outline" color="primary"></ion-icon><ion-label color="primary">Use a Key from Another Device…</ion-label>
      </ion-item>
      ${scan ? `<ion-item button detail="false" id="sync-scan" ${last ? `lines="none"` : ""}>
        <ion-icon slot="start" name="qr-code-outline" color="primary"></ion-icon><ion-label color="primary">Scan QR Code from Another Device</ion-label>
      </ion-item>` : ""}`;
  }

  render() {
    const s = this.sync;
    const intro = `<p class="sound-note">Keeps your playlists, favorites and sound presets the same on all your devices.
      Everything is encrypted on this device with a sync key only your devices know. There are no accounts,
      and the server stores nothing it can read. <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy</a></p>`;
    if (!s.hasKey) {
      this.root.innerHTML = `
        <h3 class="sound-section">Sync</h3>
        <ion-list inset>
          <ion-item button detail="false" id="sync-on">
            <ion-icon slot="start" name="cloud-upload-outline" color="primary"></ion-icon><ion-label color="primary">Turn On Sync</ion-label>
          </ion-item>
          ${this.joinItems()}
        </ion-list>
        ${intro}`;
      return;
    }
    // One status row whether on or paused, so toggling doesn't resize the sheet.
    const error = s.enabled && s.status === "error";
    const icon = !s.enabled ? "pause-circle-outline" : error ? "alert-circle-outline" : "cloud-done-outline";
    this.root.innerHTML = `
      <h3 class="sound-section">Sync</h3>
      <ion-list inset>
        <ion-item><ion-toggle id="sync-toggle" ${s.enabled ? "checked" : ""}>Sync This Device</ion-toggle></ion-item>
        <ion-item lines="none" class="sync-status">
          <ion-icon slot="start" name="${icon}" color="${error ? "danger" : s.enabled ? "primary" : "medium"}"></ion-icon>
          <ion-label class="ion-text-wrap" ${s.enabled ? "" : `color="medium"`}>${esc(s.enabled ? this.statusText() : "Paused on this device")}</ion-label>
          <ion-button slot="end" fill="clear" id="sync-now" ${s.status === "syncing" ? "disabled" : ""} ${s.enabled ? "" : `class="is-hidden"`}>
            ${s.status === "syncing" ? `<ion-spinner name="crescent"></ion-spinner>` : "Sync Now"}
          </ion-button>
        </ion-item>
      </ion-list>
      <p class="sound-note">Turning sync off pauses only this device. The key is kept, so turning it back on catches up.</p>

      ${this.devicesSection()}

      <h3 class="sound-section">Sync key</h3>
      <ion-list inset>
        <ion-item lines="none"><div class="sync-qr" id="sync-qr">${this.qr?.key === s.key ? this.qr.svg : ""}</div></ion-item>
        <ion-item lines="none"><ion-label class="sync-key">${esc(s.key)}</ion-label></ion-item>
        <ion-item button detail="false" id="sync-copy" lines="none">
          <ion-icon slot="start" name="copy-outline" color="primary"></ion-icon><ion-label color="primary">Copy Key</ion-label>
        </ion-item>
      </ion-list>
      <p class="sound-note">On your other devices, scan this code with the camera, or enter the key with <strong>Use a Key from Another Device</strong>.
        Keep it somewhere safe: without it the synced copy can't be recovered, not even by us.</p>

      <h3 class="sound-section">Change key</h3>
      <ion-list inset>
        ${this.joinItems(false)}
        <ion-item button detail="false" id="sync-new-key" lines="none">
          <ion-icon slot="start" name="refresh-outline" color="primary"></ion-icon><ion-label color="primary">Generate New Key…</ion-label>
        </ion-item>
      </ion-list>

      <ion-list inset>
        <ion-item button detail="false" id="sync-delete" lines="none">
          <ion-label color="danger">Delete Synced Data…</ion-label>
        </ion-item>
      </ion-list>
      ${intro}`;
    this.showQR();
  }

  // Everyone using the key, as last synced here; the list itself is encrypted
  // with the rest of the sync data.
  devicesSection() {
    const s = this.sync;
    const devices = s.devices;
    if (!devices.length) return "";
    return `
      <h3 class="sound-section">Devices</h3>
      <ion-list inset>${devices.map((d, i) => deviceRow(d, d.id === s.deviceId, i === devices.length - 1)).join("")}</ion-list>
      <p class="sound-note">Devices using this key. The place is a guess from each device's time zone, not its location.
        Tap a device you no longer use to take it off the list.</p>`;
  }

  // Drawn once per key; later renders reuse the SVG.
  async showQR() {
    const key = this.sync.key;
    if (this.qr?.key === key) return;
    try {
      this.qr = { key, svg: await qrSvg(syncLink(key)) };
      const slot = document.getElementById("sync-qr");
      if (slot && this.sync.key === key) slot.innerHTML = this.qr.svg;
    } catch (err) {
      console.error("sync qr:", err);
    }
  }

  // Opened from a scanned QR link (#/sync/<key>): confirm before joining, since
  // anyone can make such a link.
  async joinFromLink(text) {
    const key = keyFromText(text);
    const s = this.sync;
    try {
      parseKey(key);
    } catch {
      return toast("That isn't a valid sync key", { color: "warning" });
    }
    if (s.key === key) {
      this.open();
      if (s.enabled) return toast("This device already syncs with that key");
      await s.resume();
      return toast("Sync is back on");
    }
    const ok = await confirmDialog(
      s.hasKey ? "Switch sync key?" : "Use this sync key?",
      s.hasKey ? "This device stops syncing with its current key and joins the devices that use the new one."
        : "This device joins your other devices that sync with this key.",
      s.hasKey ? "Switch" : "Use");
    if (!ok) return;
    this.open();
    await this.join(key);
  }

  async join(key) {
    try {
      await this.sync.useKey(key);
      if (this.sync.status === "synced") toast("Synced with your other devices");
    } catch (err) {
      toast(err.message, { color: "danger" });
    }
    this.render();
  }

  async onClick(e) {
    const s = this.sync;
    const device = e.target.closest("[data-device]")?.dataset.device;
    if (device) {
      if (await confirmDialog("Remove this device?", "It comes back on the list if it syncs with this key again. To stop it for good, use a new key.", "Remove")) s.removeDevice(device);
      return;
    }
    const id = e.target.closest("ion-item[id], ion-button[id]")?.id;
    try {
      switch (id) {
        case "sync-on":
          await s.turnOn();
          break;
        case "sync-join": {
          const key = await prompt("Use a sync key", { placeholder: "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX", confirm: "Use" });
          if (key === null) return;
          return this.join(key);
        }
        case "sync-scan": {
          const text = await scanQR((t) => { try { return !!parseKey(keyFromText(t)); } catch { return false; } })
            .catch((err) => { throw err.name === "NotAllowedError" ? new Error("Camera access was not allowed") : err; });
          if (text === null) return;
          return this.join(keyFromText(text));
        }
        case "sync-now":
          await s.syncNow();
          break;
        case "sync-copy":
          await navigator.clipboard.writeText(s.key);
          toast("Sync key copied");
          break;
        case "sync-new-key":
          if (await confirmDialog("Generate a new key?",
            "This device starts a new synced copy under a new key. Devices on the old key stop syncing with it until they use the new key too. The old copy stays on the server: delete it first if you no longer need it.",
            "Generate")) {
            await s.turnOn();
            toast("New sync key ready");
          }
          break;
        case "sync-delete":
          if (await confirmDialog("Delete synced data?", "The encrypted copy is deleted from the server, sync turns off and this device forgets the key. Data on your devices stays.", "Delete")) {
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

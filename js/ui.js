// Small UI helpers: escaping, formatting, tune rows and Ionic overlays created
// the web-component way (no framework controllers needed).

import { artworkStyle, initials } from "./artwork.js";

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function thumb(item, cls = "thumb") {
  return `<div class="${cls}" style="${artworkStyle(item)}" aria-hidden="true"><span>${esc(initials(item))}</span></div>`;
}

export function subtitle(item) {
  return [item.author, item.released].filter(Boolean).join(" · ");
}

// A tune row. `item` is a queue item ({...tune, song}); `index` is its position
// in the list the row belongs to.
export function tuneRow(item, index, { current, missing, reorder, favorite } = {}) {
  const menu = `<ion-button slot="end" fill="clear" data-menu="${index}" aria-label="More"><ion-icon slot="icon-only" name="ellipsis-horizontal"></ion-icon></ion-button>`;
  const handle = reorder ? `<ion-reorder slot="end"></ion-reorder>` : "";
  if (missing) {
    return `<ion-item class="tune-row is-missing" lines="full">
      <div slot="start" class="thumb thumb-missing"><ion-icon name="help"></ion-icon></div>
      <ion-label><h2>${esc(item.path.split("/").pop())}</h2><p>Not in this HVSC version</p></ion-label>
      ${menu}${handle}
    </ion-item>`;
  }
  const song = item.songs > 1 ? `<span class="song-chip">#${item.song}/${item.songs}</span>` : "";
  const length = item.lengths?.[item.song - 1];
  const classes = ["tune-row", current && "is-current", favorite && "is-favorite"].filter(Boolean).join(" ");
  return `<ion-item button detail="false" class="${classes}" data-play="${index}" lines="full">
    <div slot="start">${thumb(item)}</div>
    <ion-label>
      <h2>${esc(item.title)} ${song}</h2>
      <p>${esc(subtitle(item))}</p>
    </ion-label>
    <ion-icon slot="end" name="star" class="fav-mark" aria-label="Favorite"></ion-icon>
    <ion-note slot="end">${length ? formatTime(length) : ""}</ion-note>
    ${menu}${handle}
  </ion-item>`;
}

function present(tag, props) {
  const el = Object.assign(document.createElement(tag), props);
  document.body.appendChild(el);
  el.addEventListener("didDismiss", () => el.remove());
  el.present();
  return el;
}

export function actionSheet(header, buttons) {
  return present("ion-action-sheet", { header, buttons: [...buttons, { text: "Cancel", role: "cancel" }] });
}

export function toast(message, { color, duration = 2200 } = {}) {
  return present("ion-toast", { message, duration, color, position: "top" });
}

// Resolves with the entered text, or null when cancelled.
export function prompt(header, { value = "", placeholder = "", confirm = "Save" } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const alert = present("ion-alert", {
      header,
      inputs: [{ name: "value", type: "text", value, placeholder, attributes: { autocapitalize: "sentences" } }],
      buttons: [
        { text: "Cancel", role: "cancel" },
        { text: confirm, handler: (data) => (result = data.value) },
      ],
    });
    alert.addEventListener("didDismiss", () => resolve(result));
  });
}

export function confirmDialog(header, message, confirm = "Delete") {
  return new Promise((resolve) => {
    let ok = false;
    const alert = present("ion-alert", {
      header,
      message,
      buttons: [
        { text: "Cancel", role: "cancel" },
        { text: confirm, role: "destructive", handler: () => (ok = true) },
      ],
    });
    alert.addEventListener("didDismiss", () => resolve(ok));
  });
}

export function download(fileName, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

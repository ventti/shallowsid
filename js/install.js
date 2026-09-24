// Installing ShallowSID as an app, and its service worker (the offline copy).
//
// Two platforms can install, and only those get the link:
//   * Chromium (desktop and Android) fires `beforeinstallprompt`; the event is
//     kept and its prompt() shown when the link is used.
//   * iOS has no install API at all: Add to Home Screen is only in the Share
//     menu, so the link explains where it is instead.

import { infoDialog } from "./ui.js";

const APP_MODES = ["standalone", "fullscreen", "minimal-ui"];

export class Install extends EventTarget {
  constructor() {
    super();
    this.promptEvent = null;
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();   // our link is the UI, not the browser's mini-infobar
      this.promptEvent = e;
      this.changed();
    });
    window.addEventListener("appinstalled", () => {
      this.promptEvent = null;
      this.changed();
    });
    for (const mode of APP_MODES) matchMedia(`(display-mode: ${mode})`).addEventListener?.("change", () => this.changed());
  }

  changed() {
    this.dispatchEvent(new Event("change"));
  }

  // navigator.standalone is the iOS way of saying the same.
  get installed() {
    return APP_MODES.some((mode) => matchMedia(`(display-mode: ${mode})`).matches) || navigator.standalone === true;
  }

  // navigator.standalone exists only in WebKit, and touch rules out desktop
  // Safari; every iOS browser is WebKit, so this covers Chrome there too.
  get ios() {
    return "standalone" in navigator && navigator.maxTouchPoints > 0;
  }

  get available() {
    return !this.installed && (!!this.promptEvent || this.ios);
  }

  async install() {
    const event = this.promptEvent;
    if (event) {
      this.promptEvent = null;   // one prompt() per event
      try {
        await event.prompt();
        await event.userChoice;
      } catch (err) {
        console.warn("install prompt refused:", err);
      }
      return this.changed();
    }
    if (!this.ios) return;
    // Chrome and Edge on iOS keep Share in their ⋯ menu; Safari in its toolbar.
    const share = /CriOS|EdgiOS/.test(navigator.userAgent) ? "Share in the browser's ⋯ menu" : "the Share button in the toolbar";
    await infoDialog("Install ShallowSID", `1. Tap ${share}.\n2. Choose Add to Home Screen.\n3. Tap Add.`);
  }
}

// After load, so caching the app doesn't compete with drawing it.
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !isSecureContext) return;
  const register = () => navigator.serviceWorker.register(new URL("../service-worker.js", import.meta.url))
    .catch((err) => console.warn("service worker:", err));
  if (document.readyState === "complete") register();
  else addEventListener("load", register, { once: true });
}

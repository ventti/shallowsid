// Mini-player (above the tab bar) and the Now Playing view. On phones Now
// Playing lives in a sheet modal; from 992px up it is a persistent side panel.

import { artworkStyle, initials } from "./artwork.js";
import { swipeable } from "./gestures.js";
import { Waveform } from "./player/waveform.js";
import { esc, formatTime, subtitle, thumb } from "./ui.js";

const DESKTOP = window.matchMedia("(min-width: 992px)");
const HINT_KEY = "shallowsid.swipeHintSeen";

export class NowPlaying {
  constructor(player, { onAddToPlaylist, onShowFolder, isFavorite, onToggleFavorite }) {
    this.player = player;
    this.onAddToPlaylist = onAddToPlaylist;
    this.onShowFolder = onShowFolder;
    this.isFavorite = isFavorite;
    this.onToggleFavorite = onToggleFavorite;
    const $ = (id) => document.getElementById(id);
    this.el = {
      mini: $("mini"), miniArt: $("mini-art"), miniTitle: $("mini-title"), miniAuthor: $("mini-author"),
      miniPlay: $("mini-play"), miniNext: $("mini-next"), miniBar: $("mini-bar"),
      np: $("np"), modal: $("np-modal"), modalHost: $("np-host"), side: $("side-panel"),
      art: $("np-art"), title: $("np-title"), author: $("np-author"), released: $("np-released"),
      badges: $("np-badges"), pos: $("np-pos"), dur: $("np-dur"), state: $("np-state"),
      play: $("np-play"), prev: $("np-prev"), next: $("np-next"), subtune: $("np-subtune"),
      add: $("np-add"), folder: $("np-folder"), fav: $("np-fav"), queue: $("np-queue"), hint: $("np-hint"),
    };
    this.waveform = new Waveform($("np-wave"), {
      onScrub: (s) => player.scrub(s),
      onSeek: (s) => player.seek(s),
    });
    this.el.modal.breakpoints = [0, 1];
    this.el.modal.initialBreakpoint = 1;
    this.bindControls();
    this.bindPlayer();
    DESKTOP.addEventListener("change", () => this.placeView());
    this.placeView();
  }

  placeView() {
    if (DESKTOP.matches) {
      this.el.modal.dismiss?.();
      this.el.side.appendChild(this.el.np);
    } else {
      this.el.modalHost.appendChild(this.el.np);
    }
    document.body.classList.toggle("has-side-panel", DESKTOP.matches);
    this.waveform.invalidate();
  }

  open() {
    if (!DESKTOP.matches && this.player.current) this.el.modal.present();
  }

  close() {
    this.el.modal.dismiss();
  }

  bindControls() {
    const p = this.player, el = this.el;
    el.miniPlay.addEventListener("click", () => p.toggle());
    el.miniNext.addEventListener("click", () => p.next());
    el.play.addEventListener("click", () => p.toggle());
    el.prev.addEventListener("click", () => p.previous());
    el.next.addEventListener("click", () => p.next());
    el.add.addEventListener("click", () => p.current && this.onAddToPlaylist(p.current));
    el.fav.addEventListener("click", () => p.current && this.onToggleFavorite(p.current));
    el.folder.addEventListener("click", () => {
      if (!p.current) return;
      this.close();
      this.onShowFolder(p.current.dir);
    });
    el.subtune.addEventListener("ionChange", (e) => p.selectSong(Number(e.detail.value)));
    el.queue.addEventListener("click", (e) => {
      const row = e.target.closest("[data-queue]");
      if (row) p.playIndex(Number(row.dataset.queue));
    });

    // Mini-player: tap/swipe up opens, swipe down toggles, left/right skip.
    swipeable(el.mini, {
      onTap: () => this.open(),
      onUp: () => this.open(),
      onDown: () => p.toggle(),
      onLeft: () => p.next(),
      onRight: () => p.previous(),
    });
    // Cover: tap toggles, swipe left/right skips; swipe down closes the sheet (Ionic).
    swipeable(el.art, {
      follow: true,
      onTap: () => p.toggle(),
      onLeft: () => p.next(),
      onRight: () => p.previous(),
    });
    try {
      if (localStorage.getItem(HINT_KEY)) el.hint.hidden = true;
      el.modal.addEventListener("didDismiss", () => {
        localStorage.setItem(HINT_KEY, "1");
        el.hint.hidden = true;
      });
    } catch {
      // storage unavailable: keep showing the hint
    }
  }

  bindPlayer() {
    const p = this.player, el = this.el;
    p.addEventListener("track", ({ detail: { item } }) => this.showTrack(item));
    p.addEventListener("state", ({ detail: { state } }) => this.showState(state));
    p.addEventListener("time", ({ detail }) => {
      this.waveform.setTime(detail);
      el.pos.textContent = formatTime(detail.position);
      el.dur.textContent = formatTime(detail.duration);
      el.miniBar.style.width = `${detail.duration ? (100 * detail.position) / detail.duration : 0}%`;
      const rendering = detail.buffered < detail.duration - 0.5;
      el.state.textContent = p.state === "buffering" ? "Buffering…" : rendering ? `Rendering ${Math.round((100 * detail.buffered) / detail.duration)}%` : "";
    });
    p.addEventListener("peaks", ({ detail }) => this.waveform.setPeaks(detail.peaks, detail.bucketsPerSecond));
    p.addEventListener("queue", ({ detail }) => this.showQueue(detail.queue, detail.index));
  }

  showTrack(item) {
    const el = this.el;
    el.mini.hidden = false;
    document.body.classList.add("has-track");
    el.miniArt.outerHTML = thumb(item, "thumb").replace('class="thumb"', 'class="thumb" id="mini-art"');
    el.miniArt = document.getElementById("mini-art");
    el.miniTitle.textContent = item.title;
    el.miniAuthor.textContent = item.author;
    el.art.setAttribute("style", artworkStyle(item));
    el.art.querySelector("span").textContent = initials(item);
    el.title.textContent = item.title;
    el.author.textContent = item.author;
    el.released.textContent = item.released;
    const badges = [item.model, item.clock, item.rsid && "RSID", item.multiSid && "Multi-SID"].filter(Boolean);
    el.badges.innerHTML = badges.map((b) => `<ion-badge color="medium">${esc(b)}</ion-badge>`).join("");
    el.subtune.hidden = item.songs < 2;
    el.subtune.innerHTML = Array.from({ length: item.songs }, (_, i) => {
      const len = item.lengths?.[i];
      return `<ion-select-option value="${i + 1}">Subtune ${i + 1}${len ? ` · ${formatTime(len)}` : ""}</ion-select-option>`;
    }).join("");
    el.subtune.value = String(item.song);
    el.fav.hidden = false;
    this.refreshFavorite();
    document.title = `${item.title} – ${item.author} · ShallowSID`;
  }

  // Call after favorites change elsewhere (row menus, playlist edits).
  refreshFavorite() {
    const item = this.player.current;
    const on = !!item && this.isFavorite(item);
    this.el.fav.querySelector("ion-icon").name = on ? "star" : "star-outline";
    this.el.fav.setAttribute("aria-pressed", String(on));
    this.el.fav.setAttribute("aria-label", on ? "Remove from Favorites" : "Add to Favorites");
  }

  showState(state) {
    const playing = state === "playing" || state === "buffering" || state === "loading";
    const icon = playing ? "pause" : "play";
    for (const btn of [this.el.play, this.el.miniPlay]) {
      btn.querySelector("ion-icon").name = icon;
      btn.setAttribute("aria-label", playing ? "Pause" : "Play");
    }
    this.el.np.classList.toggle("is-paused", !playing);
  }

  showQueue(queue, index) {
    const upcoming = queue.slice(index + 1, index + 51);
    this.el.queue.innerHTML = upcoming.length
      ? `<ion-list-header><ion-label>Up next</ion-label></ion-list-header>` +
        upcoming.map((item, i) => `<ion-item button detail="false" lines="none" data-queue="${index + 1 + i}">
            <div slot="start">${thumb(item, "thumb thumb-sm")}</div>
            <ion-label><h3>${esc(item.title)}${item.songs > 1 ? ` #${item.song}` : ""}</h3><p>${esc(subtitle(item))}</p></ion-label>
          </ion-item>`).join("")
      : "";
  }
}

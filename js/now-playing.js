// Mini-player (above the tab bar) and the Now Playing view. On phones Now
// Playing lives in a sheet modal; from 992px up it is a persistent side panel.

import { artworkImage } from "./artwork.js";
import { swipeable } from "./gestures.js";
import { REPEAT_MODES } from "./player/player.js";
import { Waveform } from "./player/waveform.js";
import { esc, formatTime, subtitle, thumb } from "./ui.js";

const DESKTOP = window.matchMedia("(min-width: 992px)");
const REPEAT_KEY = "shallowsid.repeat";
const SHUFFLE_KEY = "shallowsid.shuffle";
const REPEAT_LABELS = { off: "Repeat: off", all: "Repeat: playlist", one: "Repeat: this tune" };
const UP_NEXT_MAX = 50;

export class NowPlaying {
  constructor(player, { onAddToPlaylist, onShowFolder, onShare, onOpenComposer, isFavorite, onToggleFavorite, onOpenSound, tags, onOpenTag, onEditTags }) {
    this.player = player;
    this.onAddToPlaylist = onAddToPlaylist;
    this.onShowFolder = onShowFolder;
    this.onShare = onShare;
    this.onOpenComposer = onOpenComposer;
    this.isFavorite = isFavorite;
    this.onToggleFavorite = onToggleFavorite;
    this.onOpenSound = onOpenSound;
    this.tags = tags;
    this.onOpenTag = onOpenTag;
    this.onEditTags = onEditTags;
    const $ = (id) => document.getElementById(id);
    this.el = {
      mini: $("mini"), miniArt: $("mini-art"), miniTitle: $("mini-title"), miniAuthor: $("mini-author"),
      miniPlay: $("mini-play"), miniNext: $("mini-next"), miniBar: $("mini-bar"),
      np: $("np"), modal: $("np-modal"), modalHost: $("np-host"), side: $("side-panel"),
      art: $("np-art"), title: $("np-title"), author: $("np-author"), released: $("np-released"),
      badges: $("np-badges"), tagList: $("np-tags"), pos: $("np-pos"), dur: $("np-dur"), state: $("np-state"),
      play: $("np-play"), prev: $("np-prev"), next: $("np-next"), subtune: $("np-subtune"),
      add: $("np-add"), folder: $("np-folder"), share: $("np-share"), fav: $("np-fav"), sound: $("np-sound"), queue: $("np-queue"),
      repeat: $("np-repeat"), shuffle: $("np-shuffle"),
    };
    this.waveform = new Waveform($("np-wave"), {
      onScrub: (s) => player.scrub(s),
      onSeek: (s) => player.seek(s),
      canScrub: () => player.canScrub,
    });
    this.el.modal.breakpoints = [0, 1];
    this.el.modal.initialBreakpoint = 1;
    this.bindControls();
    this.bindPlayer();
    this.showRepeat(player.repeat);
    player.setRepeat(loadSetting(REPEAT_KEY, "off"));
    player.setShuffle(loadSetting(SHUFFLE_KEY, "off") === "on");
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
    el.shuffle.addEventListener("click", () => p.setShuffle(!p.shuffle));
    el.repeat.addEventListener("click", () => {
      p.setRepeat(REPEAT_MODES[(REPEAT_MODES.indexOf(p.repeat) + 1) % REPEAT_MODES.length]);
    });
    el.add.addEventListener("click", () => p.current && this.onAddToPlaylist(p.current));
    el.share.addEventListener("click", () => p.current && this.onShare(p.current));   // with the subtune playing
    el.fav.addEventListener("click", () => p.current && this.onToggleFavorite(p.current));
    el.sound.addEventListener("click", () => this.onOpenSound());
    el.folder.addEventListener("click", () => {
      if (!p.current) return;
      this.close();
      this.onShowFolder(p.current.dir);
    });
    // The composer is a link to their page ("<?>" means unknown).
    const openComposer = () => {
      const author = p.current?.author;
      if (!author || author === "<?>") return;
      this.close();
      this.onOpenComposer(author);
    };
    el.author.addEventListener("click", openComposer);
    el.author.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openComposer();
      }
    });
    el.subtune.addEventListener("ionChange", (e) => p.selectSong(Number(e.detail.value)));
    el.tagList.addEventListener("click", (e) => {
      if (!p.current) return;
      if (e.target.closest("[data-tag-edit]")) return this.onEditTags(p.current);
      const tag = e.target.closest("[data-tag]")?.dataset.tag;
      if (!tag) return;
      this.close();
      this.onOpenTag(tag);
    });
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
      el.state.textContent = p.state === "buffering" ? "Buffering…"
        : p.adjusting ? "Live" : rendering && p.prerender ? `Rendering ${Math.round((100 * detail.buffered) / detail.duration)}%` : "";
    });
    p.addEventListener("peaks", ({ detail }) => this.waveform.setPeaks(detail.peaks, detail.bucketsPerSecond));
    p.addEventListener("queue", ({ detail }) => this.showQueue(detail.queue, detail.index));
    p.addEventListener("repeat", ({ detail: { mode } }) => {
      this.showRepeat(mode);
      saveSetting(REPEAT_KEY, mode);
      this.showQueue(p.queue, p.index);
    });
    p.addEventListener("shuffle", ({ detail: { on } }) => {
      el.shuffle.setAttribute("aria-pressed", String(on));
      el.shuffle.setAttribute("aria-label", `Shuffle: ${on ? "on" : "off"}`);
      el.shuffle.title = `Shuffle: ${on ? "on" : "off"}`;
      saveSetting(SHUFFLE_KEY, on ? "on" : "off");
    });
  }

  showRepeat(mode) {
    this.el.repeat.dataset.mode = mode;
    this.el.repeat.setAttribute("aria-label", REPEAT_LABELS[mode]);
    this.el.repeat.title = REPEAT_LABELS[mode];
  }

  showTrack(item) {
    const el = this.el;
    el.mini.hidden = false;
    document.body.classList.add("has-track");
    el.miniArt.outerHTML = thumb(item, "thumb").replace('class="thumb"', 'class="thumb" id="mini-art"');
    el.miniArt = document.getElementById("mini-art");
    el.miniTitle.textContent = item.title;
    el.miniAuthor.textContent = item.author;
    el.art.style.backgroundImage = artworkImage(item);
    el.art.querySelector("span").textContent = "";
    el.title.textContent = item.title;
    el.author.textContent = item.author;
    el.author.classList.toggle("is-link", item.author !== "<?>");
    el.released.textContent = item.released;
    const badges = [item.model, item.clock, item.rsid && "RSID", item.multiSid && "Multi-SID"].filter(Boolean);
    el.badges.innerHTML = badges.map((b) => `<ion-badge color="medium">${esc(b)}</ion-badge>`).join("");
    el.subtune.hidden = item.songs < 2;
    el.subtune.innerHTML = Array.from({ length: item.songs }, (_, i) => {
      const len = item.lengths?.[i];
      return `<ion-select-option value="${i + 1}">Subtune ${i + 1}${len ? ` · ${formatTime(len)}` : ""}</ion-select-option>`;
    }).join("");
    el.subtune.value = String(item.song);
    el.fav.hidden = el.share.hidden = false;
    this.refreshFavorite();
    this.refreshTags();
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

  // The tempo, the tune's tags, then the subtune's own (each marked with its number).
  // Curators also get a chip that opens the Tags sheet.
  refreshTags() {
    const item = this.player.current;
    if (!item) return;
    const { whole, sub } = this.tags.tagsFor(item);
    const bpm = this.tags.bpmFor(item);
    const song = (s) => (s ? `<span class="tag-song">#${s}</span>` : "");
    const chip = (id, s) => `<ion-chip data-tag="${esc(id)}" class="tag-chip">${esc(this.tags.label(id))}${song(s)}</ion-chip>`;
    const tempo = bpm.bpm ? `<ion-chip class="tag-chip bpm-chip" title="Tempo">${bpm.bpm} BPM${song(bpm.sub ? item.song : 0)}</ion-chip>` : "";
    const any = whole.length || sub.length || bpm.bpm;
    const edit = this.tags.canTag
      ? `<ion-chip data-tag-edit class="tag-chip tag-edit" outline><ion-icon name="${any ? "pricetags-outline" : "add"}"></ion-icon><ion-label>${any ? "Edit Tags" : "Tag"}</ion-label></ion-chip>`
      : "";
    this.el.tagList.innerHTML = [tempo, ...whole.map((id) => chip(id)), ...sub.map((id) => chip(id, item.song)), edit].join("");
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

  // With the playlist on repeat, the start of the queue follows its end.
  showQueue(queue, index) {
    const order = queue.map((_, i) => i).slice(index + 1);
    if (this.player.repeat === "all") order.push(...queue.map((_, i) => i).slice(0, index + 1));
    const upcoming = order.slice(0, UP_NEXT_MAX);
    this.el.queue.innerHTML = upcoming.length
      ? `<ion-list-header><ion-label>Up next</ion-label></ion-list-header>` +
        upcoming.map((i) => `<ion-item button detail="false" lines="none" data-queue="${i}">
            <div slot="start">${thumb(queue[i], "thumb thumb-sm")}</div>
            <ion-label><h3>${esc(queue[i].title)}${queue[i].songs > 1 ? ` #${queue[i].song}` : ""}</h3><p>${esc(subtitle(queue[i]))}</p></ion-label>
          </ion-item>`).join("")
      : "";
  }
}

function loadSetting(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the setting lasts the session
  }
}

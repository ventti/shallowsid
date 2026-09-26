// Lock-screen, headset and keyboard media keys via the Media Session API.

import { artworkPng } from "../artwork.js";

export function connectMediaSession(player) {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;

  const handlers = {
    play: () => player.play(),
    pause: () => player.pause(),
    nexttrack: () => player.next(),
    previoustrack: () => player.previous(),
    seekto: (d) => player.seek(d.seekTime),
    seekforward: (d) => player.seek(player.position + (d.seekOffset || 10)),
    seekbackward: (d) => player.seek(player.position - (d.seekOffset || 10)),
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      // action not supported by this browser
    }
  }

  // The cover is rendered asynchronously, so the text goes up first and the
  // artwork follows, unless another track has started meanwhile.
  player.addEventListener("track", async ({ detail: { item } }) => {
    const info = {
      title: item.song > 1 || item.songs > 1 ? `${item.title} (#${item.song})` : item.title,
      artist: item.author,
      album: item.released,
    };
    const metadata = ms.metadata = new MediaMetadata(info);
    try {
      const src = await artworkPng(item, 512);
      if (ms.metadata === metadata) ms.metadata = new MediaMetadata({ ...info, artwork: [{ src, sizes: "512x512", type: "image/png" }] });
    } catch {
      // no artwork then
    }
  });

  player.addEventListener("state", ({ detail: { state } }) => {
    ms.playbackState = state === "paused" || state === "idle" ? "paused" : "playing";
  });

  let lastUpdate = 0;
  player.addEventListener("time", ({ detail: { position, duration } }) => {
    const now = performance.now();
    if (now - lastUpdate < 1000 || !ms.setPositionState) return;
    lastUpdate = now;
    try {
      ms.setPositionState({ duration, position: Math.min(position, duration), playbackRate: 1 });
    } catch {
      // invalid state during track changes
    }
  });
}

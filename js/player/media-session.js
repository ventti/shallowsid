// Lock-screen, headset and keyboard media keys via the Media Session API.

import { artworkDataUrl } from "../artwork.js";

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

  player.addEventListener("track", ({ detail: { item } }) => {
    ms.metadata = new MediaMetadata({
      title: item.song > 1 || item.songs > 1 ? `${item.title} (#${item.song})` : item.title,
      artist: item.author,
      album: item.released,
      artwork: [{ src: artworkDataUrl(item, 512), sizes: "512x512", type: "image/png" }],
    });
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

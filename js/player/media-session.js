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

  // Publish text and cover together so system controls do not flash the app icon.
  let lastUpdate = -Infinity;
  function updatePosition(position, duration) {
    if (!ms.setPositionState || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return;
    try {
      ms.setPositionState({ duration, position: Math.max(0, Math.min(position, duration)), playbackRate: 1 });
      lastUpdate = performance.now();
    } catch {
      // The browser may be replacing its media session during a track change.
    }
  }

  let trackVersion = 0;
  player.addEventListener("track", async ({ detail: { item } }) => {
    const info = {
      title: item.song > 1 || item.songs > 1 ? `${item.title} (#${item.song})` : item.title,
      artist: item.author,
      album: item.released,
    };
    const version = ++trackVersion;
    updatePosition(player.position, player.duration);
    try {
      const src = await artworkPng(item, 512);
      info.artwork = [{ src, sizes: "512x512", type: "image/png" }];
    } catch {
      // Keep track information available if the cover cannot be rendered.
    }
    if (version === trackVersion) {
      ms.metadata = new MediaMetadata(info);
      updatePosition(player.position, player.duration);
    }
  });

  player.addEventListener("state", ({ detail: { state } }) => {
    ms.playbackState = state === "paused" || state === "idle" ? "paused" : "playing";
  });

  player.addEventListener("time", ({ detail: { position, duration } }) => {
    if (performance.now() - lastUpdate < 1000) return;
    updatePosition(position, duration);
  });
}

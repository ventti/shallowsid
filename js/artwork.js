// Deterministic covers from pixelavatar.js: a mirrored pixel sprite in one of
// the app accents, lit by a two-hue color slide, seeded by the tune path, on a
// dark background tinted with the composer's colour (composer-colors.js), the
// same for all their tunes and their critter.
// Playlists show a mosaic of their tunes' covers. The sprite sits at the same
// size in its tile (CONTENT) wherever a cover shows: lists, the tune page, Now
// Playing, the lock screen.

import "./pixelavatar.js";   // sets self.PixelAvatar
import { creditTint } from "./composer-colors.js";

// The app accents, as on the composer critters (avatars.js); the seed picks one.
const COLORS = ["#a99cff", "#5ee0c0", "#ff8fb1", "#ffd166", "#7dd3fc", "#b8e986"];
const OPTIONS = {
  cols: 8, rows: 8, mirror: "x", symmetry: "full", colors: 1, density: 0.5, pixelAspect: 1,
  size: 44,   // .thumb; CSS scales it to the other cover sizes
  color: COLORS,
  slide: "auto", slideMode: "pixels", slideOpacity: 1, slideBlend: "overlay",
};

// How much of a cover the sprite fills (pixelavatar's `content`), the same at
// every size: about half, on the tile's own background, so covers stay calm.
export const CONTENT = 0.45;

const urlCache = new Map();

// A tune's cover; `author` is its HVSC credit, which picks the background.
function svgUrl(path, author) {
  const key = `${path}|${author ?? ""}`;
  if (!urlCache.has(key)) {
    const svg = self.PixelAvatar.svg(path, { ...OPTIONS, content: CONTENT, background: creditTint(author) });
    urlCache.set(key, `data:image/svg+xml,${encodeURIComponent(svg)}`);
  }
  return urlCache.get(key);
}

const cssUrl = (path, author) => `url(&quot;${svgUrl(path, author)}&quot;)`;

// A CSS background-image value.
export const artworkImage = (item) => `url("${svgUrl(item.path, item.author)}")`;

// For a style="" attribute in markup.
export const artworkStyle = (item) => `background-image: ${cssUrl(item.path, item.author)}`;

// The first four distinct tunes' covers in a 2x2 mosaic; with fewer, the first
// cover alone. Null for an empty playlist. Playlist items keep only paths, so
// `authorOf(path)` gives each tune's credit.
export function playlistArtStyle(playlist, authorOf = () => null) {
  const paths = [...new Set(playlist.items.map((i) => i.path))];
  if (!paths.length) return null;
  const url = (path) => cssUrl(path, authorOf(path));
  if (paths.length < 4) return `background-image: ${url(paths[0])}`;
  return `background-image: ${paths.slice(0, 4).map(url).join(", ")}; ` +
    "background-position: 0 0, 100% 0, 0 100%, 100% 100%; background-size: 50% 50%";
}

// A PNG for the Media Session, which can't rely on SVG artwork.
const pngCache = new Map();

export function artworkPng(item, size) {
  const key = `${item.path}|${item.author ?? ""}@${size}`;
  if (!pngCache.has(key)) pngCache.set(key, new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const g = canvas.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, size, size);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = svgUrl(item.path, item.author);
  }));
  return pngCache.get(key);
}

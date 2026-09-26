// Deterministic covers from pixelavatar.js: a mirrored pixel sprite in one of
// the app accents, lit by a two-hue color slide, seeded by the tune path.
// Playlists show a mosaic of their tunes' covers.

import "./pixelavatar.js";   // sets self.PixelAvatar

// The app accents, as on the composer critters (avatars.js); the seed picks one.
const COLORS = ["#a99cff", "#5ee0c0", "#ff8fb1", "#ffd166", "#7dd3fc", "#b8e986"];
const OPTIONS = {
  cols: 8, rows: 8, mirror: "x", symmetry: "full", colors: 1, density: 0.5, pixelAspect: 1,
  size: 44,   // .thumb; CSS scales it to the other cover sizes
  color: COLORS,
  background: "#221d31",   // --app-surface
  slide: "auto", slideMode: "pixels", slideOpacity: 1, slideBlend: "overlay",
};

const urlCache = new Map();

function svgUrl(path) {
  if (!urlCache.has(path)) urlCache.set(path, `data:image/svg+xml,${encodeURIComponent(self.PixelAvatar.svg(path, OPTIONS))}`);
  return urlCache.get(path);
}

const cssUrl = (path) => `url(&quot;${svgUrl(path)}&quot;)`;

// A CSS background-image value.
export const artworkImage = (item) => `url("${svgUrl(item.path)}")`;

// For a style="" attribute in markup.
export const artworkStyle = (item) => `background-image: ${cssUrl(item.path)}`;

// The first four distinct tunes' covers in a 2x2 mosaic; with fewer, the first
// cover alone. Null for an empty playlist.
export function playlistArtStyle(playlist) {
  const paths = [...new Set(playlist.items.map((i) => i.path))];
  if (!paths.length) return null;
  if (paths.length < 4) return `background-image: ${cssUrl(paths[0])}`;
  return `background-image: ${paths.slice(0, 4).map(cssUrl).join(", ")}; ` +
    "background-position: 0 0, 100% 0, 0 100%, 100% 100%; background-size: 50% 50%";
}

// A PNG for the Media Session, which can't rely on SVG artwork.
const pngCache = new Map();

export function artworkPng(item, size) {
  const key = `${item.path}@${size}`;
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
    img.src = svgUrl(item.path);
  }));
  return pngCache.get(key);
}

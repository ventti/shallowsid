// Deterministic tune covers: a mirrored 8x8 pixel sprite (pixelavatar.js) in
// one of the app accents, lit by a two-hue color slide, both seeded by the tune path.

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

const svgCache = new Map();

function coverSvg(item) {
  if (!svgCache.has(item.path)) svgCache.set(item.path, self.PixelAvatar.svg(item.path, OPTIONS));
  return svgCache.get(item.path);
}

const svgUrl = (item) => `data:image/svg+xml,${encodeURIComponent(coverSvg(item))}`;

// A CSS background-image value.
export const artworkImage = (item) => `url("${svgUrl(item)}")`;

// For a style="" attribute in markup.
export function artworkStyle(item) {
  return `background-image: ${artworkImage(item).replaceAll('"', "&quot;")}`;
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
    img.src = svgUrl(item);
  }));
  return pngCache.get(key);
}

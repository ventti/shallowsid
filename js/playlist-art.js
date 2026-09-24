// Playlist covers: a DiceBear identicon (C64-sprite-like blocks) seeded by the
// playlist id, so renaming keeps the cover. Rendered markup carries
// data-avatar="<id>" with an icon fallback; paintAvatars() swaps in the art
// once the library has loaded from the CDN. The blocks go through a circular
// median filter, which rounds them into soft blobs, under a colour slide like
// the tune covers.

import { artworkStyle } from "./artwork.js";

const CORE_URL = "https://cdn.jsdelivr.net/npm/@dicebear/core@9.4.2/+esm";
const STYLE_URL = "https://cdn.jsdelivr.net/npm/@dicebear/identicon@9.4.2/+esm";
const COLORS = ["a99cff", "6c5eb5", "5ee0c0", "2f7d8c", "ff8fb1", "ffd166"];   // app accents, C64-ish brights
const SIZE = 120;            // px; 5 cells of 24
const MEDIAN_RADIUS = 15;    // px; rounds corners to about this radius
const EDGE_SOFTNESS = 12;    // steepness of the anti-aliased edge (higher is crisper)

let library = null;
const cache = new Map();

function load() {
  library ??= Promise.all([import(CORE_URL), import(STYLE_URL)]).catch((err) => {
    library = null;   // try again next time
    throw err;
  });
  return library;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Median of a two-tone image = majority vote over a disc. The vote share
// becomes the alpha, so edges come out anti-aliased.
function medianFilter(src, size, radius) {
  const alpha = new Uint8Array(size * size);
  let color = null;
  for (let i = 0; i < alpha.length; i++) {
    if (src[i * 4 + 3] < 128) continue;
    alpha[i] = 1;
    color ??= [src[i * 4], src[i * 4 + 1], src[i * 4 + 2]];
  }
  const disc = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius) disc.push([dx, dy]);
  const out = new ImageData(size, size);
  if (!color) return out;
  const clamp = (v) => (v < 0 ? 0 : v >= size ? size - 1 : v);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let votes = 0;
      for (const [dx, dy] of disc) votes += alpha[clamp(y + dy) * size + clamp(x + dx)];
      const share = votes / disc.length;
      const a = Math.min(1, Math.max(0, (share - 0.5) * EDGE_SOFTNESS + 0.5));
      const o = (y * size + x) * 4;
      [out.data[o], out.data[o + 1], out.data[o + 2]] = color;
      out.data[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

async function renderCover(core, style, seed) {
  const img = await loadImage(core.createAvatar(style, { seed, rowColor: COLORS, size: SIZE }).toDataUri());
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  ctx.putImageData(medianFilter(ctx.getImageData(0, 0, SIZE, SIZE).data, SIZE, MEDIAN_RADIUS), 0, 0);
  return canvas.toDataURL();
}

export async function paintAvatars(root) {
  const slots = root.querySelectorAll("[data-avatar]");
  if (!slots.length) return;
  let core, style;
  try {
    [core, style] = await load();
  } catch (err) {
    return console.error("playlist art:", err);   // the icons stay
  }
  for (const slot of slots) {
    const seed = slot.dataset.avatar;
    if (!cache.has(seed)) cache.set(seed, renderCover(core, style, seed));
    try {
      const src = await cache.get(seed);
      slot.innerHTML = `<img src="${src}" alt=""><span class="avatar-tint" style="${artworkStyle({ path: seed })}"></span>`;
      slot.classList.add("has-avatar");
    } catch (err) {
      cache.delete(seed);
      console.error("playlist art:", err);
    }
  }
}

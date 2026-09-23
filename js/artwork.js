// Deterministic "album covers": a two-hue gradient derived from the tune path,
// with the tune's initials in a C64-ish pixel font.

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function palette(item) {
  const h = hash(item.path);
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + ((h >>> 9) % 100)) % 360;
  const angle = (h >>> 17) % 360;
  return { hue1, hue2, angle };
}

export function initials(item) {
  const words = (item.title || item.name).replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
}

export function artworkStyle(item) {
  const { hue1, hue2, angle } = palette(item);
  return `background: linear-gradient(${angle}deg, hsl(${hue1} 70% 45%), hsl(${hue2} 75% 30%))`;
}

const dataUrlCache = new Map();

export function artworkDataUrl(item, size) {
  const key = `${item.path}@${size}`;
  if (dataUrlCache.has(key)) return dataUrlCache.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  const { hue1, hue2, angle } = palette(item);
  const rad = (angle * Math.PI) / 180;
  const dx = (Math.sin(rad) * size) / 2, dy = (-Math.cos(rad) * size) / 2;
  const grad = g.createLinearGradient(size / 2 - dx, size / 2 - dy, size / 2 + dx, size / 2 + dy);
  grad.addColorStop(0, `hsl(${hue1} 70% 45%)`);
  grad.addColorStop(1, `hsl(${hue2} 75% 30%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.font = `${Math.round(size / 4)}px "Press Start 2P", monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(initials(item), size / 2, size / 2);
  const url = canvas.toDataURL("image/png");
  dataUrlCache.set(key, url);
  return url;
}

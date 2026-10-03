// Deterministic DiceBear art, in a preset made for ShallowSID's dark lavender
// look: composers get a Critters creature seeded by their name (see the
// composer page), in their colours from composer-colors.js, which also tint
// their tunes' covers. The style is CC0. Markup carries data-composer="<name>" with
// a fallback; paintAvatars() swaps in the art once DiceBear has loaded from
// the CDN. `data-animate` makes a critter
// bob, blink and sway (paused under prefers-reduced-motion).

import { composerColors } from "./composer-colors.js";

const CDN = "https://cdn.jsdelivr.net/npm";
const CORE_URL = `${CDN}/@dicebear/core@10.7.0/+esm`;
const styleUrl = (name) => `${CDN}/@dicebear/styles@10.6.0/dist/${name}.min.json`;

// Mouths with a pink tongue painted into the artwork are left out: no color
// option reaches it, and it clashes with the palette.
const NO_TONGUE = ["smile", "tinySmile", "teeth", "ooh", "line", "smirk", "wavy", "catMouth", "zigzag", "frown", "sad", "slant", "dot", "tooth"];

// The colours come from the composer (colorsFor); the rest is fixed.
const PRESETS = {
  critters: {
    inkColor: ["16131f"],
    mouthVariant: NO_TONGUE,
  },
};

// DiceBear's colour options for a composer, without the "#": their body and
// accent, on the same gradient as their tunes' covers.
function colorsFor(name) {
  const { body, accent, light, dark, angle } = composerColors(name);
  const bare = (c) => c.slice(1);
  return {
    bodyColor: [bare(body)], accentColor: [bare(accent)],
    // DiceBear turns its gradient from pointing right; pixelavatar's 0 points up.
    backgroundColor: [bare(light), bare(dark)], backgroundColorFill: ["linear"], backgroundColorAngle: angle - 90,
  };
}
const ANIMATED = { animationVariant: ["medium", "slow", "slowest"] };   // the calm speeds; the seed picks one

const SLOTS = [
  { attr: "composer", style: "critters" },
];

const loading = new Map();   // core and each style, fetched once when first needed
const cache = new Map();

function once(key, fetcher) {
  if (!loading.has(key)) loading.set(key, fetcher().catch((err) => {
    loading.delete(key);   // try again next time
    throw err;
  }));
  return loading.get(key);
}

const loadCore = () => once("core", () => import(CORE_URL));

const loadStyle = (name) => once(name, async () => {
  const [core, res] = await Promise.all([loadCore(), fetch(styleUrl(name))]);
  if (!res.ok) throw new Error(`DiceBear ${name}: HTTP ${res.status}`);
  return new core.Style(await res.json());
});

export async function paintAvatars(root) {
  const slots = SLOTS.flatMap((s) => [...root.querySelectorAll(`[data-${s.attr}]`)].map((el) => ({ el, ...s })));
  if (!slots.length) return;
  let core, styles;
  try {
    const names = [...new Set(slots.map((s) => s.style))];
    [core, ...styles] = await Promise.all([loadCore(), ...names.map(loadStyle)]);
    styles = Object.fromEntries(names.map((n, i) => [n, styles[i]]));
  } catch (err) {
    return console.error("avatars:", err);   // the fallbacks stay
  }
  for (const { el, attr, style } of slots) {
    const seed = el.dataset[attr];
    const animate = el.hasAttribute("data-animate");
    const key = `${style}:${animate}:${seed}`;
    if (!cache.has(key)) cache.set(key, new core.Avatar(styles[style], { seed, ...PRESETS[style], ...colorsFor(seed), ...(animate && ANIMATED) }).toDataUri());
    el.innerHTML = `<img src="${cache.get(key)}" alt="">`;
    el.classList.add("has-avatar");
  }
}

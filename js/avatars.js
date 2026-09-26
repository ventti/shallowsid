// Deterministic DiceBear art, in a preset made for ShallowSID's dark lavender
// look: composers get a Critters creature seeded by their name (see the
// composer page). The style is CC0. Markup carries data-composer="<name>" with
// a fallback; paintAvatars() swaps in the art once DiceBear has loaded from
// the CDN. `data-animate` makes a critter
// bob, blink and sway (paused under prefers-reduced-motion).

const CDN = "https://cdn.jsdelivr.net/npm";
const CORE_URL = `${CDN}/@dicebear/core@10.7.0/+esm`;
const styleUrl = (name) => `${CDN}/@dicebear/styles@10.6.0/dist/${name}.min.json`;

// Mouths with a pink tongue painted into the artwork are left out: no color
// option reaches it, and it clashes with the palette.
const NO_TONGUE = ["smile", "tinySmile", "teeth", "ooh", "line", "smirk", "wavy", "catMouth", "zigzag", "frown", "sad", "slant", "dot", "tooth"];

// App accents and C64-ish brights on the app's surface purples.
const PRESETS = {
  critters: {
    backgroundColor: ["2a2340", "231e36", "1f2638", "2c2036"],
    bodyColor: ["a99cff", "5ee0c0", "ff8fb1", "ffd166", "7dd3fc", "b8e986"],
    accentColor: ["6c5eb5", "2f9c85", "c75d82", "c79a2e", "3f8fb8", "7aa84f"],
    inkColor: ["16131f"],
    mouthVariant: NO_TONGUE,
  },
};
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
    if (!cache.has(key)) cache.set(key, new core.Avatar(styles[style], { seed, ...PRESETS[style], ...(animate && ANIMATED) }).toDataUri());
    el.innerHTML = `<img src="${cache.get(key)}" alt="">`;
    el.classList.add("has-avatar");
  }
}

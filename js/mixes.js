// Spotify-style mixes for Home: a random handful (a couple of year mixes, one
// composer, one music group or label and some themes), each a random sample of the tunes that fit it.
// Which mixes show can change on every visit; a mix's tunes are seeded by the
// week (weekSeed), so they stay put for a week and then change. Pure, so it
// runs under `node --test`.

export const MIX_SIZE = 50;
const MIN_TUNES = 60;         // a year or composer needs this many to make a mix
const MIN_GROUP_TUNES = 25;   // groups are smaller; Side B has about 30
const YEAR_MIXES = 2;
const THEME_MIXES = 3;

const lengthOf = (t) => t.lengths?.[t.start - 1] ?? 0;
const yearOf = (t) => /^(\d{4})/.exec(t.released ?? "")?.[1];

// Themes: [id, title, note, icon, filter]
const THEMES = [
  ["multi-sid", "Multi-SID", "Tunes for two or three SID chips", "layers-outline", (t) => t.multiSid],
  ["games", "Game music", "From the GAMES folders", "game-controller-outline", (t) => t.dir.startsWith("GAMES/")],
  ["demos", "Demo tunes", "From the DEMOS folders", "sparkles-outline", (t) => t.dir.startsWith("DEMOS/")],
  ["8580", "8580 sound", "Made for the newer SID chip", "hardware-chip-outline", (t) => t.model === "8580"],
  ["ntsc", "NTSC", "Tunes timed for American machines", "globe-outline", (t) => t.clock === "NTSC"],
  ["epic", "Epic length", "Six minutes or more", "hourglass-outline", (t) => lengthOf(t) >= 360],
  ["short", "Short and sweet", "Half a minute to a minute and a half", "flash-outline", (t) => lengthOf(t) >= 30 && lengthOf(t) <= 90],
  ["random", "Random songs", "Anything from the whole collection", "shuffle", () => true],
];

// Music groups and labels, matched in the "released" credit (year, then
// groups joined by "/"): [name, pattern]
const GROUPS = [
  ["Maniacs of Noise", /\bManiacs of Noise\b/i],
  ["Vibrants", /\bVibrants\b/i],
  ["Blues Muz'", /\bBlues Muz'/i],
  ["Artline Designs", /\bArtline Designs\b/i],
  ["MultiStyle Labs", /\bMultiStyle Labs\b/i],
  ["Side B", /\bSide B\b/i],
];
const groupOf = (t) => (t.released ?? "").replace(/^\S+\s*/, "");   // the credit after the year

// The week of `date` (local time) as a seed; weeks start on Monday.
export function weekSeed(date = new Date()) {
  const days = Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);
  return `week-${Math.floor((days + 3) / 7)}`;   // 1970-01-01 was a Thursday
}

// mulberry32 over a string hash: small, fast and good enough for shuffling.
export function seededRandom(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 1) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(list, count, rand) {
  const copy = list.slice();
  const n = Math.min(count, copy.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// A mix by id ("year-1987", "composer-<credit>", "group-<name>", or a theme
// id), or null.
export function mixDefinition(id) {
  const year = /^year-(\d{4})$/.exec(id)?.[1];
  if (year) return { id, title: `${year} mix`, note: `Released in ${year}`, label: year, icon: "calendar-outline", filter: (t) => yearOf(t) === year };
  if (id.startsWith("composer-")) {
    const credit = id.slice("composer-".length);
    const name = credit.match(/\(([^)]+)\)\s*$/)?.[1] ?? credit;   // the handle, as on the composer chips
    return { id, title: `${name} mix`, note: `Tunes by ${credit}`, label: name, icon: "person-outline", composer: credit, filter: (t) => t.author === credit };
  }
  const group = id.startsWith("group-") && GROUPS.find(([name]) => `group-${name}` === id);
  if (group) {
    const [name, pattern] = group;
    return { id, title: `${name} mix`, note: `Released by ${name}`, label: name, icon: "people-outline", filter: (t) => pattern.test(groupOf(t)) };
  }
  const theme = THEMES.find(([themeId]) => themeId === id);
  if (!theme) return null;
  const [, title, note, icon, filter] = theme;
  return { id, title, note, label: title, icon, filter };
}

// The tunes of mix `id` for `seed`: a random sample, or [] for an unknown mix.
export function mixTunes(id, tunes, seed) {
  const def = mixDefinition(id);
  return def ? sample(tunes.filter(def.filter), MIX_SIZE, seededRandom(`${seed}:${id}`)) : [];
}

// The mixes to show for `seed`: year mixes, a composer from `composers`
// (credits), a group, then themes, each with enough tunes.
export function pickMixes(tunes, composers, seed) {
  const rand = seededRandom(seed);
  const perYear = new Map();
  const perAuthor = new Map();
  for (const t of tunes) {
    const y = yearOf(t);
    if (y) perYear.set(y, (perYear.get(y) ?? 0) + 1);
    perAuthor.set(t.author, (perAuthor.get(t.author) ?? 0) + 1);
  }
  const years = [...perYear].filter(([, n]) => n >= MIN_TUNES).map(([y]) => `year-${y}`);
  const credits = composers.filter((c) => (perAuthor.get(c) ?? 0) >= MIN_TUNES).map((c) => `composer-${c}`);
  const groups = GROUPS.filter(([, pattern]) => tunes.filter((t) => pattern.test(groupOf(t))).length >= MIN_GROUP_TUNES).map(([name]) => `group-${name}`);
  const themes = THEMES.map(([id]) => id);
  return [...sample(years, YEAR_MIXES, rand), ...sample(credits, 1, rand), ...sample(groups, 1, rand), ...sample(themes, THEME_MIXES, rand)].map(mixDefinition);
}

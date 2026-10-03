// Each composer's colours, the same wherever they show: the critter on their
// page (avatars.js) and the background of every cover of their tunes
// (artwork.js). The composer's name seeds the pick; an alias counts as the name.

import "./pixelavatar.js";   // sets self.PixelAvatar, for its seeded random numbers
import { COMPOSER_ALIASES } from "./suggestions.js";

// The app accents, each with a darker one for the critter's details.
const ACCENTS = [
  ["#a99cff", "#6c5eb5"], ["#5ee0c0", "#2f9c85"], ["#ff8fb1", "#c75d82"],
  ["#ffd166", "#c79a2e"], ["#7dd3fc", "#3f8fb8"], ["#b8e986", "#7aa84f"],
];
const SURFACE = "#221d31";   // --app-surface: the base the tint goes into; plain for no known composer
// How much of the accent goes into it at each end of the tile's gradient: a
// gentle diagonal from lighter (top left) to darker, like the app's cards, in
// one hue, so a row of covers stays calm and the bright sprite stands out.
const TINT_LIGHT = 0.28;
const TINT_DARK = 0.1;
const ANGLE = 135;

// The name a composer goes by in the app: their alias, else the HVSC credit.
export const composerName = (credit) => COMPOSER_ALIASES[credit] ?? credit;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, share) => hex(rgb(a).map((v, i) => v * share + rgb(b)[i] * (1 - share)));

const cache = new Map();

// {body, accent, light, dark, angle} for a composer's name (not the raw credit;
// see composerName): body and accent their critter's colours, light and dark
// the ends of their tiles' gradient (angle in degrees). Unknown composers
// ("<?>", none) get the plain surface.
export function composerColors(name) {
  if (!name || name === "<?>") return { body: ACCENTS[0][0], accent: ACCENTS[0][1], light: SURFACE, dark: SURFACE, angle: ANGLE };
  if (!cache.has(name)) {
    const [body, accent] = ACCENTS[Math.floor(self.PixelAvatar.rng(`composer:${name}`)() * ACCENTS.length)];
    cache.set(name, { body, accent, light: mix(body, SURFACE, TINT_LIGHT), dark: mix(body, SURFACE, TINT_DARK), angle: ANGLE });
  }
  return cache.get(name);
}

// A tune's tile background, for pixelavatar's `background`, from its HVSC credit.
export function creditTint(credit) {
  const { light, dark, angle } = composerColors(credit && composerName(credit));
  return light === dark ? dark : { from: light, to: dark, angle };
}

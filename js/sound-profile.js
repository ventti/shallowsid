// Sound profiles: which SID chip/machine to emulate and how reSIDfp's filter is
// tuned. Pure functions (no DOM, no storage), so they run under `node --test`.
//
// The two chip presets are the chips reSIDfp's filter model was measured on
// (libresidfp FilterModelConfig6581/8580.cpp); every other profile is a user
// adjustment of the same knobs.

export const FILE_KIND = "shallowsid-sound-profile";
export const FILE_VERSION = 1;

// reSIDfp's built-in 6581 uCox is 20e-6; range maps to (1 + 39 * range) * 1e-6.
const DEFAULT_6581_RANGE = 19 / 39;

export const DEFAULTS = Object.freeze({
  chip: "auto",               // "auto" (tune header) | "6581" | "8580"
  machine: "auto",            // "auto" (tune header) | "PAL" | "NTSC"
  filter6581Curve: 0.5,
  filter6581Range: DEFAULT_6581_RANGE,
  filter8580Curve: 0.5,
  old6581Caps: false,
  combinedWaveforms: "AVERAGE",
  digiBoost: true,
});

export const BUILTIN_PRESETS = Object.freeze([
  { id: "follow-tune", name: "Auto-select", description: "Chip per tune", builtin: true, ...DEFAULTS },
  { id: "mos-6581r4ar-0687", name: "MOS 6581R4AR 0687 14", description: "Always 6581", builtin: true, ...DEFAULTS, chip: "6581" },
  { id: "csg-8580r5-1690", name: "CSG 8580R5 1690 25", description: "Always 8580", builtin: true, ...DEFAULTS, chip: "8580" },
]);

const CHIPS = ["auto", "6581", "8580"];
const MACHINES = ["auto", "PAL", "NTSC"];
const WAVEFORMS = ["WEAK", "AVERAGE", "STRONG"];
const SETTINGS = Object.keys(DEFAULTS);

const clamp01 = (v, fallback) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : fallback);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

// Coerce anything (stored or imported) into a valid set of settings.
export function normalizeSettings(input = {}) {
  return {
    chip: oneOf(String(input.chip ?? ""), CHIPS, DEFAULTS.chip),
    machine: oneOf(String(input.machine ?? ""), MACHINES, DEFAULTS.machine),
    filter6581Curve: clamp01(input.filter6581Curve, DEFAULTS.filter6581Curve),
    filter6581Range: clamp01(input.filter6581Range, DEFAULTS.filter6581Range),
    filter8580Curve: clamp01(input.filter8580Curve, DEFAULTS.filter8580Curve),
    old6581Caps: input.old6581Caps === true,
    combinedWaveforms: oneOf(String(input.combinedWaveforms ?? "").toUpperCase(), WAVEFORMS, DEFAULTS.combinedWaveforms),
    digiBoost: input.digiBoost !== false,
  };
}

export function settingsOf(profile) {
  return Object.fromEntries(SETTINGS.map((k) => [k, profile[k]]));
}

export function sameSettings(a, b) {
  return SETTINGS.every((k) => (typeof a[k] === "number" ? Math.abs(a[k] - b[k]) < 1e-6 : a[k] === b[k]));
}

// SidAudioEngine setEmulationConfig() / setFilterConfig() arguments.
export function toEngineConfig(settings) {
  const s = normalizeSettings(settings);
  return {
    emulation: {
      sidModel: s.chip === "8580" ? "MOS8580" : "MOS6581",
      forceSidModel: s.chip !== "auto",
      c64Model: s.machine === "NTSC" ? "NTSC" : "PAL",
      forceC64Model: s.machine !== "auto",
      digiBoost: s.digiBoost,
    },
    filter: {
      filter6581Curve: s.filter6581Curve,
      filter6581Range: s.filter6581Range,
      filter8580Curve: s.filter8580Curve,
      old6581Caps: s.old6581Caps,
      combinedWaveforms: s.combinedWaveforms,
    },
  };
}

export function serializeProfiles(profiles) {
  const list = profiles.map((p) => ({ name: p.name, ...settingsOf(normalizeSettings(p)) }));
  return JSON.stringify({ kind: FILE_KIND, version: FILE_VERSION, profiles: list }, null, 2) + "\n";
}

// Accepts our own export (one or many profiles) or a bare settings object.
export function parseProfiles(text, fallbackName = "Imported sound") {
  const data = JSON.parse(text);
  const list = Array.isArray(data?.profiles) ? data.profiles : Array.isArray(data) ? data : [data];
  const profiles = list
    .filter((p) => p && typeof p === "object")
    .map((p) => ({ name: String(p.name || fallbackName).slice(0, 80), ...normalizeSettings(p) }));
  if (!profiles.length) throw new Error("No sound profiles in that file");
  return profiles;
}

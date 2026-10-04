// Sound profiles: which SID chip/machine to emulate and how reSIDfp's filter is
// tuned. Pure functions (no DOM, no storage), so they run under `node --test`.
//
// The chip (Auto / 6581 / 8580) and machine are global settings. The knobs are
// split by chip: a preset is either a 6581 or an 8580 preset, one of each is
// selected, and the engine uses whichever matches the chip that plays.
//
// Defaults and the built-in presets everyone gets live in sid-presets.json. The
// two measured chips are the ones reSIDfp's filter model was measured on
// (libresidfp FilterModelConfig6581/8580.cpp); reSIDfp's built-in 6581 uCox is
// 20e-6, and range maps to (1 + 39 * range) * 1e-6, so the default range is 19/39.

import PRESET_FILE from "./sid-presets.json" with { type: "json" };

export const FILE_KIND = "shallowsid-sound-profile";
export const FILE_VERSION = 2;

export const PRESET_CHIPS = ["6581", "8580"];
const CHIPS = ["auto", ...PRESET_CHIPS];
const MACHINES = ["auto", "PAL", "NTSC"];
const WAVEFORMS = ["WEAK", "AVERAGE", "STRONG"];

// Where tunes play: reSIDfp (cycle-exact, tunable), SIDLite (about a tenth of
// the CPU, no filter tuning), or a real Ultimate 64 / II+ on the network.
export const ENGINES = ["residfp", "sidlite", "u64"];
export const DEFAULT_ENGINE = "residfp";
export const normalizeEngine = (v) => (ENGINES.includes(v) ? v : DEFAULT_ENGINE);

// "http://192.168.1.64/" -> "192.168.1.64"; a port stays. Anything else -> "".
export function normalizeHost(v) {
  const host = String(v ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) || /^\[[0-9a-f:]+\](:\d{1,5})?$/i.test(host) ? host : "";
}

// The knobs each chip's presets hold.
export const CHIP_KNOBS = Object.freeze({
  6581: ["filter6581Curve", "filter6581Range", "old6581Caps", "combinedWaveforms"],
  8580: ["filter8580Curve", "digiBoost", "combinedWaveforms"],
});

export const DEFAULTS = Object.freeze({ ...PRESET_FILE.defaults });

const clamp01 = (v, fallback) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : fallback);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);

const KNOB = {
  filter6581Curve: (v) => clamp01(v, DEFAULTS.filter6581Curve),
  filter6581Range: (v) => clamp01(v, DEFAULTS.filter6581Range),
  filter8580Curve: (v) => clamp01(v, DEFAULTS.filter8580Curve),
  old6581Caps: (v) => bool(v, DEFAULTS.old6581Caps),
  digiBoost: (v) => bool(v, DEFAULTS.digiBoost),
  combinedWaveforms: (v) => oneOf(String(v ?? "").toUpperCase(), WAVEFORMS, DEFAULTS.combinedWaveforms),
};

// Coerce anything (stored or imported) into a valid set of one chip's knobs.
export function normalizeKnobs(chip, input = {}) {
  return Object.fromEntries(CHIP_KNOBS[chip].map((k) => [k, KNOB[k](input[k])]));
}

// The global part: chip and machine.
export function normalizeGlobal(input = {}) {
  return {
    chip: oneOf(String(input.chip ?? ""), CHIPS, DEFAULTS.chip),
    machine: oneOf(String(input.machine ?? ""), MACHINES, DEFAULTS.machine),
  };
}

// A preset as stored: {chip, ...that chip's knobs}.
export function normalizePreset(input = {}) {
  const chip = oneOf(String(input.chip ?? ""), PRESET_CHIPS, "6581");
  return { chip, ...normalizeKnobs(chip, input) };
}

export function sameKnobs(chip, a, b) {
  return CHIP_KNOBS[chip].every((k) => (typeof a[k] === "number" ? Math.abs(a[k] - b[k]) < 1e-6 : a[k] === b[k]));
}

// Presets from before the chip split held every knob plus chip "auto"/"6581"/"8580".
// A chip one stays that chip's preset; an "auto" one becomes one of each, with
// ids derived from its own so every device migrates it the same way.
export function splitLegacy(p) {
  if (PRESET_CHIPS.includes(String(p.chip))) return [{ ...p, ...normalizePreset(p) }];
  return PRESET_CHIPS.map((chip) => ({
    ...p, ...(p.id ? { id: `${p.id}-${chip}` } : {}), name: `${p.name} (${chip})`, chip, ...normalizeKnobs(chip, p),
  }));
}

export const BUILTIN_PRESETS = Object.freeze(PRESET_FILE.profiles.map((p) => Object.freeze({
  id: String(p.id), name: String(p.name), builtin: true, ...normalizePreset({ ...DEFAULTS, ...p }),
})));

// The preset each chip starts with.
export const DEFAULT_PRESET = Object.freeze(Object.fromEntries(PRESET_CHIPS.map((chip) => [chip, DEFAULTS[`preset${chip}`]])));

// SidAudioEngine setEmulationConfig() / setFilterConfig() arguments from
// {chip, machine, 6581: knobs, 8580: knobs}. Combined waveforms is one engine
// setting but a per-chip knob: see filterFor().
export function toEngineConfig(sound) {
  const g = normalizeGlobal(sound);
  const k6581 = normalizeKnobs("6581", sound[6581]);
  const k8580 = normalizeKnobs("8580", sound[8580]);
  return {
    emulation: {
      sidModel: g.chip === "8580" ? "MOS8580" : "MOS6581",
      forceSidModel: g.chip !== "auto",
      c64Model: g.machine === "NTSC" ? "NTSC" : "PAL",
      forceC64Model: g.machine !== "auto",
      digiBoost: k8580.digiBoost,
    },
    filter: {
      filter6581Curve: k6581.filter6581Curve,
      filter6581Range: k6581.filter6581Range,
      filter8580Curve: k8580.filter8580Curve,
      old6581Caps: k6581.old6581Caps,
    },
    combinedWaveforms: { MOS6581: k6581.combinedWaveforms, MOS8580: k8580.combinedWaveforms },
  };
}

// The filter config for the chip that actually plays: the forced one, else the
// one the tune declares (libsidplayfp's TuneSidModel), else the assumed one.
export function filterFor(config, tuneSidModel) {
  const { sidModel, forceSidModel } = config.emulation;
  const chip = !forceSidModel && (tuneSidModel === "MOS6581" || tuneSidModel === "MOS8580") ? tuneSidModel : sidModel;
  return { ...config.filter, combinedWaveforms: config.combinedWaveforms[chip] };
}

export function serializeProfiles(profiles) {
  const list = profiles.map((p) => ({ name: p.name, ...normalizePreset(p) }));
  return JSON.stringify({ kind: FILE_KIND, version: FILE_VERSION, profiles: list }, null, 2) + "\n";
}

// Accepts our own export (one or many profiles, either version) or a bare settings object.
export function parseProfiles(text, fallbackName = "Imported sound") {
  const data = JSON.parse(text);
  const list = Array.isArray(data?.profiles) ? data.profiles : Array.isArray(data) ? data : [data];
  const profiles = list
    .filter((p) => p && typeof p === "object")
    .flatMap((p) => splitLegacy({ ...p, name: String(p.name || fallbackName) }))
    .map((p) => ({ name: p.name.slice(0, 80), ...normalizePreset(p) }));
  if (!profiles.length) throw new Error("No sound profiles in that file");
  return profiles;
}

// The sound setup and the user's own presets, kept in localStorage.
//
// Chip and machine are global. One 6581 and one 8580 preset are selected at a
// time; the engine uses whichever matches the chip that plays. Built-in presets
// are read-only: adjusting one creates an unsaved "edited" draft for its chip
// that can be saved as a new preset. The user's presets are edited in place and
// saved automatically, like iOS settings.

import {
  BUILTIN_PRESETS, DEFAULT_PRESET, PRESET_CHIPS, DEFAULT_ENGINE, normalizeEngine, normalizeGlobal, normalizeHost, normalizeKnobs, normalizePreset,
  parseProfiles, serializeProfiles, splitLegacy,
} from "./sound-profile.js";

const STORAGE_KEY = "shallowsid.sound";
const STATE_VERSION = 2;

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

const perChip = (fn) => Object.fromEntries(PRESET_CHIPS.map((chip) => [chip, fn(chip)]));
const knobsOf = (preset) => normalizeKnobs(preset.chip, preset);
const stripUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function userPresets(list = []) {
  return list.flatMap(splitLegacy).map((p) => ({ id: String(p.id), name: String(p.name), updated: p.updated, ...normalizePreset(p) }));
}

// Before the chip split one preset was active and carried the chip and machine.
function legacySelection(activeId, legacyPresets = []) {
  const builtin = { "follow-tune": "auto", [DEFAULT_PRESET[6581]]: "6581", [DEFAULT_PRESET[8580]]: "8580" };
  if (activeId in builtin) return { chip: builtin[activeId], selected: {} };
  const p = legacyPresets.find((x) => String(x.id) === String(activeId));
  if (!p) return { selected: {} };
  const split = splitLegacy(p);
  return { ...normalizeGlobal(p), selected: Object.fromEntries(split.map((s) => [s.chip, String(s.id)])) };
}

export class SoundSettings extends EventTarget {
  constructor() {
    super();
    const saved = load();
    const legacy = saved.v === STATE_VERSION ? null : legacySelection(saved.activeId, saved.presets);
    this.presets = userPresets(saved.presets);
    ({ chip: this.chip, machine: this.machine } = normalizeGlobal(legacy ?? saved));
    this.selected = perChip((chip) => this.validId(chip, (legacy ?? saved).selected?.[chip]));
    this.drafts = perChip((chip) => (legacy || !saved.drafts?.[chip] ? null : normalizeKnobs(chip, saved.drafts[chip])));
    this.prerender = saved.prerender !== false;   // playback preference, not part of a profile
    // Per device, so not synced: another device may lack the CPU or the Ultimate.
    this.engine = normalizeEngine(saved.engine);
    this.u64Host = normalizeHost(saved.u64Host);
    // Picked in the Sound sheet. Until then the app may switch to SIDLite on a slow device.
    this.engineChosen = saved.engineChosen ?? this.engine !== DEFAULT_ENGINE;
    this.renderSpeed = Number(saved.renderSpeed) || 0;   // reSIDfp's measured speed (x realtime), 0: not yet
  }

  find(id) {
    return BUILTIN_PRESETS.find((p) => p.id === id) ?? this.presets.find((p) => p.id === id) ?? null;
  }

  validId(chip, id) {
    return this.find(id)?.chip === chip ? id : DEFAULT_PRESET[chip];
  }

  presetsFor(chip) {
    return { builtin: BUILTIN_PRESETS.filter((p) => p.chip === chip), mine: this.presets.filter((p) => p.chip === chip) };
  }

  // The selected preset of a chip.
  preset(chip) {
    return this.find(this.selected[chip]);
  }

  knobs(chip) {
    return this.drafts[chip] ?? knobsOf(this.preset(chip));
  }

  // The settings in effect right now: {chip, machine, 6581: knobs, 8580: knobs}.
  get current() {
    return { chip: this.chip, machine: this.machine, ...perChip((chip) => this.knobs(chip)) };
  }

  isEdited(chip) {
    return !!this.drafts[chip];
  }

  get anyEdited() {
    return PRESET_CHIPS.some((chip) => this.isEdited(chip));
  }

  // Chip and/or machine.
  setGlobal(partial) {
    ({ chip: this.chip, machine: this.machine } = normalizeGlobal({ chip: this.chip, machine: this.machine, ...partial }));
    this.save();
  }

  select(id) {
    const p = this.find(id);
    if (!p) return;
    this.selected[p.chip] = id;
    this.drafts[p.chip] = null;
    this.save();
  }

  update(chip, partial) {
    const next = normalizeKnobs(chip, { ...this.knobs(chip), ...partial });
    const preset = this.preset(chip);
    if (preset.builtin) this.drafts[chip] = next;
    else Object.assign(preset, next, { updated: Date.now() });
    this.save();
  }

  setPrerender(on) {
    this.prerender = !!on;
    this.save();
  }

  setEngine(engine) {
    this.engine = normalizeEngine(engine);
    this.engineChosen = true;
    this.save();
  }

  // The app's own pick, unless one was made by hand. True if it changed.
  autoEngine(engine) {
    engine = normalizeEngine(engine);
    if (this.engineChosen || engine === this.engine) return false;
    this.engine = engine;
    this.save();
    return true;
  }

  setRenderSpeed(ratio) {
    this.renderSpeed = Math.round(ratio * 100) / 100;
    this.save();
  }

  setU64Host(host) {
    this.u64Host = normalizeHost(host);
    this.save();
  }

  // Drop unsaved edits of built-in presets (one chip's, or both).
  revert(chip) {
    for (const c of chip ? [chip] : PRESET_CHIPS) this.drafts[c] = null;
    this.save();
  }

  saveAsNew(chip, name) {
    const preset = { id: crypto.randomUUID().slice(0, 8), name: name.trim() || `My ${chip}`, chip, ...this.knobs(chip), updated: Date.now() };
    this.presets.push(preset);
    this.selected[chip] = preset.id;
    this.drafts[chip] = null;
    this.save();
    return preset;
  }

  rename(id, name) {
    const p = this.presets.find((x) => x.id === id);
    if (p && name.trim()) {
      p.name = name.trim();
      p.updated = Date.now();
      this.save();
    }
  }

  remove(id) {
    const p = this.presets.find((x) => x.id === id);
    if (!p) return;
    this.presets = this.presets.filter((x) => x !== p);
    if (this.selected[p.chip] === id) {
      this.selected[p.chip] = DEFAULT_PRESET[p.chip];
      this.drafts[p.chip] = null;
    }
    this.save();
  }

  exportText(ids) {
    return serializeProfiles(this.presets.filter((p) => ids.includes(p.id)));
  }

  // Adds the file's profiles as new presets; returns the ones added.
  importText(text, fallbackName) {
    const added = parseProfiles(text, fallbackName).map((p) => ({ ...p, id: crypto.randomUUID().slice(0, 8), updated: Date.now() }));
    this.presets.push(...added);
    this.save();
    return added;
  }

  // What sync.js keeps in the synced prefs.
  get syncPrefs() {
    return { soundChip: this.chip, soundMachine: this.machine, sound6581: this.selected[6581], sound8580: this.selected[8580], prerender: this.prerender };
  }

  // Replace presets and preferences with synced data (see sync.js).
  applySynced({ presets, prefs = {} }) {
    this.presets = userPresets(presets);
    const legacy = prefs.soundChip === undefined && prefs.soundActiveId ? legacySelection(prefs.soundActiveId, presets) : null;
    const synced = legacy ?? { chip: prefs.soundChip, machine: prefs.soundMachine, selected: { 6581: prefs.sound6581, 8580: prefs.sound8580 } };
    if (synced.chip !== undefined || synced.machine !== undefined) {
      ({ chip: this.chip, machine: this.machine } = normalizeGlobal({ chip: this.chip, machine: this.machine, ...stripUndefined(synced) }));
    }
    for (const chip of PRESET_CHIPS) {
      const id = synced.selected[chip] && this.find(synced.selected[chip])?.chip === chip ? synced.selected[chip] : this.selected[chip];
      if (id !== this.selected[chip]) this.drafts[chip] = null;
      this.selected[chip] = this.validId(chip, id);
    }
    if (typeof prefs.prerender === "boolean") this.prerender = prefs.prerender;
    this.save();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: STATE_VERSION, chip: this.chip, machine: this.machine, selected: this.selected, drafts: this.drafts, presets: this.presets, prerender: this.prerender,
        engine: this.engine, u64Host: this.u64Host, engineChosen: this.engineChosen, renderSpeed: this.renderSpeed,
      }));
    } catch {
      // storage blocked: settings last for this session only
    }
    this.dispatchEvent(new Event("change"));
  }
}

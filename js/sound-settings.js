// The selected sound profile and the user's own presets, kept in localStorage.
//
// Built-in presets are read-only: adjusting one creates an unsaved "edited"
// draft that can be saved as a new preset. The user's presets are edited in
// place and saved automatically, like iOS settings.

import { BUILTIN_PRESETS, normalizeSettings, parseProfiles, serializeProfiles, settingsOf } from "./sound-profile.js";

const STORAGE_KEY = "shallowsid.sound";

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

export class SoundSettings extends EventTarget {
  constructor() {
    super();
    const saved = load();
    this.presets = (saved.presets ?? []).map((p) => ({ id: String(p.id), name: String(p.name), updated: p.updated, ...normalizeSettings(p) }));
    this.activeId = this.find(saved.activeId) ? saved.activeId : BUILTIN_PRESETS[0].id;
    this.draft = saved.draft ? normalizeSettings(saved.draft) : null;   // unsaved edit of a built-in
    this.prerender = saved.prerender !== false;   // playback preference, not part of a profile
  }

  find(id) {
    return BUILTIN_PRESETS.find((p) => p.id === id) ?? this.presets.find((p) => p.id === id) ?? null;
  }

  get preset() {
    return this.find(this.activeId) ?? BUILTIN_PRESETS[0];
  }

  // The settings in effect right now.
  get current() {
    return this.draft ?? settingsOf(this.preset);
  }

  get isEdited() {
    return !!this.draft;
  }

  select(id) {
    if (!this.find(id)) return;
    this.activeId = id;
    this.draft = null;
    this.save();
  }

  update(partial) {
    const next = normalizeSettings({ ...this.current, ...partial });
    const preset = this.preset;
    if (preset.builtin) this.draft = next;
    else Object.assign(preset, next, { updated: Date.now() });
    this.save();
  }

  setPrerender(on) {
    this.prerender = !!on;
    this.save();
  }

  // Drop unsaved edits (built-in) or restore defaults of the chip preset it was based on.
  revert() {
    this.draft = null;
    this.save();
  }

  saveAsNew(name) {
    const preset = { id: crypto.randomUUID().slice(0, 8), name: name.trim() || "My sound", ...this.current, updated: Date.now() };
    this.presets.push(preset);
    this.activeId = preset.id;
    this.draft = null;
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
    this.presets = this.presets.filter((p) => p.id !== id);
    if (this.activeId === id) {
      this.activeId = BUILTIN_PRESETS[0].id;
      this.draft = null;
    }
    this.save();
  }

  exportText(ids) {
    return serializeProfiles(this.presets.filter((p) => ids.includes(p.id)));
  }

  // Adds the file's profiles as new presets; returns how many were added.
  importText(text, fallbackName) {
    const added = parseProfiles(text, fallbackName).map((p) => ({ ...p, id: crypto.randomUUID().slice(0, 8), updated: Date.now() }));
    this.presets.push(...added);
    this.save();
    return added;
  }

  // Replace presets and preferences with synced data (see sync.js).
  applySynced({ presets, activeId, prerender }) {
    this.presets = presets.map((p) => ({ id: String(p.id), name: String(p.name), updated: p.updated, ...normalizeSettings(p) }));
    if (activeId && this.find(activeId) && activeId !== this.activeId) {
      this.activeId = activeId;
      this.draft = null;
    } else if (!this.find(this.activeId)) {
      this.activeId = BUILTIN_PRESETS[0].id;
      this.draft = null;
    }
    if (typeof prerender === "boolean") this.prerender = prerender;
    this.save();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeId: this.activeId, draft: this.draft, presets: this.presets, prerender: this.prerender }));
    } catch {
      // storage blocked: settings last for this session only
    }
    this.dispatchEvent(new Event("change"));
  }
}

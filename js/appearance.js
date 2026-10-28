const STORAGE_KEY = "shallowsid.appearance";
export const DEFAULT_HUE = 248;
const validHue = (hue) => Number.isInteger(hue) && hue >= 0 && hue <= 360;

// Keep the original lavender's brightness and saturation as the hue changes.
export function accentRgb(hue) {
  const sector = (validHue(hue) ? hue : DEFAULT_HUE) / 60;
  const secondary = 99 * (1 - Math.abs(sector % 2 - 1));
  return [[99, secondary, 0], [secondary, 99, 0], [0, 99, secondary],
    [0, secondary, 99], [secondary, 0, 99], [99, 0, secondary]][Math.floor(sector) % 6]
    .map((v) => Math.round(156 + v));
}

export class AppearanceSettings extends EventTarget {
  constructor() {
    super();
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      // Unreadable or blocked storage: start with lavender.
    }
    this.hue = validHue(saved?.accentHue) ? saved.accentHue : DEFAULT_HUE;
  }

  setHue(hue) {
    if (!validHue(hue) || hue === this.hue) return;
    this.hue = hue;
    this.save();
  }

  get syncPrefs() {
    return { accentHue: this.hue };
  }

  applySynced(prefs = {}) {
    this.setHue(prefs.accentHue);
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.syncPrefs));
    } catch {
      // Storage blocked: keep the choice for this session.
    }
    this.dispatchEvent(new Event("change"));
  }
}

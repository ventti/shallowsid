// Loads data/index.json (built by tools/build_index.py) into tune objects.
//
// Row layout: [dir, name, title, author, released, songs, start, flags, lengths, bpm, speed, sid]
// with `dir` and `author` as indexes into the shared string tables. The last
// three are per subtune and may be missing: bpm the estimated tempo (0 = none;
// tools/bpm/estimates.tsv), speed the play calls a frame and sid the SID_* bits
// (tools/sidfeatures/features.tsv; speed 0 = none shown, sid 0 = not analysed).

const FLAG_RSID = 1 << 0;
const FLAG_MULTI_SID = 1 << 5;
// The per-subtune "sid" column's bits, as tools/build_index.py writes them.
const SID = { analysed: 1 << 0, filter: 1 << 1, ring: 1 << 2, sync: 1 << 3, digi: 1 << 4, basic: 1 << 5, cia: 1 << 6, custom: 1 << 7 };
const CLOCKS = ["", "PAL", "NTSC", "PAL/NTSC"];
const MODELS = ["", "6581", "8580", "6581/8580"];

export const INDEX_URL = new URL("../data/index.json", import.meta.url).href;

export function decodeRow(row, id, dirs, authors) {
  const [dirIdx, name, title, authorIdx, released, songs, start, flags, lengths, bpm, speed, sid] = row;
  const dir = dirs[dirIdx];
  return {
    id,
    dir,
    name,
    path: dir ? `${dir}/${name}` : name,
    title: title || name.replace(/\.sid$/i, "").replace(/_/g, " "),
    author: authors[authorIdx],
    released,
    songs,
    start,
    lengths,
    bpmEstimates: bpm ?? [],
    speeds: speed ?? [],
    sidBits: sid ?? [],
    rsid: !!(flags & FLAG_RSID),
    multiSid: !!(flags & FLAG_MULTI_SID),
    clock: CLOCKS[(flags >> 1) & 3],
    model: MODELS[(flags >> 3) & 3],
  };
}

// What tools/sidfeatures found for one subtune of a tune (or a queue item):
// {speed, filter, ring, sync, digi, basic, cia, custom}, speed null when none is
// shown, or null when it wasn't analysed.
export function sidFeatures(tune, song) {
  const bits = tune?.sidBits?.[song - 1] ?? 0;
  if (!(bits & SID.analysed)) return null;
  const has = (name) => !!(bits & SID[name]);
  return {
    speed: tune.speeds?.[song - 1] || null,
    filter: has("filter"), ring: has("ring"), sync: has("sync"), digi: has("digi"),
    basic: has("basic"), cia: has("cia"), custom: has("custom"),
  };
}

// Downloads the catalogue once. `onText` gets the raw JSON first, so the search
// worker can start indexing while this thread decodes it.
export async function loadIndex({ onText } = {}) {
  const res = await fetch(INDEX_URL);
  if (!res.ok) throw new Error(`Could not load the HVSC index (HTTP ${res.status})`);
  const text = await res.text();
  onText?.(text);
  const data = JSON.parse(text);
  const tunes = data.files.map((row, id) => decodeRow(row, id, data.dirs, data.authors));
  return new IndexStore(data.v, tunes, data.dirs);
}

export class IndexStore {
  constructor(version, tunes, dirs) {
    this.version = version;
    this.tunes = tunes;
    this.byPath = new Map(tunes.map((t) => [t.path, t]));
    this.tunesByDir = new Map();
    for (const t of tunes) {
      if (!this.tunesByDir.has(t.dir)) this.tunesByDir.set(t.dir, []);
      this.tunesByDir.get(t.dir).push(t);
    }
    this.childDirs = buildDirTree(dirs);
  }

  get(path) {
    return this.byPath.get(path.replace(/^\/+/, "")) ?? null;
  }

  // Sub-folders and tunes directly inside `dir` ("" is the HVSC root).
  list(dir) {
    return {
      dirs: [...(this.childDirs.get(dir) ?? [])].sort((a, b) => a.localeCompare(b)),
      tunes: this.tunesByDir.get(dir) ?? [],
    };
  }
}

function buildDirTree(dirs) {
  const children = new Map();
  for (const dir of dirs) {
    const parts = dir.split("/");
    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      const child = parts.slice(0, i + 1).join("/");
      if (!children.has(parent)) children.set(parent, new Set());
      children.get(parent).add(child);
    }
  }
  return children;
}

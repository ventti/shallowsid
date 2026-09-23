// Loads data/index.json (built by tools/build_index.py) into tune objects.
//
// Row layout: [dir, name, title, author, released, songs, start, flags, lengths]
// with `dir` and `author` as indexes into the shared string tables.

const FLAG_RSID = 1 << 0;
const FLAG_MULTI_SID = 1 << 5;
const CLOCKS = ["", "PAL", "NTSC", "PAL/NTSC"];
const MODELS = ["", "6581", "8580", "6581/8580"];

export const INDEX_URL = new URL("../data/index.json", import.meta.url).href;

export function decodeRow(row, id, dirs, authors) {
  const [dirIdx, name, title, authorIdx, released, songs, start, flags, lengths] = row;
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
    rsid: !!(flags & FLAG_RSID),
    multiSid: !!(flags & FLAG_MULTI_SID),
    clock: CLOCKS[(flags >> 1) & 3],
    model: MODELS[(flags >> 3) & 3],
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

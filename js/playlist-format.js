// Playlist (de)serialisation. Pure functions, no DOM, so they run under
// `node --test` as well as in the browser.
//
// A playlist is {name, items: [{path, song}]}, where `path` is relative to the
// HVSC C64Music root (e.g. "MUSICIANS/H/Hubbard_Rob/Commando.sid") and `song`
// is the 1-based subtune.

const SUBTUNE_TAG = "#EXTSID:subtune=";

// meta(path) -> {title, author, seconds} for nicer #EXTINF lines (optional).
export function toM3U8(playlist, { baseUrl, meta = () => null }) {
  const lines = ["#EXTM3U", `#PLAYLIST:${oneLine(playlist.name)}`];
  for (const { path, song } of playlist.items) {
    const m = meta(path, song);
    const label = m ? `${m.author} - ${m.title}${song > 1 ? ` (#${song})` : ""}` : path;
    lines.push(`#EXTINF:${m?.seconds ?? -1},${oneLine(label)}`);
    lines.push(`${SUBTUNE_TAG}${song}`);
    lines.push(new URL(encodePath(path), baseUrl).href);
  }
  return lines.join("\n") + "\n";
}

export function parseM3U8(text, fallbackName = "Imported playlist") {
  let name = fallbackName;
  let pendingSong = null;
  const items = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#PLAYLIST:")) {
      name = line.slice("#PLAYLIST:".length).trim() || name;
    } else if (line.startsWith(SUBTUNE_TAG)) {
      pendingSong = parseInt(line.slice(SUBTUNE_TAG.length), 10) || null;
    } else if (!line.startsWith("#")) {
      const { path, song } = normalizeEntry(line);
      if (path) items.push({ path, song: pendingSong ?? song ?? 1 });
      pendingSong = null;
    }
  }
  return { name, items };
}

// Accepts absolute URLs (…/hvsc/MUSICIANS/…), "hvsc/…", "/MUSICIANS/…",
// Windows separators and "?subtune=N" / "#N" suffixes.
export function normalizeEntry(entry) {
  let s = entry.replace(/\\/g, "/");
  let song = null;
  const suffix = s.match(/(?:[?&]subtune=|#)(\d+)$/);
  if (suffix) {
    song = parseInt(suffix[1], 10);
    s = s.slice(0, suffix.index);
  }
  s = s.replace(/^[a-z]+:\/\/[^/]+/i, "");       // drop scheme + host
  for (const root of [/(?:^|\/)C64Music\//i, /(?:^|\/)hvsc\//i]) {
    const m = s.match(root);
    if (m) {
      s = s.slice(m.index + m[0].length);
      break;
    }
  }
  s = s.replace(/^\/+/, "");
  try {
    s = decodeURIComponent(s);
  } catch {
    // leave undecodable paths as they are
  }
  return { path: /\.sid$/i.test(s) ? s : null, song };
}

export async function encodeShare(playlist) {
  const json = JSON.stringify({ n: playlist.name, t: playlist.items.map(({ path, song }) => (song > 1 ? [path, song] : path)) });
  const packed = await transform(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
  return toBase64Url(packed);
}

export async function decodeShare(blob) {
  const packed = fromBase64Url(blob);
  const json = new TextDecoder().decode(await transform(packed, new DecompressionStream("deflate-raw")));
  const data = JSON.parse(json);
  return {
    name: String(data.n || "Shared playlist"),
    items: (data.t || []).map((t) => (Array.isArray(t) ? { path: String(t[0]), song: Number(t[1]) || 1 } : { path: String(t), song: 1 })),
  };
}

const FILE_PREFIX = "ShallowSID - ";

// "ShallowSID - Hubbard classics.m3u8": recognisable in iCloud/Drive/Dropbox,
// and free of characters that file systems or cloud drives reject.
export function safeFileName(name) {
  const clean = name.replace(/[^\p{L}\p{N}\-_ .,'()&]/gu, " ").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
  return `${FILE_PREFIX}${clean || "Playlist"}.m3u8`;
}

// Playlist name implied by a file name, for files without a #PLAYLIST line.
export function nameFromFileName(fileName) {
  const base = fileName.replace(/\.m3u8?$/i, "");
  return (base.startsWith(FILE_PREFIX) ? base.slice(FILE_PREFIX.length) : base).trim() || "Imported playlist";
}

function oneLine(s) {
  return String(s).replace(/[\r\n]+/g, " ");
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function transform(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

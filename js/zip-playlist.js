// ZIP contents stay in memory. Only matching catalogue paths enter a playlist.
const MAX_ARCHIVE = 128 * 1024 * 1024;
const MAX_SID = 1024 * 1024;
const MAX_TOTAL = 128 * 1024 * 1024;

export async function sidHash(bytes) {
  // Ignore only the three 32-byte display fields (0x16..0x75).
  // Playback settings and all music data remain part of the fingerprint.
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (bytes.length >= 0x76 && (magic === "PSID" || magic === "RSID")) {
    const content = new Uint8Array(bytes.length - 96);
    content.set(bytes.subarray(0, 0x16));
    content.set(bytes.subarray(0x76), 0x16);
    bytes = content;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  return btoa(String.fromCharCode(...digest));
}

// Read central-directory sizes so archives using ZIP data descriptors work too.
// Reject ZIP64, encrypted entries, and oversized output before decompressing.
export async function* zipSids(bytes) {
  if (bytes.byteLength > MAX_ARCHIVE) throw new Error("ZIP is too large (maximum 128 MB)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = () => { throw new Error("Invalid or unsupported ZIP file"); };
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  }
  if (end < Math.max(0, bytes.length - 65557)) fail();
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count === 65535 || view.getUint16(end + 8, true) !== count) fail();
  let pos = view.getUint32(end + 16, true);
  const directoryEnd = pos + view.getUint32(end + 12, true);
  if (directoryEnd > end) fail();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > directoryEnd || view.getUint32(pos, true) !== 0x02014b50) fail();
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const packed = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameSize = view.getUint16(pos + 28, true);
    const offset = view.getUint32(pos + 42, true);
    const next = pos + 46 + nameSize + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
    if (next > directoryEnd) fail();
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameSize));
    pos = next;
    if (!/\.sid$/i.test(name) || name.startsWith("__MACOSX/") || name.split("/").at(-1).startsWith("._")) continue;
    if (flags & 1) throw new Error("Encrypted ZIP files aren't supported");
    if (size > MAX_SID || (total += size) > MAX_TOTAL) throw new Error("ZIP contains too much SID data");
    if (offset + 30 > directoryEnd || view.getUint32(offset, true) !== 0x04034b50) fail();
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    if (start + packed > directoryEnd) fail();
    const input = bytes.subarray(start, start + packed);
    let data;
    if (method === 0) data = input;
    else if (method === 8) {
      const reader = new Blob([input]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      data = new Uint8Array(size);
      let written = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (written + value.length > size) fail();
          data.set(value, written);
          written += value.length;
        }
        if (written !== size) fail();
      } finally { await reader.cancel(); }
    } else throw new Error("ZIP uses an unsupported compression method");
    if (data.length !== size) fail();
    yield { name, data };
  }
}

export async function matchZip(file, index) {
  if (file.size > MAX_ARCHIVE) throw new Error("ZIP is too large (maximum 128 MB)");
  const byHash = new Map();
  for (const tune of index.tunes) {
    if (!tune.hash) continue;
    const matches = byHash.get(tune.hash) ?? [];
    matches.push(tune);
    byHash.set(tune.hash, matches);
  }
  if (!byHash.size) throw new Error("Reload after the song catalogue has been updated to support ZIP imports");
  const items = [];
  let skipped = 0;
  for await (const { name, data } of zipSids(new Uint8Array(await file.arrayBuffer()))) {
    const matches = byHash.get(await sidHash(data)) ?? [];
    // Identical files can have multiple catalogue paths. Prefer the original
    // path when present; otherwise use the first catalogue entry consistently.
    const normalized = name.replace(/\\/g, "/");
    const tune = matches.find((t) => normalized === t.path || normalized.endsWith(`/${t.path}`)) ?? matches[0];
    if (tune) items.push({ path: tune.path, song: tune.start || 1 });
    else skipped++;
  }
  return { items, skipped };
}

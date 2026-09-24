// Unlisted "anyone with the link" playlists: ids, owner proofs, and strict
// validation of everything read back. Pure WebCrypto, so it runs in browsers
// and under `node --test`.
//
// A shared list lives at lists/<id>. Only its owner may change it: the doc
// stores owner = sha256(token_n), and an update must carry proof = token_n and
// set owner = sha256(token_n+1). token_n = HMAC-SHA-256(seed, "n"), so a proof
// that becomes public after use says nothing about the next one. The seed
// stays with the owner's playlist (and syncs, encrypted, to their devices).

export const MAX_NAME = 80;
export const MAX_ITEMS = 1000;
export const MAX_SONG = 256;
const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";   // no 0/o, 1/l/i
export const ID_PATTERN = /^[a-hj-np-z2-9]{12}$/;
const enc = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function newListId() {
  // 12 symbols from 31: ~59 bits, unguessable enough for "anyone with the link".
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

export function newSeed() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function tokenFor(seedHex, n) {
  const key = await crypto.subtle.importKey("raw", enc.encode(seedHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(String(n))));
}

// sha256 over the token's text, as Firestore rules compute it: hashing.sha256(string).
export async function ownerHash(token) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(token)));
}

// ---- sanitising what we show or store ----------------------------------------

// Control characters, bidi overrides/isolates, zero-width and other invisible
// format characters are dropped; whitespace is collapsed; length is capped.
export function sanitizeName(value, fallback = "Shared playlist") {
  const clean = (typeof value === "string" ? value : "")
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\u2028\u2029]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const capped = [...clean].slice(0, MAX_NAME).join("").trim();
  return capped || fallback;
}

// A real HVSC path: known top folder, no parent segments, no markup or control characters.
const PATH = /^(?:MUSICIANS|GAMES|DEMOS)\/(?:[^/\\<>"'`\p{Cc}\p{Cf}]+\/)*[^/\\<>"'`\p{Cc}\p{Cf}]+\.sid$/u;

export function isValidPath(path) {
  return typeof path === "string" && path.length <= 255 && PATH.test(path) && !path.split("/").some((seg) => seg === "." || seg === "..");
}

// `exists(path)` lets the caller require that the tune is in the catalogue.
export function sanitizeItems(items, exists = () => true, max = MAX_ITEMS) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items.slice(0, max)) {
    const path = typeof item === "string" ? item : item?.path;
    const song = Number.isInteger(item?.song) && item.song >= 1 && item.song <= MAX_SONG ? item.song : 1;
    if (isValidPath(path) && exists(path)) out.push({ path, song });
  }
  return out;
}

// The public document's content, as the owner publishes it.
export function encodeList(playlist) {
  return JSON.stringify({ name: sanitizeName(playlist.name), items: sanitizeItems(playlist.items).map(({ path, song }) => (song > 1 ? [path, song] : path)) });
}

// Parse a public document's content defensively: anything unexpected is dropped.
export function decodeList(text, exists) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (data.deleted === true) return { deleted: true };
  const items = (Array.isArray(data.items) ? data.items : []).map((t) => (Array.isArray(t) ? { path: t[0], song: t[1] } : { path: t, song: 1 }));
  return { name: sanitizeName(data.name), items: sanitizeItems(items, exists) };
}

// A pasted playlist link -> {kind: "live", id} | {kind: "snapshot", blob} | null.
// Only the part after "#" is read, so the host doesn't matter and is never
// visited; a bare live-list id is accepted too.
const SNAPSHOT_BLOB = /^[A-Za-z0-9_-]{8,60000}$/;

export function parsePlaylistLink(text) {
  const input = String(text ?? "").trim();
  if (ID_PATTERN.test(input.toLowerCase())) return { kind: "live", id: input.toLowerCase() };
  const hash = input.includes("#") ? input.slice(input.indexOf("#") + 1) : "";
  const live = hash.match(/^\/?p\/([^/?#]+)$/);
  if (live && ID_PATTERN.test(live[1].toLowerCase())) return { kind: "live", id: live[1].toLowerCase() };
  const snapshot = hash.match(/^\/?share\/([^/?#]+)$/);
  if (snapshot && SNAPSHOT_BLOB.test(snapshot[1])) return { kind: "snapshot", blob: snapshot[1] };
  return null;
}

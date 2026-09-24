// Sync key handling and end-to-end encryption. Pure WebCrypto, so it runs in
// browsers and under `node --test`.
//
// The sync key (128 random bits) never leaves the device. From it we derive,
// with HKDF-SHA-256:
//   - the document id (64 hex chars) the backend stores the data under, and
//   - an AES-256-GCM key that encrypts the data before upload.
// The backend therefore only ever sees an opaque id and ciphertext.

const KEY_BYTES = 16;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // Crockford-ish: no 0/O, 1/I
const GROUP = 4;
const enc = new TextEncoder();

export function generateKey() {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

// 128 bits -> 26 symbols of 5 bits, shown as "ABCD-EFGH-…".
export function formatKey(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xfff;   // at most 12 pending bits
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.match(new RegExp(`.{1,${GROUP}}`, "g")).join("-");
}

// Accepts any case, spaces or dashes. The alphabet has no 0/O or 1/I to confuse.
export function parseKey(text) {
  const symbols = String(text).toUpperCase().replace(/[\s-]/g, "");
  if (symbols.length !== 26) throw new Error("A sync key has 26 letters and digits");
  const bytes = [];
  let bits = 0, value = 0;
  for (const ch of symbols) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`“${ch}” is not part of a sync key`);
    value = ((value << 5) | i) & 0xfff;   // at most 12 pending bits
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes.slice(0, KEY_BYTES));
}

async function hkdfBase(keyBytes) {
  return crypto.subtle.importKey("raw", keyBytes, "HKDF", false, ["deriveBits", "deriveKey"]);
}

const hkdf = (info) => ({ name: "HKDF", hash: "SHA-256", salt: enc.encode("shallowsid-sync-v1"), info: enc.encode(info) });

export async function deriveVault(keyBytes) {
  const base = await hkdfBase(keyBytes);
  const idBits = await crypto.subtle.deriveBits(hkdf("document-id"), base, 256);
  const id = [...new Uint8Array(idBits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const aesKey = await crypto.subtle.deriveKey(hkdf("encryption"), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { id, aesKey };
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encryptJSON(aesKey, value) {
  const packed = await pipe(enc.encode(JSON.stringify(value)), new CompressionStream("deflate-raw"));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, packed));
  return { c: toBase64(ciphertext), iv: toBase64(iv) };
}

export async function decryptJSON(aesKey, { c, iv }) {
  let packed;
  try {
    packed = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, aesKey, fromBase64(c));
  } catch {
    throw new Error("The synced data could not be decrypted with this key");
  }
  return JSON.parse(new TextDecoder().decode(await pipe(new Uint8Array(packed), new DecompressionStream("deflate-raw"))));
}

function toBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

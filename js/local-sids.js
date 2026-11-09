// SID files the user added from their device. They stay in this browser's
// IndexedDB, outside playlists, sync and exports. A file's id is the SHA-1 of
// its bytes, so the same file added twice (or on another device) has one id.

import { CLOCKS, MODELS } from "./index-store.js";

export const LOCAL_DIR = "LOCAL";
const MAX_SID = 1024 * 1024;
const HEADER = 0x76;

const text = (bytes, at) => {
  const field = bytes.subarray(at, at + 32);
  const end = field.indexOf(0);
  return new TextDecoder("windows-1252").decode(end < 0 ? field : field.subarray(0, end)).trim();
};

// The PSID/RSID header as the fields of an index tune. Throws when it is not a SID file.
export function parseSid(bytes, fileName = "") {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (bytes.length < HEADER || (magic !== "PSID" && magic !== "RSID")) throw new Error("Not a SID file.");
  if (bytes.length > MAX_SID) throw new Error("SID file is too large (maximum 1 MB).");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4);
  const songs = view.getUint16(0x0e);
  if (!songs || songs > 256 || view.getUint16(6) > bytes.length) throw new Error("Not a SID file.");
  const flags = version >= 2 && bytes.length >= 0x78 ? view.getUint16(0x76) : 0;
  return {
    title: text(bytes, 0x16) || fileName.replace(/\.sid$/i, "").replace(/_/g, " ") || "Untitled",
    author: text(bytes, 0x36) || "<?>",
    released: text(bytes, 0x56),
    songs,
    start: Math.min(Math.max(view.getUint16(0x10), 1), songs),
    rsid: magic === "RSID",
    multiSid: version >= 3 && bytes.length > 0x7a && bytes[0x7a] !== 0,
    clock: CLOCKS[(flags >> 2) & 3],
    model: MODELS[(flags >> 4) & 3],
  };
}

export async function sidId(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A stored file as a queue item, like asItem() makes from an index tune.
export function localItem({ id, name, bytes }) {
  const tune = parseSid(bytes, name);
  return {
    ...tune, id, name, dir: LOCAL_DIR, path: `${LOCAL_DIR}/${id}.sid`, song: tune.start,
    lengths: [], bpmEstimates: [], speeds: [], sidBits: [], local: true, bytes,
  };
}

export const isLocal = (item) => !!item?.local;

// Items with the same title get "(2)", "(3)", ... in the given (added) order.
export function numberTitles(items) {
  const used = new Set();
  for (const item of items) {
    let title = item.title;
    for (let n = 2; used.has(title); n++) title = `${item.title} (${n})`;
    used.add(item.title = title);
  }
  return items;
}

export class LocalSidStore {
  constructor() { this.db = null; }

  open() {
    return this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("shallowsid.localSids", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("sids", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Could not open SID file storage in this browser."));
    });
  }

  async transact(mode, action) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sids", mode);
      const request = action(transaction.objectStore("sids"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(new Error("Could not save or read SID files in this browser."));
    });
  }

  // Records {id, name, bytes (ArrayBuffer), added}, oldest first.
  async load() {
    const records = await this.transact("readonly", (store) => store.getAll());
    return records.sort((a, b) => a.added - b.added);
  }

  // Validates and stores one file. Resolves to its record.
  async add(name, bytes) {
    parseSid(bytes, name);
    const record = { id: await sidId(bytes), name, bytes, added: Date.now() };
    await this.transact("readwrite", (store) => store.put(record));
    return record;
  }

  async remove(id) {
    await this.transact("readwrite", (store) => store.delete(id));
  }
}

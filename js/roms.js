// C64 ROMs belong to this browser only, outside playlist sync and exports.
export const ROM_TYPES = {
  basic: { label: "BASIC", size: 8192 },
  kernal: { label: "KERNAL", size: 8192 },
  chargen: { label: "Character ROM", size: 4096 },
};

export function validateRom(type, bytes) {
  const spec = ROM_TYPES[type];
  if (!spec) throw new Error("Unknown ROM type.");
  if (!(bytes instanceof Uint8Array) || bytes.length !== spec.size) {
    throw new Error(`${spec.label} must be exactly ${spec.size.toLocaleString("en-US")} bytes.`);
  }
  return bytes;
}

export async function fetchRom(type, address, fetcher = fetch) {
  const url = new URL(address);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Enter an HTTP or HTTPS URL.");
  let response;
  try {
    response = await fetcher(url.href, { credentials: "omit", signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("Could not download the ROM. The server must allow browser downloads. Try choosing a local file.");
  }
  if (!response.ok) throw new Error(`ROM download failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  validateRom(type, bytes);
  return { bytes, name: decodeURIComponent(url.pathname.split("/").pop()) || ROM_TYPES[type].label };
}

export class RomStore {
  constructor() { this.db = null; }

  open() {
    return this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("shallowsid.roms", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("roms");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Could not open ROM storage in this browser."));
    });
  }

  async transact(mode, action) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("roms", mode);
      const request = action(transaction.objectStore("roms"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(new Error("Could not save or read ROMs in this browser."));
    });
  }

  async load() {
    const entries = await this.transact("readonly", (store) => store.getAll());
    return Object.fromEntries(entries.map((entry) => [entry.type, entry]));
  }

  async save(type, bytes, name) {
    validateRom(type, bytes);
    await this.transact("readwrite", (store) => store.put({ type, bytes, name }, type));
  }

  async remove(type) {
    await this.transact("readwrite", (store) => store.delete(type));
  }
}

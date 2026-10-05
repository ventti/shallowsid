// Plays tunes on an Ultimate 64 (or Ultimate II+) through its REST API.
//
// The firmware sends no CORS headers and answers no preflight, so a page from
// another origin can only make "simple" requests whose answer it can't read:
// a multipart POST, without the X-Password header. That rules out the PUT
// routes (reset, pause, resume) too. What's left:
//
//   play  POST /v1/runners:sidplay?songnr=N with the .sid attached
//   stop  the same with a silent tune, which takes the machine over
//   ping  GET /v1/info: the answer is unreadable, but that one came at all
//         tells a reachable device from an absent one (which times out)
//
// An https page may not reach http://<LAN address> either (mixed content).
// Chrome lets it after asking for local network access (targetAddressSpace);
// other browsers only from a page served over http, such as tools/dev.sh.

// A PSID whose init sets the volume to 0 and whose play does nothing.
export function silentSid() {
  const header = new Uint8Array(0x7c);
  const view = new DataView(header.buffer);
  header.set([0x50, 0x53, 0x49, 0x44]);        // "PSID"
  view.setUint16(0x04, 2);                     // version
  view.setUint16(0x06, 0x7c);                  // data offset
  view.setUint16(0x08, 0);                     // load address: the data's first two bytes
  view.setUint16(0x0a, 0x1000);                // init
  view.setUint16(0x0c, 0x1006);                // play
  view.setUint16(0x0e, 1);                     // songs
  view.setUint16(0x10, 1);                     // start song
  header.set(new TextEncoder().encode("Silence"), 0x16);
  const code = [0x00, 0x10, 0xa9, 0x00, 0x8d, 0x18, 0xd4, 0x60, 0x60];   // LDA #0, STA $D418, RTS; RTS
  const sid = new Uint8Array(header.length + code.length);
  sid.set(header);
  sid.set(code, header.length);
  return sid;
}

// Chrome needs to be told which address space the device is in, and refuses
// the request if it's wrong.
const LOOPBACK = /^(localhost|127(\.\d+){3}|\[::1\])(:\d+)?$/i;
export const addressSpace = (host) => (LOOPBACK.test(host) ? "loopback" : "local");

export class Ultimate64 {
  constructor(host) {
    this.host = host;
  }

  // Resolves once the request went out; the device's answer can't be read.
  async play(bytes, song = 0) {
    if (!this.host) throw new Error("Set the Ultimate's address in Sound");
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "application/octet-stream" }), "tune.sid");
    try {
      await fetch(`http://${this.host}/v1/runners:sidplay?songnr=${song}`, {
        method: "POST", body: form, mode: "no-cors", targetAddressSpace: addressSpace(this.host),
      });
    } catch {
      throw new Error(`Couldn't reach the Ultimate at ${this.host}`);
    }
  }

  stop() {
    return this.play(silentSid(), 1);
  }

  async reachable(timeoutMs = 3000) {
    if (!this.host) return false;
    try {
      await fetch(`http://${this.host}/v1/info`, {
        mode: "no-cors", cache: "no-store", targetAddressSpace: addressSpace(this.host), signal: AbortSignal.timeout(timeoutMs),
      });
      return true;
    } catch {
      return false;
    }
  }
}

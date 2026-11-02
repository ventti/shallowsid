import { test } from "node:test";
import assert from "node:assert/strict";
import { localItem, parseSid, sidId } from "../js/local-sids.js";

function sid({ magic = "PSID", version = 2, songs = 3, start = 2, title = "Tune", author = "Me", flags = 0x14 } = {}) {
  const bytes = new Uint8Array(0x7c + 4);
  const view = new DataView(bytes.buffer);
  bytes.set([...magic].map((c) => c.charCodeAt(0)));
  view.setUint16(4, version);
  view.setUint16(6, 0x7c);
  view.setUint16(0x0e, songs);
  view.setUint16(0x10, start);
  bytes.set([...title].map((c) => c.charCodeAt(0)), 0x16);
  bytes.set([...author].map((c) => c.charCodeAt(0)), 0x36);
  bytes.set([..."1987 Group"].map((c) => c.charCodeAt(0)), 0x56);
  view.setUint16(0x76, flags);
  return bytes;
}

test("SID header gives the tune fields", () => {
  const tune = parseSid(sid());
  assert.equal(tune.title, "Tune");
  assert.equal(tune.author, "Me");
  assert.equal(tune.released, "1987 Group");
  assert.equal(tune.songs, 3);
  assert.equal(tune.start, 2);
  assert.equal(tune.clock, "PAL");
  assert.equal(tune.model, "6581");
  assert.equal(tune.rsid, false);
});

test("empty title falls back to the file name, bad files are refused", () => {
  assert.equal(parseSid(sid({ title: "" }), "My_Tune.sid").title, "My Tune");
  assert.throws(() => parseSid(new Uint8Array(200)), /Not a SID/);
  assert.throws(() => parseSid(sid().subarray(0, 0x40)), /Not a SID/);
  assert.throws(() => parseSid(sid({ songs: 0 })), /Not a SID/);
});

test("a local item has a stable id and path, and keeps its bytes", async () => {
  const bytes = sid().buffer;
  const id = await sidId(bytes);
  assert.equal(id, await sidId(sid().buffer));
  const item = localItem({ id, name: "a.sid", bytes });
  assert.equal(item.path, `LOCAL/${id}.sid`);
  assert.equal(item.song, 2);
  assert.equal(item.local, true);
  assert.equal(item.bytes, bytes);
});

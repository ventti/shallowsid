import { test } from "node:test";
import assert from "node:assert/strict";
import { addressSpace, silentSid } from "../js/player/u64.js";

test("the silent tune is a valid PSID v2 that mutes the SID", () => {
  const sid = silentSid();
  const view = new DataView(sid.buffer);
  assert.equal(new TextDecoder().decode(sid.subarray(0, 4)), "PSID");
  assert.equal(view.getUint16(4), 2);
  assert.equal(view.getUint16(6), 0x7c);
  assert.equal(view.getUint16(0x0a), 0x1000);
  assert.equal(view.getUint16(0x0c), 0x1006);
  // loads at $1000: LDA #0, STA $D418, RTS, then play's RTS at $1006
  assert.deepEqual([...sid.subarray(0x7c)], [0x00, 0x10, 0xa9, 0x00, 0x8d, 0x18, 0xd4, 0x60, 0x60]);
});

test("loopback hosts are told apart from the local network", () => {
  assert.equal(addressSpace("127.0.0.1:8080"), "loopback");
  assert.equal(addressSpace("localhost"), "loopback");
  assert.equal(addressSpace("192.168.1.64"), "local");
  assert.equal(addressSpace("u64.local"), "local");
});

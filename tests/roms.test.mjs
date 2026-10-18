import { test } from "node:test";
import assert from "node:assert/strict";
import { ROM_TYPES, RomStore, fetchRom, validateRom } from "../js/roms.js";
import { Player } from "../js/player/player.js";

test("ROM sizes are exact, including distinct character ROM size", () => {
  for (const [type, { size }] of Object.entries(ROM_TYPES)) {
    assert.equal(validateRom(type, new Uint8Array(size)).length, size);
    assert.throws(() => validateRom(type, new Uint8Array(size + 1)), /exactly/);
    assert.throws(() => validateRom(type, new Uint8Array(size - 1)), /exactly/);
  }
  assert.throws(() => validateRom("unknown", new Uint8Array(8192)), /Unknown/);
});

test("URL import downloads bytes without credentials and validates before saving", async () => {
  const result = await fetchRom("basic", "https://example.com/basic.bin", async (url, options) => {
    assert.equal(url, "https://example.com/basic.bin");
    assert.equal(options.credentials, "omit");
    return new Response(new Uint8Array(8192));
  });
  assert.equal(result.name, "basic.bin");
  assert.equal(result.bytes.length, 8192);
  await assert.rejects(fetchRom("basic", "file:///basic.bin"), /HTTP/);
  await assert.rejects(fetchRom("basic", "https://example.com", async () => new Response("HTML")), /exactly/);
  await assert.rejects(fetchRom("basic", "https://example.com", async () => new Response("", { status: 404 })), /404/);
  await assert.rejects(fetchRom("basic", "https://example.com", async () => { throw new TypeError("CORS"); }), /local file/);
});

// Exercise the store's transaction completion and retained bytes across instances.
function memoryDatabase() {
  const entries = new Map();
  return { transaction() {
    const tx = { objectStore() { return {
      put(value, key) { entries.set(key, structuredClone(value)); return {}; },
      delete(key) { entries.delete(key); return {}; },
      getAll() { return { result: structuredClone([...entries.values()]) }; },
    }; } };
    queueMicrotask(() => tx.oncomplete());
    return tx;
  } };
}

test("ROM storage persists bytes, replaces, removes and retains previous ROM after validation failure", async () => {
  const db = memoryDatabase();
  const first = new RomStore();
  first.db = Promise.resolve(db);
  await first.save("basic", new Uint8Array(8192).fill(42), "basic.bin");
  await assert.rejects(first.save("basic", new Uint8Array(10), "bad.bin"));
  const second = new RomStore();
  second.db = Promise.resolve(db);
  assert.equal((await second.load()).basic.bytes[0], 42);
  await second.save("basic", new Uint8Array(8192).fill(7), "new.bin");
  assert.equal((await first.load()).basic.name, "new.bin");
  await first.remove("basic");
  assert.deepEqual(await second.load(), {});
});

test("ROM changes clear both renders and cached audio while preserving pause", () => {
  for (const state of ["playing", "paused"]) {
    const player = new Player({ sidUrls: () => [] });
    const messages = [];
    player.queue = [{ song: 1 }];
    player.index = 0;
    player.state = state;
    player.bytes = new ArrayBuffer(10);
    player.ctx = { sampleRate: 48000 };
    player.duration = 120;
    player.position = 45;
    player.node = { port: { postMessage: (msg) => messages.push(msg) } };
    player.liveWorker = { postMessage: (msg) => messages.push({ worker: "live", ...msg }) };
    player.cacheWorker = { postMessage: (msg) => messages.push({ worker: "cache", ...msg }) };
    const roms = { basic: { bytes: new Uint8Array(8192) } };
    player.setRoms(roms);
    assert.equal(player.position, 0);
    assert.equal(player.state, state);
    assert.equal(messages.filter((msg) => msg.type === "stop").length, 2);
    assert.ok(messages.some((msg) => msg.type === "reset"));
    const loads = messages.filter((msg) => msg.type === "load");
    assert.equal(loads.length, 2);
    assert.ok(loads.every((msg) => msg.roms === roms && msg.startFrame === 0));
    assert.equal(messages.at(-1).type, state === "playing" ? "play" : "pause");
  }
});

test("both engine choices inject ROMs before loading and reject silent ROM fallback", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const source = (await readFile(new URL("../js/player/engine-worker.js", import.meta.url), "utf8"))
    .replace(/^import .*;$/gm, "");
  for (const engineName of ["residfp", "sidlite"]) {
    for (const active of [true, false]) {
      const calls = [];
      const messages = [];
      class Engine {
        async setSystemROMs(...roms) { calls.push(["roms", ...roms]); }
        async loadSidBuffer() { calls.push(["load"]); }
        getRomStatus() { return { requested: true, active }; }
      }
      const context = {
        self: { postMessage: (message) => messages.push(message) },
        loadLibsidplayfp: async ({ engine }) => { assert.equal(engine, engineName); return {}; },
        SidAudioEngine: Engine, Uint8Array, setTimeout,
      };
      runInNewContext(source, context);
      const roms = { kernal: { bytes: new Uint8Array(8192) }, basic: { bytes: new Uint8Array(8192) }, chargen: { bytes: new Uint8Array(4096) } };
      context.self.onmessage({ data: { type: "load", role: "live", engine: engineName, token: 1, roms, bytes: new ArrayBuffer(128), startFrame: 0, stopFrame: 0, sampleRate: 48000 } });
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(calls[0], ["roms", roms.kernal.bytes, roms.basic.bytes, roms.chargen.bytes]);
      assert.equal(calls[1][0], "load");
      assert.equal(messages.at(-1).type, active ? "done" : "error");
      if (!active) assert.match(messages.at(-1).message, /Settings → C64 ROMs/);
    }
  }
});

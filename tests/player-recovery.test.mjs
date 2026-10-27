import { test } from "node:test";
import assert from "node:assert/strict";
import { Player } from "../js/player/player.js";

function setup() {
  const player = new Player({ sidUrls: () => [] });
  const calls = [];
  player.queue = [{ path: "Tune.sid", song: 1, lengths: [100] }, { path: "Next.sid" }];
  player.index = 0;
  player.position = 42;
  player.state = "playing";
  player.bytes = new ArrayBuffer(4);
  player.ctx = { close: async () => calls.push("close") };
  player.sessionAudio = {
    pause() { calls.push("old-pause"); },
    srcObject: { getTracks: () => [{ stop() { calls.push("stop-track"); } }] },
  };
  player.node = { port: { onmessage() {} }, disconnect() { calls.push("disconnect"); } };
  player.liveWorker = { terminate() { calls.push("terminate-live"); } };
  player.cacheWorker = { terminate() { calls.push("terminate-cache"); } };
  player.ensureAudio = () => {
    player.ctx = { sampleRate: 1000 };
    player.node = { port: { postMessage: (message) => calls.push(message) } };
    return Promise.resolve();
  };
  player.fetchSid = () => { throw new Error("must reuse loaded SID bytes"); };
  player.channels = () => [];
  player.startLive = (frame) => calls.push(["live", frame]);
  player.startCache = (frame) => calls.push(["cache", frame]);
  return { player, calls };
}

test("rebuilding the audio engine preserves the tune, queue, bytes and position", async () => {
  const { player, calls } = setup();
  const queue = player.queue;
  const bytes = player.bytes;
  const oldNode = player.node;
  const oldAudio = player.sessionAudio;
  await player.restartAudio();
  assert.equal(player.queue, queue);
  assert.equal(player.index, 0);
  assert.equal(player.bytes, bytes);
  assert.equal(player.position, 42);
  assert.equal(oldNode.port.onmessage, null);
  assert.equal(oldAudio.srcObject, null);
  assert.deepEqual(calls.slice(0, 6), ["old-pause", "stop-track", "disconnect", "terminate-live", "terminate-cache", "close"]);
  assert.ok(calls.some((message) => message.type === "reset" && message.startFrame === 42000 && message.stopFrame === 100000));
  assert.ok(calls.some((message) => Array.isArray(message) && message[0] === "live" && message[1] === 42000));
  assert.ok(calls.some((message) => Array.isArray(message) && message[0] === "cache" && message[1] === 42000));
  assert.deepEqual(calls.at(-1), { type: "play" });
});

test("pausing during an engine rebuild prevents playback after initialization", async () => {
  const { player, calls } = setup();
  const ensure = player.ensureAudio;
  let ready;
  player.ensureAudio = () => {
    ensure();
    return new Promise((resolve) => { ready = resolve; });
  };
  const recovery = player.restartAudio();
  player.pause();
  ready();
  await recovery;
  assert.equal(player.state, "paused");
  assert.equal(calls.some((message) => message.type === "play"), false);
});

test("failed engine initialization keeps the tune available for another Play", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { player } = setup();
  player.ensureAudio = () => Promise.reject(new Error("audio unavailable"));
  const errors = [];
  player.addEventListener("error", (event) => errors.push(event.detail));
  await player.restartAudio();
  assert.equal(player.index, 0);
  assert.equal(player.position, 42);
  assert.equal(player.state, "paused");
  assert.equal(player.needsAudioRestart, true);
  assert.equal(errors.length, 1);
  let retried = false;
  player.restartAudio = async () => { retried = true; };
  await player.play();
  assert.equal(retried, true);
});


test("old worklet reports cannot move a newly selected tune away from zero", async () => {
  const { player, calls } = setup();
  player.ensureAudio();
  player.token = 7;
  let loaded;
  player.fetchSid = () => new Promise((resolve) => { loaded = resolve; });
  const playing = player.playIndex(1);
  const token = player.token;
  assert.equal(player.position, 0);
  const reports = player.audioReports;
  player.onWorklet({ type: "pos", token: 7, frame: 25000, base: 0, end: 100000, liveEnd: 100000 });
  assert.equal(player.position, 0);
  assert.equal(player.audioReports, reports);
  loaded(new ArrayBuffer(4));
  await playing;
  const reset = calls.find((message) => message.type === "reset");
  assert.equal(reset.startFrame, 0);
  player.onWorklet({ type: "pos", token, frame: 1000, base: 0, end: 100000, liveEnd: 100000, waiting: false });
  assert.equal(player.position, 1);
});

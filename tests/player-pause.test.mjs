import { test } from "node:test";
import assert from "node:assert/strict";
import { Player } from "../js/player/player.js";

function setup() {
  const player = new Player({ sidUrls: () => [] });
  player.queue = [{ title: "Tune" }];
  player.index = 0;
  player.state = "playing";
  const calls = [];
  player.sessionAudio = {
    play() { calls.push("session-play"); return Promise.resolve(); },
    pause() { calls.push("session-pause"); },
  };
  player.ctx = {
    state: "running", sampleRate: 48000,
    suspend() { calls.push("suspend"); return Promise.resolve(); },
    resume() { calls.push("resume"); return Promise.resolve(); },
  };
  player.node = { port: { postMessage(message) { calls.push(message); } } };
  return { player, calls };
}

test("pause waits for the fade and ignores its completion after resume", () => {
  const { player, calls } = setup();
  player.pause();
  assert.equal(player.state, "paused");
  // Resume can happen before the worklet finishes fading.
  player.play();
  player.onWorklet({ type: "paused", id: 1 });
  assert.equal(player.state, "playing");
  assert.deepEqual(calls, [{ type: "pause", id: 1 }, "session-pause", "session-play", "resume", { type: "play" }]);
});

test("scrubbing while paused temporarily resumes audio, then suspends again", () => {
  const { player, calls } = setup();
  player.pause();
  calls.length = 0;
  player.scrub(5);
  player.scrub(null);
  assert.equal(player.state, "paused");
  assert.deepEqual(calls, [
    { type: "scrub", frame: 240000 }, "resume",
    { type: "scrub", frame: null }, { type: "pause", id: 3 }, "session-pause",
  ]);
});

test("ending a scrub during playback leaves audio running", () => {
  const { player, calls } = setup();
  player.scrub(5);
  player.scrub(null);
  assert.equal(calls.includes("suspend"), false);
});

test("without a session element pause keeps the original Web Audio behavior", () => {
  const { player, calls } = setup();
  delete player.sessionAudio;
  player.pause();
  assert.equal(player.state, "paused");
  assert.deepEqual(calls, [{ type: "pause", id: 1 }]);
});

test("switching to remote output stops the local session element", () => {
  const { player, calls } = setup();
  player.stopLocal();
  assert.deepEqual(calls, [{ type: "pause", id: 1 }, "session-pause"]);
  player.u64 = {};
  player.onWorklet({ type: "paused", id: 1 });
  assert.equal(calls.at(-1), "suspend");
});

test("only the latest completed pause suspends the context", () => {
  const { player, calls } = setup();
  player.pause();
  player.pause();
  player.onWorklet({ type: "paused", id: 1 });
  assert.equal(calls.includes("suspend"), false);
  player.onWorklet({ type: "paused", id: 2 });
  assert.equal(calls.at(-1), "suspend");
});

test("a pending pause cannot suspend audible scrubbing", () => {
  const { player, calls } = setup();
  player.pause();
  player.scrub(5);
  player.onWorklet({ type: "paused", id: 1 });
  assert.equal(calls.includes("suspend"), false);
});

test("native audio sessions retain the media element bridge for system controls", async (t) => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioContext = globalThis.AudioContext;
  const originalAudio = globalThis.Audio;
  t.after(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    if (originalAudio) globalThis.Audio = originalAudio;
    else delete globalThis.Audio;
    if (originalAudioContext) globalThis.AudioContext = originalAudioContext;
    else delete globalThis.AudioContext;
  });
  globalThis.Audio = class extends EventTarget {
    constructor(src) { super(); this.src = src; }
    play() { return Promise.resolve(); }
    pause() {}
  };
  const audioSession = {};
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { audioSession, mediaSession: {} } });
  const calls = [];
  globalThis.AudioContext = class {
    createMediaStreamDestination() { return { stream: {} }; }
    resume() { calls.push("resume"); return Promise.resolve(); }
    suspend() { calls.push("suspend"); return Promise.resolve(); }
  };
  const player = new Player({ sidUrls: () => [] });
  player.initAudioGraph = async () => {
    player.node = { port: { postMessage: (message) => calls.push(message) } };
  };
  player.queue = [{ title: "Tune" }];
  player.index = 0;
  await player.ensureAudio();
  t.after(() => player.stopAudioMonitor?.());
  assert.equal(audioSession.type, "playback");
  assert.ok(player.sessionAudio);
  assert.equal(player.sessionAudio.srcObject, player.sessionDestination.stream);
  player.pause();
  player.onWorklet({ type: "paused", id: player.pauseId });
  player.play();
  assert.equal(calls.includes("suspend"), false);
  assert.equal(player.state, "playing");
  assert.deepEqual(calls.at(-1), { type: "play" });
});

test("iPhone pause preserves the fade and resume cancels stale pauses", (t) => {
  const { player, calls } = setup();
  player.sessionDestination = { stream: {} };
  player.pause();
  assert.deepEqual(calls, [{ type: "pause", id: 1 }]);
  player.onWorklet({ type: "paused", id: 1 });
  assert.deepEqual(calls, [{ type: "pause", id: 1 }, "session-pause"]);
  player.play();
  t.after(() => player.stopAudioMonitor?.());
  calls.length = 0;
  player.onWorklet({ type: "paused", id: 1 });
  assert.deepEqual(calls, []);
});

test("iPhone paused scrubbing pauses output after fading", () => {
  const { player, calls } = setup();
  player.sessionDestination = { stream: {} };
  player.state = "paused";
  player.scrub(5);
  assert.equal(player.scrubbing, true);
  assert.ok(calls.includes("session-play"));
  player.scrub(null);
  assert.equal(player.scrubbing, false);
  player.onWorklet({ type: "paused", id: player.pauseId });
  assert.equal(calls.at(-1), "session-pause");
  assert.equal(calls.includes("suspend"), false);
});


test("the worklet connects only to the selected audio output", async (t) => {
  const original = globalThis.AudioWorkletNode;
  t.after(() => {
    if (original) globalThis.AudioWorkletNode = original;
    else delete globalThis.AudioWorkletNode;
  });
  const outputs = [];
  globalThis.AudioWorkletNode = class {
    port = {};
    connect(destination) { outputs.push(destination); }
  };
  for (const streamOutput of [false, true]) {
    const player = new Player({ sidUrls: () => [] });
    player.ctx = { destination: {}, audioWorklet: { async addModule() {} } };
    if (streamOutput) player.sessionDestination = { stream: {} };
    player.createWorker = () => ({});
    await player.initAudioGraph();
    assert.equal(outputs.at(-1), streamOutput ? player.sessionDestination : player.ctx.destination);
  }
  assert.equal(outputs.length, 2, "each graph must have only one output to avoid doubled sound");
});


test("switching iPhone output to Ultimate stops the retained silent stream", () => {
  const { player, calls } = setup();
  player.sessionDestination = { stream: {} };
  player.u64 = {};
  player.stopLocal();
  player.onWorklet({ type: "paused", id: player.pauseId });
  assert.deepEqual(calls.slice(-2), ["session-pause", "suspend"]);
});

test("a rejected output start pauses instead of reporting silent playback", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { player } = setup();
  player.sessionAudio.play = () => Promise.reject(new DOMException("Not allowed", "NotAllowedError"));
  const errors = [];
  player.addEventListener("error", (event) => errors.push(event.detail));
  player.play();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(player.state, "paused");
  assert.equal(errors.length, 1);
});


test("a delayed stream start cannot undo a pause requested during loading", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { player, calls } = setup();
  player.sessionDestination = { stream: {} };
  let finish;
  player.sessionAudio.play = () => new Promise((resolve) => { finish = resolve; });
  player.ensureAudio();
  t.after(() => player.stopAudioMonitor?.());
  player.pause();
  calls.length = 0;
  finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(player.state, "paused");
  assert.equal(calls.includes("session-pause"), false, "the late start must still allow a fade");
  player.onWorklet({ type: "paused", id: player.pauseId });
  assert.ok(calls.includes("session-pause"));
});


test("a missing fade acknowledgement has a bounded output-pause fallback", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { player, calls } = setup();
  player.sessionDestination = { stream: {} };
  player.pause();
  assert.equal(player.state, "paused");
  t.mock.timers.tick(249);
  assert.equal(calls.includes("session-pause"), false);
  t.mock.timers.tick(1);
  assert.equal(calls.at(-1), "session-pause");
  assert.equal(calls.includes("suspend"), false);
});

test("resuming before the fallback cannot pause the resumed stream", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { player, calls } = setup();
  player.sessionDestination = { stream: {} };
  player.pause();
  player.play();
  t.after(() => player.stopAudioMonitor?.());
  t.mock.timers.tick(1000);
  assert.equal(player.state, "playing");
  assert.equal(calls.includes("session-pause"), false);
});

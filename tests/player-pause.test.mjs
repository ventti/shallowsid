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
  assert.equal(audioSession.type, "playback");
  assert.ok(player.sessionAudio);
  t.after(() => URL.revokeObjectURL(player.sessionAudio.src));
  player.pause();
  player.onWorklet({ type: "paused", id: player.pauseId });
  player.play();
  assert.equal(calls.includes("suspend"), true);
  assert.equal(player.state, "playing");
  assert.deepEqual(calls.at(-1), { type: "play" });
});

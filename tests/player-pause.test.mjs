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

test("app pause suspends audio and play resumes even with a pending suspend", () => {
  const { player, calls } = setup();
  player.pause();
  assert.equal(player.state, "paused");
  // The context can still report running until suspend completes.
  player.play();
  assert.equal(player.state, "playing");
  assert.deepEqual(calls, [{ type: "pause" }, "session-pause", "suspend", "session-play", "resume", { type: "play" }]);
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
    { type: "scrub", frame: null }, "suspend",
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
  assert.deepEqual(calls, [{ type: "pause" }]);
});

test("switching to remote output stops the local session element", () => {
  const { player, calls } = setup();
  player.stopLocal();
  assert.deepEqual(calls.slice(0, 3), [{ type: "pause" }, "session-pause", "suspend"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { monitorAudio } from "../js/player/audio-health.js";

function setup(t) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const calls = [];
  const player = {
    state: "playing", node: {}, audioReports: 1,
    current: { title: "Tune" },
    ctx: {
      state: "running", currentTime: 10,
      suspend() { calls.push("suspend"); return Promise.resolve(); },
      resume() { calls.push("resume"); return Promise.resolve(); },
    },
    sessionAudio: { paused: false, currentTime: 10 },
    restartAudio() { calls.push("rebuild"); return Promise.resolve(); },
    pause() { calls.push("pause"); this.state = "paused"; },
    emit(type, detail) { calls.push([type, detail]); },
  };
  const stop = monitorAudio(player);
  t.after(stop);
  const tick = async (advance = false) => {
    if (advance) {
      player.ctx.currentTime++;
      player.sessionAudio.currentTime++;
      player.audioReports++;
    }
    t.mock.timers.tick(1000);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { player, calls, tick, stop };
}

test("healthy clocks and worklet reports do not restart audio", async (t) => {
  const { calls, tick } = setup(t);
  for (let n = 0; n < 8; n++) await tick(true);
  assert.deepEqual(calls, []);
});

for (const frozen of ["context", "output", "worklet"]) {
  test(`a frozen ${frozen} is detected even when the other clocks run`, async (t) => {
    const { player, calls, tick } = setup(t);
    for (let n = 0; n < 3; n++) {
      if (frozen !== "context") player.ctx.currentTime++;
      if (frozen !== "output") player.sessionAudio.currentTime++;
      if (frozen !== "worklet") player.audioReports++;
      await tick();
    }
    assert.deepEqual(calls, ["suspend", "resume"]);
    await tick(true);
    await tick(true);
    assert.deepEqual(calls, ["suspend", "resume"]);
  });
}

test("a hung device restart escalates to an engine rebuild, then reports failure", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { player, calls, tick } = setup(t);
  player.ctx.suspend = () => { calls.push("suspend"); return new Promise(() => {}); };
  for (let n = 0; n < 7; n++) await tick();
  assert.deepEqual(calls.slice(0, 3), ["suspend", "rebuild", "pause"]);
  assert.equal(player.needsAudioRestart, true);
  assert.equal(calls[3][0], "error");
  for (let n = 0; n < 4; n++) await tick();
  assert.equal(calls.filter((call) => call === "rebuild").length, 1);
});

test("recovery of a replacement context does not cycle it again", async (t) => {
  const { player, calls, tick } = setup(t);
  player.restartAudio = async () => {
    calls.push("rebuild");
    player.ctx = { ...player.ctx, currentTime: 0 };
    player.sessionAudio.currentTime = 0;
  };
  for (let n = 0; n < 5; n++) await tick();
  await tick(true);
  await tick(true);
  assert.deepEqual(calls, ["suspend", "resume", "rebuild"]);
});

test("paused, interrupted, remote and externally stopped output are left alone", async (t) => {
  const { player, calls, tick } = setup(t);
  for (const state of ["paused", "idle"]) {
    player.state = state;
    for (let n = 0; n < 4; n++) await tick();
  }
  player.state = "playing";
  player.ctx.state = "interrupted";
  for (let n = 0; n < 4; n++) await tick();
  player.ctx.state = "running";
  player.u64 = {};
  for (let n = 0; n < 4; n++) await tick();
  player.u64 = null;
  player.sessionAudio.paused = true;
  for (let n = 0; n < 4; n++) await tick();
  assert.deepEqual(calls, []);
});

test("a pause during suspend prevents a late resume", async (t) => {
  const { player, calls, tick } = setup(t);
  let finish;
  player.ctx.suspend = () => { calls.push("suspend"); return new Promise((resolve) => { finish = resolve; }); };
  for (let n = 0; n < 3; n++) await tick();
  player.state = "paused";
  finish();
  await Promise.resolve();
  assert.deepEqual(calls, ["suspend"]);
});


test("a replaced context cannot be resumed by an old recovery promise", async (t) => {
  const { player, calls, tick } = setup(t);
  let finish;
  player.ctx.suspend = () => { calls.push("suspend"); return new Promise((resolve) => { finish = resolve; }); };
  for (let n = 0; n < 3; n++) await tick();
  player.ctx = { ...player.ctx, currentTime: 0 };
  finish();
  await Promise.resolve();
  assert.deepEqual(calls, ["suspend"]);
});


test("an asynchronous rebuild retains the retry limit across missing audio nodes", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { player, calls, tick } = setup(t);
  const ctx = player.ctx;
  let finish;
  player.restartAudio = () => {
    calls.push("rebuild");
    player.state = "loading";
    player.ctx = player.node = null;
    return new Promise((resolve) => { finish = () => {
      player.ctx = { ...ctx, currentTime: 0 };
      player.node = {};
      resolve();
    }; });
  };
  for (let n = 0; n < 7; n++) await tick();
  finish();
  for (let n = 0; n < 3; n++) await tick();
  assert.equal(calls.filter((call) => call === "rebuild").length, 1);
  assert.equal(player.state, "paused");
  assert.equal(player.needsAudioRestart, true);
});

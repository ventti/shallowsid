import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSessionAudio } from "../js/player/session-audio.js";

function setup(t) {
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  t.after(() => {
    if (originalAudio) Object.defineProperty(globalThis, "Audio", originalAudio);
    else delete globalThis.Audio;
  });
  globalThis.Audio = class extends EventTarget {
    constructor(url) { super(); this.src = url; this.muted = false; this.paused = true; }
  };
  const calls = [];
  const player = {
    state: "playing", u64: null,
    play() { calls.push("play"); this.state = "playing"; },
    pause() { calls.push("pause"); this.state = "paused"; },
  };
  const audio = createSessionAudio(player);
  t.after(() => URL.revokeObjectURL(audio.src));
  return { audio, player, calls };
}

test("the page security policy permits the media-session loop URL", (t) => {
  const { audio } = setup(t);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const directives = new Map(policy.split(";").map((entry) => {
    const [name, ...sources] = entry.trim().split(/\s+/);
    return [name, sources];
  }));
  const sources = directives.get("media-src") ?? directives.get("default-src");
  assert.ok(sources.includes(new URL(audio.src).protocol), "the generated audio URL must be allowed by CSP");
});

test("the media-session loop is valid silent PCM and stays available for resume", async (t) => {
  const { audio } = setup(t);
  assert.equal(audio.loop, true);
  assert.equal(audio.muted, false);
  audio.dispatchEvent(new Event("loadeddata"));
  const response = await fetch(audio.src);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint16(34, true), 8);
  assert.equal(view.getUint32(40, true), 64000);
  assert.ok(bytes.slice(44).every((sample) => sample === 128));
});

test("native element pause and resume reach the SID player", (t) => {
  const { audio, player, calls } = setup(t);
  audio.dispatchEvent(new Event("pause"));
  assert.equal(player.state, "paused");
  audio.paused = false;
  audio.dispatchEvent(new Event("play"));
  assert.equal(player.state, "playing");
  assert.deepEqual(calls, ["pause", "play"]);
});

test("events from app controls do not repeat the transport commands", (t) => {
  const { audio, player, calls } = setup(t);
  player.state = "paused";
  audio.dispatchEvent(new Event("pause"));
  player.state = "playing";
  audio.paused = false;
  audio.dispatchEvent(new Event("play"));
  assert.deepEqual(calls, []);
});

test("stale element events and remote playback cannot restart the local player", (t) => {
  const { audio, player, calls } = setup(t);
  player.state = "paused";
  audio.dispatchEvent(new Event("play")); // already paused again
  player.state = "playing";
  audio.paused = false;
  audio.dispatchEvent(new Event("pause")); // already playing again
  player.u64 = {};
  player.state = "paused";
  audio.dispatchEvent(new Event("play"));
  assert.deepEqual(calls, []);
});

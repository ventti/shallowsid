import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function setup() {
  let Processor;
  const messages = [];
  vm.runInNewContext(readFileSync(new URL("../js/player/sid-worklet.js", import.meta.url), "utf8"), {
    AudioWorkletProcessor: class { port = { postMessage: (msg) => messages.push(msg) }; },
    sampleRate: 48000,
    registerProcessor: (_, processor) => { Processor = processor; },
  });
  const worklet = new Processor();
  worklet.onControl({ type: "reset", token: 1, channels: 2, stopFrame: 480000 });
  const pcm = new Int16Array(4096);
  for (let i = 0; i < pcm.length; i += 2) {
    pcm[i] = 16384;
    pcm[i + 1] = -8192;
  }
  worklet.addCache({ gen: 1, startFrame: 0, pcm });
  const block = () => {
    const output = [new Float32Array(128), new Float32Array(128)];
    worklet.process([], [output]);
    return output;
  };
  worklet.onControl({ type: "play" });
  block(); block(); block();
  return { worklet, block, messages };
}

test("pause fades both channels to zero before acknowledging, without moving the playhead", () => {
  const { worklet, block, messages } = setup();
  const position = worklet.playhead;
  worklet.onControl({ type: "pause", id: 1 });
  const first = block();
  assert.equal(messages.some((msg) => msg.type === "paused"), false);
  const second = block();
  const left = [...first[0], ...second[0]];
  const right = [...first[1], ...second[1]];
  assert.ok(left[0] > 0.49 && left[0] < 0.5);
  assert.ok(right[0] < -0.24 && right[0] > -0.25);
  for (let i = 1; i < left.length; i++) {
    assert.ok(left[i] <= left[i - 1]);
    assert.ok(right[i] >= right[i - 1]);
    assert.ok(Math.abs(left[i] - left[i - 1]) <= 0.5 / 256);
  }
  assert.equal(left.at(-1), 0);
  assert.ok(right.at(-1) === 0);
  assert.equal(worklet.playhead, position);
  assert.ok(messages.some((msg) => msg.type === "paused" && msg.id === 1));
  assert.ok(block().every((channel) => channel.every((value) => value === 0)));
});

test("resume cancels a pending pause acknowledgement", () => {
  const { worklet, block, messages } = setup();
  worklet.onControl({ type: "pause", id: 1 });
  block();
  worklet.onControl({ type: "play" });
  block(); block(); block();
  assert.equal(messages.some((msg) => msg.type === "paused"), false);
  assert.equal(worklet.playing, true);
});

test("pause fades the remaining waveform instead of holding a DC sample", () => {
  const { worklet, block } = setup();
  const position = worklet.playhead;
  worklet.sampleAt = (frame, ch) => (frame % 2 ? -1 : 1) * (ch ? 0.25 : 0.5);
  worklet.onControl({ type: "pause", id: 1 });
  const output = block();
  for (let i = 0; i < 128; i++) {
    const gain = (255 - i) / 256;
    const sign = (position + i) % 2 ? -1 : 1;
    assert.equal(output[0][i], sign * 0.5 * gain);
    assert.equal(output[1][i], sign * 0.25 * gain);
  }
  assert.equal(worklet.playhead, position);
});


test("position reports identify the track that produced them", () => {
  const { worklet, messages } = setup();
  worklet.report();
  assert.equal(messages.at(-1).token, 1);
  worklet.onControl({ type: "reset", token: 2, channels: 2, startFrame: 0, stopFrame: 480000 });
  worklet.report();
  assert.equal(messages.at(-1).token, 2);
  assert.equal(messages.at(-1).frame, 0);
});

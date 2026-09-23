// Module worker that renders a SID subtune with libsidplayfp (reSIDfp) and
// streams the PCM to the AudioWorklet. Rendering runs as fast as the engine
// allows (roughly 3-15x realtime), so the worklet soon holds the whole tune
// and seeking/scrubbing becomes instant.

import loadLibsidplayfp, { SidAudioEngine } from "https://cdn.jsdelivr.net/npm/libsidplayfp-wasm@1.0.1/dist/index.js";

const CHUNK_FRAMES = 8192;            // must match sid-worklet.js
const PEAK_BUCKETS_PER_SECOND = 10;   // waveform overview resolution
const MAX_AHEAD_SECONDS = 540;        // stop rendering this far ahead of the playhead

const modulePromise = loadLibsidplayfp({ engine: "residfp" });
let worklet = null;                   // MessagePort to the AudioWorklet
let job = null;                       // the render currently in progress
let playheadFrame = 0;

self.onmessage = async (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "worklet-port":
      worklet = msg.port;
      worklet.onmessage = (ev) => {
        if (job && ev.data.token === job.token) playheadFrame = ev.data.frame;
      };
      break;
    case "load":
      cancel();
      playheadFrame = msg.startFrame || 0;
      job = { ...msg, cancelled: false };
      render(job).catch((err) => {
        if (!job?.cancelled) self.postMessage({ type: "error", token: msg.token, message: String(err?.message || err) });
      });
      break;
    case "stop":
      cancel();
      break;
  }
};

function cancel() {
  if (job) {
    job.cancelled = true;
    job.engine?.dispose();
  }
  job = null;
}

const yieldToEvents = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(j) {
  const module = await modulePromise;
  if (j.cancelled) return;
  const engine = new SidAudioEngine({ module, sampleRate: j.sampleRate, stereo: j.channels === 2 });
  j.engine = engine;
  await engine.loadSidBuffer(new Uint8Array(j.bytes), j.song);
  if (j.startFrame > 0) await engine.seekSeconds(j.startFrame / j.sampleRate);
  if (j.cancelled) return;
  self.postMessage({ type: "started", token: j.token, info: engine.getTuneInfo() });

  const framesPerBucket = Math.round(j.sampleRate / PEAK_BUCKETS_PER_SECOND);
  let frame = j.startFrame;
  while (!j.cancelled && frame < j.stopFrame) {
    if (frame - playheadFrame > MAX_AHEAD_SECONDS * j.sampleRate) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    const pcm = await engine.renderFrames(CHUNK_FRAMES);
    if (j.cancelled) return;
    if (!pcm || pcm.length === 0) break;       // tune stopped producing audio
    const frames = pcm.length / j.channels;
    const peaks = computePeaks(pcm, j.channels, framesPerBucket);
    self.postMessage({ type: "peaks", token: j.token, startFrame: frame, framesPerBucket, peaks }, [peaks.buffer]);
    worklet.postMessage({ type: "chunk", token: j.token, startFrame: frame, pcm }, [pcm.buffer]);
    frame += frames;
    self.postMessage({ type: "progress", token: j.token, frame });
    await yieldToEvents();
  }
  if (!j.cancelled) self.postMessage({ type: "done", token: j.token, frame });
}

// RMS loudness (0..1) per waveform bucket; SID tunes peak near full scale
// almost everywhere, so RMS shows far more of the song's shape. Chunk
// boundaries don't align with buckets; the caller merges partial buckets.
function computePeaks(pcm, channels, framesPerBucket) {
  const frames = pcm.length / channels;
  const buckets = Math.ceil(frames / framesPerBucket);
  const levels = new Float32Array(buckets);
  for (let b = 0; b < buckets; b++) {
    const from = b * framesPerBucket, to = Math.min(frames, from + framesPerBucket);
    let sum = 0;
    for (let f = from; f < to; f++) {
      const s = pcm[f * channels] / 32768;
      sum += s * s;
    }
    levels[b] = Math.sqrt(sum / (to - from));
  }
  return levels;
}

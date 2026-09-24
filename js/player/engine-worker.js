// Module worker that renders a SID subtune with libsidplayfp (reSIDfp) and
// streams the PCM to the AudioWorklet. The player runs two of these:
//
// - role "live":  renders just ahead of the playhead, so sound changes apply
//                 to what you hear within ~0.25 s.
// - role "cache": pre-renders the whole tune as fast as the engine allows
//                 (roughly 3-15x realtime) for instant seeking and scrubbing.
//
// Messages: worklet-port, load {role, token, gen, ...}, sound {token, sound}, peaks {token, peaks}, stop.

import loadLibsidplayfp, { SidAudioEngine } from "https://cdn.jsdelivr.net/npm/libsidplayfp-wasm@1.0.1/dist/index.js";

const ROLES = {
  live: { chunkFrames: 2048, aheadSeconds: 0.25, idleMs: 10 },
  cache: { chunkFrames: 8192, aheadSeconds: 540, idleMs: 250 },
};
const PEAK_BUCKETS_PER_SECOND = 10;   // waveform overview resolution

const modulePromise = loadLibsidplayfp({ engine: "residfp" });
let worklet = null;                   // MessagePort to the AudioWorklet
let job = null;                       // the render currently in progress
let playheadFrame = 0;

self.onmessage = (e) => {
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
      job = { ...msg, cancelled: false, pendingSound: null };
      render(job).catch((err) => {
        if (!job?.cancelled) self.postMessage({ type: "error", token: msg.token, message: String(err?.message || err) });
      });
      break;
    case "sound":
      // Applied between chunks, so it never races a render call.
      if (job && msg.token === job.token) job.pendingSound = msg.sound;
      break;
    case "peaks":
      // The live engine draws the waveform when nothing is pre-rendered.
      if (job && msg.token === job.token) job.peaks = msg.peaks;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function applySound(engine, sound) {
  await engine.setEmulationConfig(sound.emulation);   // reloads the tune from its start
  if (engine.supportsFilterConfig()) engine.setFilterConfig(sound.filter);
}

async function render(j) {
  const module = await modulePromise;
  if (j.cancelled) return;
  const role = ROLES[j.role];
  const engine = new SidAudioEngine({ module, sampleRate: j.sampleRate, stereo: j.channels === 2 });
  j.engine = engine;
  await engine.loadSidBuffer(new Uint8Array(j.bytes), j.song);
  if (j.sound) await applySound(engine, j.sound);
  if (j.startFrame > 0) await engine.seekSeconds(j.startFrame / j.sampleRate);
  if (j.cancelled) return;

  const framesPerBucket = Math.round(j.sampleRate / PEAK_BUCKETS_PER_SECOND);
  let frame = j.startFrame;
  while (!j.cancelled && frame < j.stopFrame) {
    if (j.pendingSound) frame = await changeSound(j, engine, frame);
    if (j.cancelled) return;
    if (frame - playheadFrame > role.aheadSeconds * j.sampleRate) {
      await sleep(role.idleMs);
      continue;
    }
    const pcm = await engine.renderFrames(role.chunkFrames);
    if (j.cancelled) return;
    if (!pcm || pcm.length === 0) break;       // tune stopped producing audio
    const frames = pcm.length / j.channels;
    if (j.peaks) {
      const peaks = computePeaks(pcm, j.channels, framesPerBucket);
      self.postMessage({ type: "peaks", token: j.token, startFrame: frame, framesPerBucket, peaks }, [peaks.buffer]);
    }
    worklet.postMessage({ type: "chunk", role: j.role, gen: j.gen, token: j.token, startFrame: frame, pcm }, [pcm.buffer]);
    frame += frames;
    self.postMessage({ type: "progress", role: j.role, token: j.token, frame });
    await sleep(0);                            // let messages (playhead, sound) in between chunks
  }
  if (!j.cancelled) self.postMessage({ type: "done", role: j.role, token: j.token, frame });
}

// Filter tweaks apply to the running engine at once. A chip/machine change
// reloads the tune, so it is fast-forwarded back to where playback is.
async function changeSound(j, engine, frame) {
  const next = j.pendingSound;
  j.pendingSound = null;
  const emulationChanged = JSON.stringify(next.emulation) !== JSON.stringify(j.sound?.emulation);
  j.sound = next;
  if (!emulationChanged) {
    if (engine.supportsFilterConfig()) engine.setFilterConfig(next.filter);
    return frame;
  }
  await applySound(engine, next);
  const target = Math.max(playheadFrame, j.startFrame);
  if (target > 0) await engine.seekSeconds(target / j.sampleRate);
  return target;
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

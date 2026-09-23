// AudioWorklet that plays a SID tune from a growing PCM buffer.
//
// The engine worker renders the whole subtune ahead of playback (reSIDfp runs
// well above realtime) and streams fixed-size Int16 chunks straight into this
// processor through a MessagePort. Because everything already rendered stays in
// memory, seeking inside it is instant and scrubbing can play short grains at
// the finger position.

const CHUNK_FRAMES = 8192;          // must match engine-worker.js
const FADE_FRAMES = 256;            // click-free ramp after a seek/resume
const GRAIN_FRAMES = 2048;          // ~45 ms scrub grain
const POS_REPORT_FRAMES = 4096;     // ~10 position reports per second
const EVICT_ABOVE_SECONDS = 600;    // keep at most ~10 min of PCM ...
const KEEP_BEHIND_SECONDS = 60;     // ... dropping what lies this far behind

class SidPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.token = 0;
    this.channels = 1;
    this.chunks = [];        // Int16Array chunks, contiguous from baseFrame
    this.baseFrame = 0;      // absolute frame of chunks[0][0]
    this.endFrame = 0;       // absolute frame after the last rendered sample
    this.stopFrame = Infinity;
    this.playhead = 0;
    this.playing = false;
    this.ended = false;
    this.fade = 0;
    this.scrubFrame = null;
    this.grainPhase = 0;
    this.grainStarts = [0, 0];
    this.sinceReport = 0;
    this.enginePort = null;
    this.port.onmessage = (e) => this.onControl(e.data);
  }

  onControl(msg) {
    switch (msg.type) {
      case "engine-port":
        this.enginePort = msg.port;
        this.enginePort.onmessage = (e) => this.onEngine(e.data);
        break;
      case "reset":
        this.token = msg.token;
        this.channels = msg.channels;
        this.stopFrame = msg.stopFrame;
        this.chunks = [];
        this.baseFrame = this.endFrame = this.playhead = msg.startFrame || 0;
        this.ended = false;
        this.scrubFrame = null;
        this.fade = 0;
        break;
      case "play":
        this.playing = true;
        this.fade = 0;
        break;
      case "pause":
        this.playing = false;
        break;
      case "seek":
        this.playhead = Math.max(0, Math.min(msg.frame, this.stopFrame - 1));
        this.ended = false;
        this.fade = 0;
        this.report();
        break;
      case "scrub":
        this.scrubFrame = msg.frame;
        break;
    }
  }

  onEngine(msg) {
    if (msg.token !== this.token) return;
    if (msg.type === "chunk") {
      if (msg.startFrame !== this.endFrame) {
        // The engine restarted somewhere else (seek past evicted audio).
        this.chunks = [];
        this.baseFrame = msg.startFrame;
      }
      this.chunks.push(msg.pcm);
      this.endFrame = msg.startFrame + msg.pcm.length / this.channels;
      this.evict();
    }
  }

  evict() {
    const maxFrames = EVICT_ABOVE_SECONDS * sampleRate;
    const keepFrom = this.playhead - KEEP_BEHIND_SECONDS * sampleRate;
    while (this.endFrame - this.baseFrame > maxFrames && this.baseFrame + CHUNK_FRAMES < keepFrom) {
      this.chunks.shift();
      this.baseFrame += CHUNK_FRAMES;
    }
  }

  // Sample of channel `ch` at absolute frame `frame`, or null if not rendered.
  sampleAt(frame, ch) {
    if (frame < this.baseFrame || frame >= this.endFrame) return null;
    const rel = frame - this.baseFrame;
    const chunk = this.chunks[(rel / CHUNK_FRAMES) | 0];
    const i = (rel % CHUNK_FRAMES) * this.channels + (this.channels > 1 ? ch : 0);
    return chunk[i] / 32768;
  }

  report() {
    this.sinceReport = 0;
    const msg = { type: "pos", frame: this.playhead, base: this.baseFrame, end: this.endFrame, waiting: this.isWaiting() };
    this.port.postMessage(msg);
    this.enginePort?.postMessage({ type: "pos", token: this.token, frame: this.playhead });
  }

  isWaiting() {
    return this.playing && !this.ended && (this.playhead < this.baseFrame || this.playhead >= this.endFrame);
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    const n = left.length;
    if (this.scrubFrame !== null) {
      this.renderScrub(left, right, n);
    } else if (this.playing && !this.ended) {
      this.renderPlay(left, right, n);
    } else {
      left.fill(0);
      right.fill(0);
    }
    this.sinceReport += n;
    if (this.sinceReport >= POS_REPORT_FRAMES) this.report();
    return true;
  }

  renderPlay(left, right, n) {
    for (let i = 0; i < n; i++) {
      const l = this.sampleAt(this.playhead, 0);
      if (l === null) {                     // not rendered yet: wait in silence
        left.fill(0, i);
        right.fill(0, i);
        this.fade = 0;
        return;
      }
      const gain = this.fade < FADE_FRAMES ? this.fade++ / FADE_FRAMES : 1;
      left[i] = l * gain;
      right[i] = this.sampleAt(this.playhead, 1) * gain;
      if (++this.playhead >= this.stopFrame) {
        this.ended = true;
        left.fill(0, i + 1);
        right.fill(0, i + 1);
        this.port.postMessage({ type: "ended", token: this.token });
        return;
      }
    }
  }

  // Two Hann-windowed grains at 50% overlap, each restarting at the latest
  // scrub position, give an audible "tape scrub" without clicks.
  renderScrub(left, right, n) {
    const half = GRAIN_FRAMES / 2;
    for (let i = 0; i < n; i++) {
      let l = 0, r = 0;
      for (let g = 0; g < 2; g++) {
        const phase = (this.grainPhase + g * half) % GRAIN_FRAMES;
        if (phase === 0) this.grainStarts[g] = this.scrubFrame;
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * phase) / GRAIN_FRAMES);
        const frame = this.grainStarts[g] + phase;
        l += (this.sampleAt(frame, 0) ?? 0) * w;
        r += (this.sampleAt(frame, 1) ?? 0) * w;
      }
      left[i] = l;
      right[i] = r;
      this.grainPhase = (this.grainPhase + 1) % GRAIN_FRAMES;
    }
  }
}

registerProcessor("sid-player", SidPlayerProcessor);

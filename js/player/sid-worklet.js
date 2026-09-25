// AudioWorklet that plays a SID tune from two PCM sources:
//
// - live:  a short queue (~0.25 s) from the live engine, which renders in step
//          with playback so sound changes are heard at once. Preferred.
// - cache: the whole tune, pre-rendered as fast as the engine allows. Used for
//          instant seeks, audible scrubbing, and whenever the live engine is
//          still catching up (right after a seek or a chip change).
//
// SID emulation is deterministic, so both sources hold identical samples for
// the same settings and switching between them is seamless.
//
// Chunks carry a generation number per source: a higher one replaces what that
// source had (a restarted render), a lower one is stale and dropped.

const FADE_FRAMES = 256;            // click-free ramp after a seek/resume/gap
const GRAIN_FRAMES = 2048;          // ~45 ms scrub grain
const POS_REPORT_FRAMES = 2048;     // ~23 position reports per second
const EVICT_ABOVE_SECONDS = 600;    // keep at most ~10 min of cached PCM ...
const KEEP_BEHIND_SECONDS = 60;     // ... dropping what lies this far behind

class SidPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.token = 0;
    this.channels = 1;
    this.stopFrame = Infinity;
    this.playhead = 0;
    this.playing = false;
    this.ended = false;
    this.fade = 0;
    this.scrubFrame = null;
    this.grainPhase = 0;
    this.grainStarts = [0, 0];
    this.sinceReport = 0;
    this.enginePorts = [];
    this.clearLive(0);
    this.clearCache(0);
    this.port.onmessage = (e) => this.onControl(e.data);
  }

  clearLive(gen) {
    this.liveGen = gen;
    this.live = [];               // [{start, frames, pcm}], sorted, contiguous
  }

  clearCache(gen, startFrame = this.playhead) {
    this.cacheGen = gen;
    this.chunks = [];             // cached Int16Array chunks, contiguous from baseFrame
    this.chunkFrames = 0;
    this.baseFrame = this.endFrame = startFrame;
  }

  onControl(msg) {
    switch (msg.type) {
      case "engine-port": {
        const port = msg.port;
        port.onmessage = (e) => this.onEngine(e.data);
        this.enginePorts.push(port);
        break;
      }
      case "reset":
        this.token = msg.token;
        this.channels = msg.channels;
        this.stopFrame = msg.stopFrame;
        this.playhead = msg.startFrame || 0;
        this.clearLive(0);
        this.clearCache(0);
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
        this.live = [];               // belongs to the old position; the live engine re-syncs
        this.report();
        break;
      case "scrub":
        this.scrubFrame = msg.frame;
        break;
      case "cache-clear":
        this.clearCache(this.cacheGen);
        this.report();
        break;
    }
  }

  onEngine(msg) {
    if (msg.token !== this.token || msg.type !== "chunk") return;
    if (msg.role === "live") this.addLive(msg);
    else this.addCache(msg);
  }

  addLive({ gen, startFrame, pcm }) {
    if (gen < this.liveGen) return;
    if (gen > this.liveGen) this.clearLive(gen);
    const frames = pcm.length / this.channels;
    // A re-sync can resend frames we already hold: newer audio wins.
    this.live = this.live.filter((c) => c.start < startFrame);
    const last = this.live[this.live.length - 1];
    if (last && last.start + last.frames > startFrame) {
      last.frames = startFrame - last.start;
      last.pcm = last.pcm.subarray(0, last.frames * this.channels);
    }
    if (startFrame + frames > this.playhead) this.live.push({ start: startFrame, frames, pcm });
  }

  addCache({ gen, startFrame, pcm }) {
    if (gen < this.cacheGen) return;
    if (gen > this.cacheGen || startFrame !== this.endFrame) this.clearCache(gen, startFrame);
    if (!this.chunkFrames) this.chunkFrames = pcm.length / this.channels;
    this.chunks.push(pcm);
    this.endFrame = startFrame + pcm.length / this.channels;
    this.evict();
  }

  evict() {
    const maxFrames = EVICT_ABOVE_SECONDS * sampleRate;
    const keepFrom = this.playhead - KEEP_BEHIND_SECONDS * sampleRate;
    while (this.endFrame - this.baseFrame > maxFrames && this.baseFrame + this.chunkFrames < keepFrom) {
      this.chunks.shift();
      this.baseFrame += this.chunkFrames;
    }
  }

  dropPlayedLive() {
    while (this.live.length && this.live[0].start + this.live[0].frames <= this.playhead) this.live.shift();
  }

  cachedAt(frame, ch) {
    if (frame < this.baseFrame || frame >= this.endFrame) return null;
    const rel = frame - this.baseFrame;
    const chunk = this.chunks[(rel / this.chunkFrames) | 0];
    return chunk[(rel % this.chunkFrames) * this.channels + (this.channels > 1 ? ch : 0)] / 32768;
  }

  // Sample of channel `ch` at absolute `frame`: live first, then cache; null if neither has it.
  sampleAt(frame, ch) {
    for (const c of this.live) {
      if (frame < c.start) break;
      if (frame < c.start + c.frames) return c.pcm[(frame - c.start) * this.channels + (this.channels > 1 ? ch : 0)] / 32768;
    }
    return this.cachedAt(frame, ch);
  }

  liveEnd() {
    const last = this.live[this.live.length - 1];
    return last ? last.start + last.frames : this.playhead;
  }

  report() {
    this.sinceReport = 0;
    const waiting = this.playing && !this.ended && this.sampleAt(this.playhead, 0) === null;
    this.port.postMessage({ type: "pos", frame: this.playhead, base: this.baseFrame, end: this.endFrame, liveEnd: this.liveEnd(), waiting });
    // Engines also learn what the cache holds, so the live one can park (see engine-worker.js).
    for (const port of this.enginePorts) port.postMessage({ type: "pos", token: this.token, frame: this.playhead, cacheFrom: this.baseFrame, cacheTo: this.endFrame, cacheGen: this.cacheGen });
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    const n = left.length;
    if (this.scrubFrame !== null) {
      this.renderScrub(left, right, n);
    } else if (this.playing && !this.ended) {
      this.renderPlay(left, right, n);
      this.dropPlayedLive();
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
      if (l === null) {                     // nothing rendered here yet: wait in silence
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
  // scrub position, give an audible "tape scrub" without clicks. Cache only.
  renderScrub(left, right, n) {
    const half = GRAIN_FRAMES / 2;
    for (let i = 0; i < n; i++) {
      let l = 0, r = 0;
      for (let g = 0; g < 2; g++) {
        const phase = (this.grainPhase + g * half) % GRAIN_FRAMES;
        if (phase === 0) this.grainStarts[g] = this.scrubFrame;
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * phase) / GRAIN_FRAMES);
        const frame = this.grainStarts[g] + phase;
        l += (this.cachedAt(frame, 0) ?? 0) * w;
        r += (this.cachedAt(frame, 1) ?? 0) * w;
      }
      left[i] = l;
      right[i] = r;
      this.grainPhase = (this.grainPhase + 1) % GRAIN_FRAMES;
    }
  }
}

registerProcessor("sid-player", SidPlayerProcessor);

// Player facade: owns the AudioContext, the render workers and the worklet,
// plus the play queue. UI code only talks to this class.
//
// Two engines render each tune (see engine-worker.js / sid-worklet.js):
// - live:  just ahead of the playhead, where sound changes apply at once.
//          It parks while the cache holds the audio ahead, so a tune is
//          normally emulated once; with the Sound sheet open it stays in step.
// - cache: the whole tune pre-rendered, for instant seeks and audible
//          scrubbing. Optional (setPrerender), and paused while the sound is
//          being adjusted (setAdjusting), then re-rendered with the new sound.
//          Until live has caught up with a change, the cache's old sound
//          plays on rather than silence.
//
// With the Ultimate 64 as output (setOutput "u64") nothing renders here: the
// device plays the tune (see u64.js) and a clock stands in for the worklet's
// position. It always plays from the start, so seeking and resuming restart it.
//
// Events (all CustomEvent, detail as listed):
//   track  {item, index}                 a new queue item was loaded
//   state  {state}                       "idle" | "loading" | "playing" | "paused" | "buffering"
//   time   {position, duration, buffered, bufferedFrom}  seconds
//   peaks  {peaks, bucketsPerSecond}     waveform overview grew
//   queue  {queue, index}
//   scrub  {enabled}                     whether audible scrubbing is available
//   repeat {mode}                        "off" | "all" (the queue) | "one" (the tune)
//   shuffle {on}
//   error  {message, item}
//   speed  {engine, ratio}               how fast reSIDfp pre-renders here (x realtime), measured once
//   output {remote}                      tunes now play here (false) or on the Ultimate (true)
//   stall  {engine}                      playback ran out of audio, not right after a seek or change

import { Ultimate64 } from "./u64.js";

const PEAK_BUCKETS_PER_SECOND = 10;
const DEFAULT_SONG_SECONDS = 180;       // tunes missing from Songlengths.md5
const RESTART_THRESHOLD_SECONDS = 3;    // "previous" restarts the tune after this
const MAX_CONSECUTIVE_ERRORS = 5;
export const REPEAT_MODES = ["off", "all", "one"];
const LOOP_SEARCH_SECONDS = 3;          // a tune looping back early shows in its last seconds ...
const LOOP_QUIET_LEVEL = 0.01;          // ... as near-silence (RMS) ...
const LOOP_QUIET_SECONDS = 0.3;         // ... held this long ...
const LOOP_RESTART_LEVEL = 0.05;        // ... then loud again: its start playing once more

export function shuffle(items) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Where a tune that loops back before its listed length really ends (seconds),
// or null. Songlengths.md5 can run a second or so long, and the tune's start
// would then be heard again. `peaks` are RMS levels per waveform bucket.
export function loopedEnd(peaks, bucketsPerSecond, duration) {
  const last = Math.min(peaks.length, Math.floor(duration * bucketsPerSecond));
  const minQuiet = Math.round(LOOP_QUIET_SECONDS * bucketsPerSecond);
  let quiet = 0;
  for (let b = Math.max(0, last - Math.round(LOOP_SEARCH_SECONDS * bucketsPerSecond)); b < last; b++) {
    if (peaks[b] < LOOP_QUIET_LEVEL) quiet++;
    else if (peaks[b] > LOOP_RESTART_LEVEL && quiet >= minQuiet) return b / bucketsPerSecond;
    else quiet = 0;
  }
  return null;
}

const assetUrl = (path) => new URL(path, import.meta.url).href;
const REMOTE_TICK_MS = 250;
const SPEED_WARMUP_SECONDS = 1;         // audio pre-rendered before timing starts (module compile, first chunks)
const SPEED_MIN_WALL_SECONDS = 3;       // then timed over at least this long
const STALL_GRACE_MS = 3000;            // after a start, seek or change, waiting for audio isn't a stall

export class Player extends EventTarget {
  constructor({ sidUrls, prerender = true, engine = "residfp", u64Host = "" }) {
    super();
    this.sidUrls = sidUrls;             // (item) => candidate URLs of the .sid file
    this.engine = engine === "u64" ? "residfp" : engine;   // what the workers render with
    this.u64 = engine === "u64" ? new Ultimate64(u64Host) : null;   // set: the tune plays there instead
    this.remoteStart = 0;               // performance.now() when the device started the tune
    this.remoteTimer = 0;
    this.speedRun = null;               // the pre-render being timed, see timeRender()
    this.speedMeasured = false;
    this.stallGraceUntil = 0;
    this.sound = null;                  // {emulation, filter} for the engine, see sound-profile.js
    this.prerender = prerender;
    this.adjusting = false;             // Sound sheet open: live changes, no pre-render
    this.cacheDirty = false;            // sound changed since the cache was rendered
    this.freshCacheGen = Infinity;      // first cache render with the current sound (live parks only on that)
    this.queue = [];
    this.index = -1;
    this.repeat = "off";
    this.shuffle = false;
    this.ordered = [];                  // the queue as given, restored when shuffle goes off
    this.state = "idle";
    this.token = 0;                     // per loaded track
    this.gen = 0;                       // per render job, see sid-worklet.js
    this.position = 0;
    this.duration = 0;
    this.buffered = 0;
    this.bufferedFrom = 0;
    this.cacheBase = this.cacheEnd = this.liveEnd = 0;   // frames, from the worklet
    this.peaks = new Float32Array(0);
    this.errors = 0;
    this.audioReady = null;
  }

  get current() {
    return this.queue[this.index] ?? null;
  }

  get canScrub() {
    return this.prerender && !this.adjusting && !this.u64;
  }

  // The live engine may rest on the cache unless the sound is being adjusted.
  get livePark() {
    return this.prerender && !this.adjusting;
  }

  // Must be first called from a user gesture (iOS unlocks audio only then).
  ensureAudio() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "playback" });
      // Safari 17+: play through the ringer/mute switch like a music app.
      if (navigator.audioSession) navigator.audioSession.type = "playback";
      this.audioReady = this.initAudioGraph();
    }
    if (this.ctx.state !== "running") this.ctx.resume().catch(() => {});
    return this.audioReady;
  }

  async initAudioGraph() {
    await this.ctx.audioWorklet.addModule(assetUrl("./sid-worklet.js"));
    this.node = new AudioWorkletNode(this.ctx, "sid-player", { numberOfInputs: 0, outputChannelCount: [2] });
    this.node.connect(this.ctx.destination);
    this.node.port.onmessage = (e) => this.onWorklet(e.data);
    this.liveWorker = this.createWorker("live");
    if (this.prerender) this.cacheWorker = this.createWorker("cache");
  }

  createWorker(role) {
    const worker = new Worker(assetUrl("./engine-worker.js"), { type: "module" });
    worker.onmessage = (e) => this.onWorker(e.data);
    worker.onerror = (e) => this.fail(e.message || "Engine failed to start");
    const channel = new MessageChannel();
    worker.postMessage({ type: "worklet-port", port: channel.port1 }, [channel.port1]);
    this.node.port.postMessage({ type: "engine-port", port: channel.port2 }, [channel.port2]);
    return worker;
  }

  // ---- queue -------------------------------------------------------------

  setQueue(items, startIndex = 0) {
    this.ordered = items.slice();
    this.queue = this.shuffle ? this.shuffledFrom(items[startIndex]) : items.slice();
    if (this.shuffle) startIndex = 0;
    this.emit("queue", { queue: this.queue, index: startIndex });
    return this.playIndex(startIndex);
  }

  playNext(item) {
    this.queue.splice(this.index + 1, 0, item);
    this.ordered.splice(this.ordered.indexOf(this.current) + 1, 0, item);
    this.emit("queue", { queue: this.queue, index: this.index });
  }

  enqueue(item) {
    this.queue.push(item);
    this.ordered.push(item);
    this.emit("queue", { queue: this.queue, index: this.index });
  }

  // `first`, then the rest of the queue as given in random order.
  shuffledFrom(first) {
    const rest = this.ordered.filter((item) => item !== first);
    return first ? [first, ...shuffle(rest)] : shuffle(rest);
  }

  // On: what has played stays (so "previous" goes back through it), the rest
  // follows in random order. Off: back to the order given, from the current tune.
  setShuffle(on) {
    if (on === this.shuffle) return;
    this.shuffle = on;
    this.emit("shuffle", { on });
    if (!this.queue.length) return;
    const current = this.current;
    this.queue = on
      ? [...this.queue.slice(0, this.index + 1), ...shuffle(this.queue.slice(this.index + 1))]
      : this.ordered.slice();
    this.index = Math.max(0, this.queue.indexOf(current));
    this.emit("queue", { queue: this.queue, index: this.index });
  }

  async playIndex(index) {
    if (index < 0 || index >= this.queue.length) return;
    const audioReady = this.u64 ? null : this.ensureAudio();
    this.index = index;
    const item = this.queue[index];
    const token = ++this.token;
    this.setState("loading");
    this.graceStall();
    this.duration = item.lengths?.[item.song - 1] || DEFAULT_SONG_SECONDS;
    this.position = this.buffered = this.bufferedFrom = 0;
    this.cacheBase = this.cacheEnd = this.liveEnd = 0;
    this.resetPeaks();
    this.emit("track", { item, index });
    this.emit("queue", { queue: this.queue, index });
    this.emitTime();
    try {
      const [bytes] = await Promise.all([this.fetchSid(item), audioReady]);
      if (token !== this.token) return;
      this.bytes = bytes;
      if (this.u64) return await this.playRemote();
      const sampleRate = this.ctx.sampleRate;
      this.node.port.postMessage({
        type: "reset", token, channels: this.channels(), startFrame: 0, stopFrame: Math.round(this.duration * sampleRate),
      });
      this.startLive(0);
      this.cacheDirty = false;
      if (this.prerender && !this.adjusting) this.startCache(0);
      else this.cacheDirty = this.prerender;
      this.node.port.postMessage({ type: "play" });
    } catch (err) {
      if (token === this.token) this.fail(err.message, item);
    }
  }

  // Try each configured source in turn (mirror, official HVSC, local copy).
  async fetchSid(item) {
    let lastError = null;
    for (const url of this.sidUrls(item)) {
      try {
        const res = await fetch(url);
        if (res.ok) return await res.arrayBuffer();
        lastError = `HTTP ${res.status}`;
      } catch (err) {
        lastError = err.message;
      }
    }
    throw new Error(`Could not load ${item.name} (${lastError})`);
  }

  channels() {
    return this.current?.multiSid ? 2 : 1;
  }

  // Start (or restart) one role's render of the current tune at `startFrame`.
  startJob(worker, role, startFrame, peaks) {
    const sampleRate = this.ctx.sampleRate;
    const copy = this.bytes.slice(0);    // transferred; keep the original for restarts
    worker.postMessage({
      type: "load", role, token: this.token, gen: ++this.gen, bytes: copy, song: this.current.song - 1,
      engine: this.engine, sampleRate, channels: this.channels(), startFrame, stopFrame: Math.round(this.duration * sampleRate),
      sound: this.sound, peaks, parkable: role === "live" && this.livePark, freshCacheGen: this.freshCacheGen,
    }, [copy]);
  }

  startLive(frame) {
    this.startJob(this.liveWorker, "live", frame, !this.prerender);
  }

  startCache(frame) {
    this.cacheWorker ??= this.createWorker("cache");
    if (frame === 0) this.resetPeaks();
    this.cacheDirty = false;
    this.startJob(this.cacheWorker, "cache", frame, true);
    this.speedRun = this.speedMeasured || this.engine !== "residfp" ? null : { gen: this.gen, start: frame, t0: 0, f0: 0 };
    this.freshCacheGen = this.gen;
    this.updateLivePark();
  }

  updateLivePark() {
    this.liveWorker?.postMessage({ type: "park", token: this.token, parkable: this.livePark, freshCacheGen: this.freshCacheGen });
  }

  stopCache() {
    this.speedRun = null;
    this.cacheWorker?.postMessage({ type: "stop" });
  }

  // Apply a new chip/filter setup. The live engine picks it up immediately; the
  // pre-render starts over with it (or once the Sound sheet closes).
  setSound(sound) {
    this.sound = sound;
    this.graceStall();
    if (!this.node || !this.current || !this.bytes || this.u64) return;
    this.liveWorker.postMessage({ type: "sound", token: this.token, sound });
    this.freshCacheGen = Infinity;      // what is cached has the old sound
    this.updateLivePark();
    if (!this.prerender) return;
    if (this.adjusting) this.cacheDirty = true;
    else this.startCache(0);
  }

  // While adjusting the sound, only the live engine runs and scrubbing is off.
  setAdjusting(on) {
    if (on === this.adjusting) return;
    this.adjusting = on;
    this.graceStall();
    this.emit("scrub", { enabled: this.canScrub });
    if (!this.prerender || !this.current || !this.bytes || this.u64) return;
    this.updateLivePark();              // open: live wakes in step
    if (on) this.stopCache();
    else if (this.cacheDirty || this.cacheEnd < Math.round(this.duration * this.ctx.sampleRate) - 1) this.startCache(0);
  }

  setPrerender(on) {
    if (on === this.prerender) return;
    this.prerender = on;
    this.emit("scrub", { enabled: this.canScrub });
    if (!this.node || !this.current || !this.bytes || this.u64) return;
    this.liveWorker.postMessage({ type: "peaks", token: this.token, peaks: !on });
    this.updateLivePark();
    if (on) {
      if (this.adjusting) this.cacheDirty = true;
      else this.startCache(0);
    } else {
      this.stopCache();
      this.node.port.postMessage({ type: "cache-clear" });
      this.resetPeaks();
    }
  }

  // Where tunes play: engine "residfp" or "sidlite" here, or "u64" on the
  // Ultimate at `u64Host`. The current tune carries on with the new one
  // (from the start on the Ultimate, which can't seek).
  setOutput(engine, u64Host = "") {
    const remote = engine === "u64";
    const local = remote ? this.engine : engine;
    if (remote === !!this.u64 && local === this.engine && (!remote || u64Host === this.u64.host)) return;
    const wasRemote = !!this.u64;
    const engineChanged = local !== this.engine;
    const playing = this.state !== "paused" && this.state !== "idle";
    this.engine = local;
    this.graceStall();
    if (wasRemote && playing) this.stopRemote();   // silence the device we leave, if we were playing on it
    else clearInterval(this.remoteTimer);
    this.u64 = remote ? new Ultimate64(u64Host) : null;
    if (remote !== wasRemote) this.emit("output", { remote });
    this.emit("scrub", { enabled: this.canScrub });
    if (!this.current || !this.bytes) return;
    if (remote) {
      if (!wasRemote) this.stopLocal();
      if (playing) this.playRemote();
    } else if (wasRemote) {
      this.playIndex(this.index).then(() => playing || this.pause());
    } else if (engineChanged && this.node) {
      this.startLive(Math.round(this.position * this.ctx.sampleRate));
      this.freshCacheGen = Infinity;    // what is cached came from the other engine
      this.updateLivePark();
      if (this.prerender && this.adjusting) this.cacheDirty = true;
      else if (this.prerender) this.startCache(0);
    }
  }

  // ---- Ultimate 64 --------------------------------------------------------

  stopLocal() {
    this.node?.port.postMessage({ type: "pause" });
    this.liveWorker?.postMessage({ type: "stop" });
    this.stopCache();
    this.resetPeaks();
  }

  // Start the current tune on the device, from its beginning.
  async playRemote() {
    const token = this.token;
    const u64 = this.u64;
    clearInterval(this.remoteTimer);
    this.position = 0;
    this.setState("loading");
    this.emitTime();
    try {
      await u64.play(this.bytes, this.current.song);
    } catch (err) {
      if (token !== this.token || u64 !== this.u64) return;
      this.setState("paused");
      this.emit("error", { message: err.message, item: this.current });
      return;
    }
    if (token !== this.token || u64 !== this.u64) return;
    this.errors = 0;
    this.remoteStart = performance.now();
    this.remoteTimer = setInterval(() => this.remoteTick(), REMOTE_TICK_MS);
    this.setState("playing");
  }

  remoteTick() {
    this.position = Math.min(this.duration, (performance.now() - this.remoteStart) / 1000);
    this.emitTime();
    if (this.position < this.duration) return;
    clearInterval(this.remoteTimer);
    if (this.repeat === "one") this.playRemote();
    else this.next();
  }

  stopRemote() {
    clearInterval(this.remoteTimer);
    this.u64?.stop().catch(() => {});
  }

  setRepeat(mode) {
    if (!REPEAT_MODES.includes(mode) || mode === this.repeat) return;
    this.repeat = mode;
    this.emit("repeat", { mode });
  }

  // Index after the current one, wrapping round when the queue repeats (-1: none).
  get nextIndex() {
    if (this.index + 1 < this.queue.length) return this.index + 1;
    return this.repeat === "all" && this.queue.length ? 0 : -1;
  }

  // Index before the current one, wrapping round when the queue repeats (-1: none).
  get previousIndex() {
    if (this.index > 0) return this.index - 1;
    return this.repeat === "all" && this.queue.length > 1 ? this.queue.length - 1 : -1;
  }

  next() {
    if (this.nextIndex >= 0) return this.playIndex(this.nextIndex);
    this.pause();
    this.seek(0);
  }

  previous() {
    if (this.position > RESTART_THRESHOLD_SECONDS || this.previousIndex < 0) return this.seek(0);
    return this.playIndex(this.previousIndex);
  }

  // Switch subtune of the current item (1-based).
  selectSong(song) {
    const item = this.current;
    if (!item || song === item.song) return;
    const updated = { ...item, song, queuedSong: item.queuedSong ?? item.song };   // lists keep marking the row played from
    this.queue[this.index] = updated;
    const at = this.ordered.indexOf(item);
    if (at >= 0) this.ordered[at] = updated;
    return this.playIndex(this.index);
  }

  // Once the whole tune is rendered: end at the silence before it loops back, if it does.
  trimLoopedEnd() {
    const end = loopedEnd(this.peaks, PEAK_BUCKETS_PER_SECOND, this.duration);
    if (end === null) return;
    this.duration = end;
    this.node.port.postMessage({ type: "stop-at", frame: Math.round(end * this.ctx.sampleRate) });
    this.emitTime();
  }

  // ---- transport ---------------------------------------------------------

  play() {
    if (!this.current) return;
    if (this.u64) return this.bytes ? this.playRemote() : this.playIndex(this.index);
    this.ensureAudio();
    this.graceStall();
    this.node?.port.postMessage({ type: "play" });
    this.setState("playing");
  }

  pause() {
    if (this.u64 && this.state !== "paused" && this.state !== "idle") {   // a stop: the next play starts the tune over
      this.stopRemote();
      this.position = 0;
      this.emitTime();
    }
    this.node?.port.postMessage({ type: "pause" });
    if (this.current) this.setState("paused");
  }

  toggle() {
    if (this.state === "paused" || this.state === "idle") this.play();
    else this.pause();
  }

  // The cache (when it has the target) plays at once; the live engine always
  // re-syncs to the new position in the background.
  seek(seconds) {
    if (this.u64) {                     // the device can only start over
      if (seconds < 1 && this.current && this.bytes && this.state !== "paused") this.playRemote();
      return;
    }
    if (!this.node || !this.current || !this.bytes) return;
    const s = Math.max(0, Math.min(seconds, this.duration - 0.05));
    const frame = Math.round(s * this.ctx.sampleRate);
    this.graceStall();
    this.node.port.postMessage({ type: "seek", frame });
    this.startLive(frame);
    // Audio before the cache window was evicted (very long tune): pre-render from here.
    if (this.prerender && !this.adjusting && frame < this.cacheBase) this.startCache(frame);
    this.position = s;
    this.emitTime();
  }

  // Audible scrubbing: call scrub(seconds) while dragging, scrub(null) to stop.
  scrub(seconds) {
    if (!this.node || (seconds !== null && !this.canScrub)) return;
    const frame = seconds === null ? null : Math.round(seconds * this.ctx.sampleRate);
    this.node.port.postMessage({ type: "scrub", frame });
  }

  // ---- messages ------------------------------------------------------------

  onWorklet(msg) {
    if (this.u64) return;
    if (msg.type === "pos") {
      const sr = this.ctx.sampleRate;
      this.position = msg.frame / sr;
      this.cacheBase = msg.base;
      this.cacheEnd = msg.end;
      this.liveEnd = msg.liveEnd;
      if (this.prerender && msg.end > msg.base) {
        this.buffered = msg.end / sr;
        this.bufferedFrom = msg.base / sr;
      } else if (!this.prerender) {
        this.buffered = Math.max(this.buffered, msg.liveEnd / sr);
        this.bufferedFrom = 0;
      }
      const ready = !msg.waiting && (msg.liveEnd > msg.frame || (msg.end > msg.frame && msg.base <= msg.frame));
      if (this.state === "playing" && msg.waiting) {
        this.noteStall();
        this.setState("buffering");
      }
      else if ((this.state === "buffering" || this.state === "loading") && ready) this.setState("playing");
      this.emitTime();
    } else if (msg.type === "ended" && msg.token === this.token) {
      this.errors = 0;
      if (this.repeat === "one") this.seek(0);
      else this.next();
    }
  }

  onWorker(msg) {
    if (msg.token !== this.token || this.u64) return;
    switch (msg.type) {
      case "peaks": {
        const first = Math.floor(msg.startFrame / msg.framesPerBucket);
        for (let i = 0; i < msg.peaks.length && first + i < this.peaks.length; i++) {
          this.peaks[first + i] = Math.max(this.peaks[first + i], msg.peaks[i]);
        }
        this.emitPeaks();
        break;
      }
      case "done":
        if (msg.role !== "cache") break;
        this.timeRender(msg, true);
        this.trimLoopedEnd();
        break;
      case "progress":
        if (msg.role === "live") this.errors = 0;
        else this.timeRender(msg);
        break;
      case "error":
        this.fail(msg.message, this.current);
        break;
    }
  }

  // How fast reSIDfp renders on this device, from the first pre-render that
  // runs long enough in a visible tab (hidden ones are throttled). Costs
  // nothing: the tune is being rendered anyway.
  timeRender(msg, done = false) {
    const run = this.speedRun;
    if (!run || msg.gen !== run.gen) return;
    if (document.visibilityState !== "visible") {
      this.speedRun = null;             // try again with the next tune
      return;
    }
    const now = performance.now();
    const sr = this.ctx.sampleRate;
    if (!run.t0) {
      if (msg.frame - run.start >= SPEED_WARMUP_SECONDS * sr) Object.assign(run, { t0: now, f0: msg.frame });
      return;
    }
    const wall = (now - run.t0) / 1000;
    if (wall < SPEED_MIN_WALL_SECONDS && !done) return;
    this.speedRun = null;
    if (wall < 0.5) return;             // a short tune, done too soon to tell
    this.speedMeasured = true;
    this.emit("speed", { engine: this.engine, ratio: (msg.frame - run.f0) / sr / wall });
  }

  graceStall() {
    this.stallGraceUntil = performance.now() + STALL_GRACE_MS;
  }

  noteStall() {
    if (this.u64 || performance.now() < this.stallGraceUntil || document.visibilityState !== "visible") return;
    this.emit("stall", { engine: this.engine });
  }

  fail(message, item) {
    this.emit("error", { message, item });
    if (++this.errors >= MAX_CONSECUTIVE_ERRORS || this.nextIndex < 0 || this.nextIndex === this.index) {
      this.pause();
      return;
    }
    this.playIndex(this.nextIndex);
  }

  setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.emit("state", { state });
  }

  resetPeaks() {
    this.peaks = new Float32Array(Math.ceil(this.duration * PEAK_BUCKETS_PER_SECOND));
    this.emitPeaks();
  }

  emitTime() {
    this.emit("time", { position: this.position, duration: this.duration, buffered: this.buffered, bufferedFrom: this.bufferedFrom });
  }

  emitPeaks() {
    this.emit("peaks", { peaks: this.peaks, bucketsPerSecond: PEAK_BUCKETS_PER_SECOND });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

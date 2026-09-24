// Player facade: owns the AudioContext, the render workers and the worklet,
// plus the play queue. UI code only talks to this class.
//
// Two engines render each tune (see engine-worker.js / sid-worklet.js):
// - live:  just ahead of the playhead; what you normally hear, and where sound
//          changes apply at once.
// - cache: the whole tune pre-rendered, for instant seeks and audible
//          scrubbing. Optional (setPrerender), and paused while the sound is
//          being adjusted (setAdjusting), then re-rendered with the new sound.
//
// Events (all CustomEvent, detail as listed):
//   track  {item, index}                 a new queue item was loaded
//   state  {state}                       "idle" | "loading" | "playing" | "paused" | "buffering"
//   time   {position, duration, buffered, bufferedFrom}  seconds
//   peaks  {peaks, bucketsPerSecond}     waveform overview grew
//   queue  {queue, index}
//   scrub  {enabled}                     whether audible scrubbing is available
//   error  {message, item}

const PEAK_BUCKETS_PER_SECOND = 10;
const DEFAULT_SONG_SECONDS = 180;       // tunes missing from Songlengths.md5
const RESTART_THRESHOLD_SECONDS = 3;    // "previous" restarts the tune after this
const MAX_CONSECUTIVE_ERRORS = 5;

const assetUrl = (path) => new URL(path, import.meta.url).href;

export class Player extends EventTarget {
  constructor({ sidUrls, prerender = true }) {
    super();
    this.sidUrls = sidUrls;             // (item) => candidate URLs of the .sid file
    this.sound = null;                  // {emulation, filter} for the engine, see sound-profile.js
    this.prerender = prerender;
    this.adjusting = false;             // Sound sheet open: live changes, no pre-render
    this.cacheDirty = false;            // sound changed since the cache was rendered
    this.queue = [];
    this.index = -1;
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
    this.queue = items.slice();
    this.emit("queue", { queue: this.queue, index: startIndex });
    return this.playIndex(startIndex);
  }

  playNext(item) {
    this.queue.splice(this.index + 1, 0, item);
    this.emit("queue", { queue: this.queue, index: this.index });
  }

  enqueue(item) {
    this.queue.push(item);
    this.emit("queue", { queue: this.queue, index: this.index });
  }

  async playIndex(index) {
    if (index < 0 || index >= this.queue.length) return;
    const audioReady = this.ensureAudio();
    this.index = index;
    const item = this.queue[index];
    const token = ++this.token;
    this.setState("loading");
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

  // Try each source in turn (remote HVSC first, then an optional self-hosted copy).
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
      sampleRate, channels: this.channels(), startFrame, stopFrame: Math.round(this.duration * sampleRate),
      sound: this.sound, peaks,
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
  }

  stopCache() {
    this.cacheWorker?.postMessage({ type: "stop" });
  }

  // Apply a new chip/filter setup. The live engine picks it up immediately; the
  // pre-render starts over with it (or once the Sound sheet closes).
  setSound(sound) {
    this.sound = sound;
    if (!this.node || !this.current || !this.bytes) return;
    this.liveWorker.postMessage({ type: "sound", token: this.token, sound });
    if (!this.prerender) return;
    if (this.adjusting) this.cacheDirty = true;
    else this.startCache(0);
  }

  // While adjusting the sound, only the live engine runs and scrubbing is off.
  setAdjusting(on) {
    if (on === this.adjusting) return;
    this.adjusting = on;
    this.emit("scrub", { enabled: this.canScrub });
    if (!this.prerender || !this.current || !this.bytes) return;
    if (on) this.stopCache();
    else if (this.cacheDirty || this.cacheEnd < Math.round(this.duration * this.ctx.sampleRate) - 1) this.startCache(0);
  }

  setPrerender(on) {
    if (on === this.prerender) return;
    this.prerender = on;
    this.emit("scrub", { enabled: this.canScrub });
    if (!this.node || !this.current || !this.bytes) return;
    this.liveWorker.postMessage({ type: "peaks", token: this.token, peaks: !on });
    if (on) {
      if (this.adjusting) this.cacheDirty = true;
      else this.startCache(0);
    } else {
      this.stopCache();
      this.node.port.postMessage({ type: "cache-clear" });
      this.resetPeaks();
    }
  }

  next() {
    if (this.index + 1 < this.queue.length) return this.playIndex(this.index + 1);
    this.pause();
    this.seek(0);
  }

  previous() {
    if (this.position > RESTART_THRESHOLD_SECONDS || this.index === 0) return this.seek(0);
    return this.playIndex(this.index - 1);
  }

  // Switch subtune of the current item (1-based).
  selectSong(song) {
    const item = this.current;
    if (!item || song === item.song) return;
    this.queue[this.index] = { ...item, song };
    return this.playIndex(this.index);
  }

  // ---- transport ---------------------------------------------------------

  play() {
    if (!this.current) return;
    this.ensureAudio();
    this.node?.port.postMessage({ type: "play" });
    this.setState("playing");
  }

  pause() {
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
    if (!this.node || !this.current || !this.bytes) return;
    const s = Math.max(0, Math.min(seconds, this.duration - 0.05));
    const frame = Math.round(s * this.ctx.sampleRate);
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
      if (this.state === "playing" && msg.waiting) this.setState("buffering");
      else if ((this.state === "buffering" || this.state === "loading") && ready) this.setState("playing");
      this.emitTime();
    } else if (msg.type === "ended" && msg.token === this.token) {
      this.errors = 0;
      this.next();
    }
  }

  onWorker(msg) {
    if (msg.token !== this.token) return;
    switch (msg.type) {
      case "peaks": {
        const first = Math.floor(msg.startFrame / msg.framesPerBucket);
        for (let i = 0; i < msg.peaks.length && first + i < this.peaks.length; i++) {
          this.peaks[first + i] = Math.max(this.peaks[first + i], msg.peaks[i]);
        }
        this.emitPeaks();
        break;
      }
      case "progress":
        if (msg.role === "live") this.errors = 0;
        break;
      case "error":
        this.fail(msg.message, this.current);
        break;
    }
  }

  fail(message, item) {
    this.emit("error", { message, item });
    if (++this.errors >= MAX_CONSECUTIVE_ERRORS || this.index + 1 >= this.queue.length) {
      this.pause();
      return;
    }
    this.playIndex(this.index + 1);
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

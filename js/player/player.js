// Player facade: owns the AudioContext, the render worker and the worklet,
// plus the play queue. UI code only talks to this class.
//
// Events (all CustomEvent, detail as listed):
//   track  {item, index}                 a new queue item was loaded
//   state  {state}                       "idle" | "loading" | "playing" | "paused" | "buffering"
//   time   {position, duration, buffered, bufferedFrom}  seconds
//   peaks  {peaks, bucketsPerSecond}     waveform overview grew
//   queue  {queue, index}
//   error  {message, item}

const PEAK_BUCKETS_PER_SECOND = 10;
const DEFAULT_SONG_SECONDS = 180;       // tunes missing from Songlengths.md5
const RESTART_THRESHOLD_SECONDS = 3;    // "previous" restarts the tune after this
const MAX_CONSECUTIVE_ERRORS = 5;

const assetUrl = (path) => new URL(path, import.meta.url).href;

export class Player extends EventTarget {
  constructor({ sidUrls }) {
    super();
    this.sidUrls = sidUrls;             // (item) => candidate URLs of the .sid file
    this.queue = [];
    this.index = -1;
    this.state = "idle";
    this.token = 0;
    this.position = 0;
    this.duration = 0;
    this.buffered = 0;
    this.bufferedFrom = 0;
    this.peaks = new Float32Array(0);
    this.errors = 0;
    this.audioReady = null;
  }

  get current() {
    return this.queue[this.index] ?? null;
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

    this.worker = new Worker(assetUrl("./engine-worker.js"), { type: "module" });
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.worker.onerror = (e) => this.fail(e.message || "Engine failed to start");
    const channel = new MessageChannel();
    this.worker.postMessage({ type: "worklet-port", port: channel.port1 }, [channel.port1]);
    this.node.port.postMessage({ type: "engine-port", port: channel.port2 }, [channel.port2]);
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
    this.peaks = new Float32Array(Math.ceil(this.duration * PEAK_BUCKETS_PER_SECOND));
    this.emit("track", { item, index });
    this.emit("queue", { queue: this.queue, index });
    this.emitTime();
    this.emitPeaks();
    try {
      const [bytes] = await Promise.all([this.fetchSid(item), audioReady]);
      if (token !== this.token) return;
      this.startRender(item, bytes, 0);
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

  startRender(item, bytes, startFrame) {
    const sampleRate = this.ctx.sampleRate;
    const stopFrame = Math.round(this.duration * sampleRate);
    const channels = item.multiSid ? 2 : 1;
    this.bytes = bytes;
    this.node.port.postMessage({ type: "reset", token: this.token, channels, startFrame, stopFrame });
    // Transfer a copy so a later restart (seek into evicted audio) can reuse the bytes.
    const copy = bytes.slice(0);
    this.worker.postMessage(
      { type: "load", token: this.token, bytes: copy, song: item.song - 1, sampleRate, channels, startFrame, stopFrame },
      [copy],
    );
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
    this.setState(this.buffered > this.position ? "playing" : "buffering");
  }

  pause() {
    this.node?.port.postMessage({ type: "pause" });
    if (this.current) this.setState("paused");
  }

  toggle() {
    if (this.state === "paused" || this.state === "idle") this.play();
    else this.pause();
  }

  seek(seconds) {
    if (!this.node || !this.current) return;
    const s = Math.max(0, Math.min(seconds, this.duration - 0.05));
    const frame = Math.round(s * this.ctx.sampleRate);
    if (s < this.bufferedFrom) {
      // That audio was evicted (very long tune): re-render from the target.
      this.startRender(this.current, this.bytes, frame);
      this.buffered = this.bufferedFrom = s;
    }
    this.node.port.postMessage({ type: "seek", frame });
    this.position = s;
    this.emitTime();
  }

  // Audible scrubbing: call scrub(seconds) while dragging, scrub(null) to stop.
  scrub(seconds) {
    if (!this.node) return;
    const frame = seconds === null ? null : Math.round(seconds * this.ctx.sampleRate);
    this.node.port.postMessage({ type: "scrub", frame });
  }

  // ---- messages ------------------------------------------------------------

  onWorklet(msg) {
    if (msg.type === "pos") {
      const sr = this.ctx.sampleRate;
      this.position = msg.frame / sr;
      this.buffered = msg.end / sr;
      this.bufferedFrom = msg.base / sr;
      if (this.state === "playing" && msg.waiting) this.setState("buffering");
      else if ((this.state === "buffering" || this.state === "loading") && !msg.waiting && msg.end > msg.frame) this.setState("playing");
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
        this.buffered = Math.max(this.buffered, msg.frame / this.ctx.sampleRate);
        this.emitTime();
        break;
      case "started":
        this.errors = 0;
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

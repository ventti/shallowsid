// SoundCloud-style scrubber: a peak overview on a canvas, with played /
// rendered / not-yet-rendered regions, that doubles as the seek control.
// Dragging calls onScrub(seconds) continuously and onSeek(seconds) on release.

const RMS_GAIN = 3;   // typical SID RMS is ~0.1-0.3 of full scale

export class Waveform {
  constructor(canvas, { onScrub, onSeek, canScrub = () => true }) {
    this.canvas = canvas;
    this.onScrub = onScrub;
    this.onSeek = onSeek;
    this.canScrub = canScrub;           // false: dragging only moves the marker, release seeks
    this.peaks = new Float32Array(0);
    this.bucketsPerSecond = 10;
    this.position = this.duration = this.buffered = this.bufferedFrom = 0;
    this.dragging = null;               // seconds under the finger while dragging
    this.frame = 0;
    new ResizeObserver(() => this.invalidate()).observe(canvas);
    this.attachPointer();
  }

  setPeaks(peaks, bucketsPerSecond) {
    this.peaks = peaks;
    this.bucketsPerSecond = bucketsPerSecond;
    this.invalidate();
  }

  setTime({ position, duration, buffered, bufferedFrom }) {
    Object.assign(this, { position, duration, buffered, bufferedFrom });
    this.invalidate();
  }

  secondsAt(clientX) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    return (x / rect.width) * this.duration;
  }

  attachPointer() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      if (!this.duration) return;
      c.setPointerCapture(e.pointerId);
      this.dragging = this.secondsAt(e.clientX);
      this.scrubbing = this.canScrub();
      if (this.scrubbing) this.onScrub(this.dragging);
      this.invalidate();
    });
    c.addEventListener("pointermove", (e) => {
      if (this.dragging === null) return;
      this.dragging = this.secondsAt(e.clientX);
      if (this.scrubbing) this.onScrub(this.dragging);
      this.invalidate();
    });
    const end = (e) => {
      if (this.dragging === null) return;
      const s = this.secondsAt(e.clientX);
      this.dragging = null;
      if (this.scrubbing) this.onScrub(null);
      this.scrubbing = false;
      this.onSeek(s);
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("keydown", (e) => {
      const step = { ArrowLeft: -5, ArrowRight: 5 }[e.key];
      if (step) {
        e.preventDefault();
        this.onSeek(this.position + step);
      }
    });
  }

  invalidate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext("2d");
    const style = getComputedStyle(c);
    const colors = {
      played: style.getPropertyValue("--wave-played").trim() || "#a99cff",
      rendered: style.getPropertyValue("--wave-rendered").trim() || "#888",
      pending: style.getPropertyValue("--wave-pending").trim() || "#444",
    };
    g.clearRect(0, 0, w, h);
    const barW = Math.max(2, Math.round(3 * dpr)), gap = Math.max(1, Math.round(dpr));
    const bars = Math.floor(w / (barW + gap));
    const shown = this.dragging ?? this.position;
    const mid = h / 2;
    for (let i = 0; i < bars; i++) {
      const t0 = (i / bars) * this.duration, t1 = ((i + 1) / bars) * this.duration;
      let peak = 0;
      const b0 = Math.floor(t0 * this.bucketsPerSecond), b1 = Math.max(b0 + 1, Math.ceil(t1 * this.bucketsPerSecond));
      for (let b = b0; b < b1 && b < this.peaks.length; b++) peak = Math.max(peak, this.peaks[b]);
      const rendered = t1 <= this.buffered && t0 >= this.bufferedFrom;
      const barH = rendered ? Math.max(2 * dpr, Math.min(1, peak * RMS_GAIN) * h) : 2 * dpr;
      g.fillStyle = t0 < shown ? colors.played : rendered ? colors.rendered : colors.pending;
      g.fillRect(i * (barW + gap), mid - barH / 2, barW, barH);
    }
  }
}

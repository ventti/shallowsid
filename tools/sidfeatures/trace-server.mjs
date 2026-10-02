// Long-running SID register tracer for features.py. Reads one request per stdin line:
//   {"path": "...", "song": 3, "seconds": 180}   (song is 1-based)
// runs the subtune on c64lite.mjs (no sound) with every SID write traced, and
// answers with one JSON line: the play speed, the timing when it isn't in step
// with the screen (cia: a CIA timer, at whatever rate it's set to; custom: no
// steady call rate, as with delay loops in the player or a timer it keeps
// changing), and how much of the time filter,
// ring modulation and sync are in use, or {"error": ...}. Status: ok, digi (only
// samples, so no play speed), check (no steady rate found), silent (no writes),
// basic (a BASIC program: c64lite has no BASIC ROM to run it, so nothing is measured).
import fs from "node:fs";
import readline from "node:readline";
import { parseSid, run } from "./c64lite.mjs";

const GAP = 1200;                  // a pause this long (cycles) between writes ends one play call
const DIGI_WRITES = 1000;          // more $D418 writes a second than this, or SID writes from NMIs, is sample playback
const MULTISPEED = 1.5;            // calls a frame from which a tune is multispeed (a 60 Hz tune on PAL is 1.2)
const MIN_CALLS = 10;              // fewer calls than this are too few to time
const MIN_WRITES = 50;             // a player that wrote less than this (besides $D418) hasn't played anything
const MAX_SPEED = 16;              // an interrupt more often than this a frame plays samples, not the tune
const TOLERANCE = 0.03;            // an interval within 3 % of a multiple of the period fits it,
const JITTER = 500;                // or within this many cycles: calls start their writes at varying points
const FIT = 0.9;                   // the shortest period that fits this share of what the best one does wins
const INTERRUPTS = new Set(["play", "raster", "ciaA", "ciaB", "nmi", "irq"]);
const STEADY = 0.9;                // a call rate is steady when this share of intervals is near the period,
const CALL_JITTER = 0.01;          // within 1 % or CALL_JITTER_CYCLES: interrupt latency moves calls a little
const CALL_JITTER_CYCLES = 64;
const MAX_GROUP = 8;               // uneven multispeed or a shuffle: up to this many calls make up one period
const MISSED = 0.1;                // play calls missed past this share of those made: play waits inside (delay loops)
// How each kind of interrupt times its calls when they're steady.
const TIMING = { raster: "raster", ciaA: "cia", ciaB: "cia", nmi: "cia" };
process.stdout.on("error", () => process.exit(0));

// Per voice, a control register value that makes the feature audible.
const WAVEFORM = 0xf0, SYNC = 0x02, RING = 0x04, TEST = 0x08, TRIANGLE = 0x10;
const syncOn = (ctrl) => (ctrl & SYNC) && (ctrl & WAVEFORM) && !(ctrl & TEST);
const ringOn = (ctrl) => (ctrl & RING) && (ctrl & TRIANGLE) && !(ctrl & TEST);   // ring modulates the triangle only
// Filter: some voice routed through it ($D417 bits 0-2) and some mode on ($D418 bits 4-6).
const filterOn = (regs) => (regs[0x17] & 0x07) && (regs[0x18] & 0x70);

/** For a tune whose main code writes the SID (no interrupt to count), the play
 *  period in cycles from the gaps between bursts of writes. A player that skips
 *  writing when nothing changed leaves gaps of several periods, so the period is
 *  the shortest one most gaps are multiples of. */
function period(starts, frame) {
  const gaps = [];
  for (let i = 1; i < starts.length; i++) {
    const g = starts[i] - starts[i - 1];
    if (g < 4 * frame) gaps.push(g);              // longer: a pause in the tune, not a call
  }
  if (gaps.length < MIN_CALLS) return null;
  const near = (a, b) => Math.abs(a - b) <= Math.max(TOLERANCE * b, JITTER);
  const fits = (p) => gaps.filter((g) => near(g, Math.max(1, Math.round(g / p)) * p)).length / gaps.length;
  // Candidates: the common gap lengths, grouped within the tolerance.
  const sorted = [...gaps].sort((a, b) => a - b), groups = [];
  for (const g of sorted) {
    const last = groups[groups.length - 1];
    if (last && near(g, last.lo)) { last.n++; last.sum += g; } else groups.push({ lo: g, n: 1, sum: g });
  }
  const candidates = groups.filter((c) => c.n >= gaps.length * 0.05).map((c) => ({ p: c.sum / c.n, fit: fits(c.sum / c.n) }));
  if (!candidates.length) return null;
  const best = Math.max(...candidates.map((c) => c.fit));
  const shortest = candidates.filter((c) => c.fit >= FIT * best).sort((a, b) => a.p - b.p)[0];
  return { cycles: shortest.p, fit: shortest.fit };
}

/** The call period, from when each call began: the median interval when most
 *  are near it; else the smallest group of k calls, within two frames, whose
 *  span is steady (two raster interrupts a frame at uneven lines, a timer
 *  alternating for a shuffle), divided by k; else, when the rate holds in long
 *  stretches and only changes now and then (a tune setting its tempo per part),
 *  the most common one, with changes: true. The median keeps a stray first call
 *  from skewing short tunes. null when nothing is steady. */
function steadyPeriod(times, frame) {
  if (times.length <= MIN_CALLS) return null;
  const near = (x, m) => Math.abs(x - m) <= Math.max(CALL_JITTER * m, CALL_JITTER_CYCLES);
  for (let k = 1; k <= MAX_GROUP && times.length > k + MIN_CALLS; k++) {
    const spans = [];
    for (let i = k; i < times.length; i++) spans.push(times[i] - times[i - k]);
    const m = [...spans].sort((a, b) => a - b)[spans.length >> 1];
    if (k > 1 && m > 2 * frame) break;   // calls that far apart aren't a multispeed pattern
    if (spans.filter((x) => near(x, m)).length / spans.length >= STEADY) return { cycles: m / k, group: k };
  }
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const held = gaps.slice(1).filter((g, i) => near(g, gaps[i])).length / (gaps.length - 1);
  if (held < STEADY) return null;
  // The rate most calls ran at: the biggest cluster of near-equal intervals.
  const sorted = [...gaps].sort((a, b) => a - b);
  let best = [], run = [];
  for (const g of sorted) {
    if (run.length && !near(g, run[0])) run = [];
    run.push(g);
    if (run.length > best.length) best = [...run];
  }
  return { cycles: best[best.length >> 1], group: 1, changes: true };
}

function analyse(tune, song, seconds) {
  if (tune.basic) return { status: "basic" };
  const V = tune.video, chips = tune.bases.length;
  const regs = Array.from({ length: chips }, () => new Uint8Array(32));
  const on = { filter: 0, ring: 0, sync: 0 };   // cycles each is in use, on any chip
  const bySource = {};                          // writes per source, $D418 left out (digis hammer it)
  const bursts = {}, burstEnd = {};             // per non-interrupt source: when each burst of writes began
  let writes = 0, digiWrites = 0, nmiWrites = 0, first = null, last = null, now = { filter: false, ring: false, sync: false };

  const state = () => {
    let f = false, r = false, s = false;
    for (const R of regs) {
      f ||= !!filterOn(R);
      for (const c of [R[0x04], R[0x0b], R[0x12]]) { r ||= !!ringOn(c); s ||= !!syncOn(c); }
    }
    return { filter: f, ring: r, sync: s };
  };
  const result = run(tune, song, seconds, (chip, reg, value, cycle, source) => {
    if (last !== null) for (const k in on) if (now[k]) on[k] += cycle - last;
    first ??= cycle; last = cycle; writes++;
    if (source.startsWith("nmi")) nmiWrites++;
    if (reg === 0x18) digiWrites++;
    else {
      bySource[source] = (bySource[source] ?? 0) + 1;
      if (!INTERRUPTS.has(source.split("@")[0])) {
        if (cycle - (burstEnd[source] ?? -Infinity) > GAP) (bursts[source] ??= []).push(cycle);
        burstEnd[source] = cycle;
      }
    }
    regs[chip][reg] = value;
    now = state();
  });

  const out = { clock: V.name, sids: chips, rsid: tune.rsid, writes };
  if (result.jam !== null) out.jam = result.jam.toString(16);
  if (!writes) return { ...out, status: "silent" };
  const span = Math.max(1, last - first);
  for (const k in on) out[k] = +(on[k] / span).toFixed(3);   // share of the time from the first write to the last
  out.digi = Math.max(digiWrites, nmiWrites) / (result.cycles / V.clock) > DIGI_WRITES;

  // The player is whatever wrote the most, leaving out interrupts too fast to be
  // one (sample playback); when it's an interrupt, its rate is the speed.
  const rate = (s) => (s.n - 1) * V.frame / Math.max(1, s.last - s.first);
  const player = Object.entries(bySource)
    .filter(([src]) => !(result.sources[src] && rate(result.sources[src]) > MAX_SPEED))
    .sort((a, b) => b[1] - a[1])[0];
  // None, or one that barely wrote: samples only, or a tune that never got going.
  if (!player || player[1] < MIN_WRITES) return { ...out, status: out.digi ? "digi" : "check" };
  out.driver = player[0].split("@")[0];
  let speed, status = "ok";
  if (INTERRUPTS.has(out.driver)) {
    const s = result.sources[player[0]];
    if (!s || s.n < MIN_CALLS) return { ...out, status: "check" };
    if (result.missed) out.missed = result.missed;
    const p = steadyPeriod(s.times, V.frame);
    const waits = out.driver === "play" && result.missed > MISSED * s.n;   // play holds on to the CPU between notes
    const timing = out.driver === "play" ? result.playBy : TIMING[out.driver];
    if (p && !waits && timing) {
      speed = V.frame / p.cycles;
      if (timing !== "raster") out.timing = timing;   // raster is the usual: speed says it all
      if (p.group > 1) out.group = p.group;
      if (p.changes) out.changes = true;   // the rate changes now and then; speed is the one it mostly runs at
    } else {
      speed = rate(s);   // calls come when the player's own waiting lets them: an average only
      out.timing = "custom";
    }
  } else {
    const p = period(bursts[player[0]] ?? [], V.frame);   // main code polling the raster, say, or counting cycles
    if (!p) return { ...out, status: "check" };
    speed = V.frame / p.cycles;
    // Steady at whole frames (or a whole fraction of one): it waits for the raster. Else it counts cycles.
    const frames = speed >= 1 ? speed : 1 / speed;
    if (p.fit < STEADY || Math.abs(frames - Math.round(frames)) > 0.015 * frames) out.timing = "custom";
    out.fit = +p.fit.toFixed(2);
    if (p.fit < 0.8) status = "check";
  }
  return { ...out, speed: +speed.toFixed(2), hz: +(speed * V.clock / V.frame).toFixed(1),
           multispeed: speed >= MULTISPEED, status };
}

for await (const line of readline.createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const { path, song, seconds } = JSON.parse(line);
  let answer;
  try {
    answer = analyse(parseSid(new Uint8Array(fs.readFileSync(path))), song, seconds);
  } catch (e) {
    answer = { error: String(e) };
  }
  process.stdout.write(JSON.stringify(answer) + "\n");
}

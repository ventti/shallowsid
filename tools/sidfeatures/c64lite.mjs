// A minimal C64 for tracing SID tunes fast: a 6502 (with the common illegal
// opcodes), RAM with the $01 banking, CIA timers, the VIC raster interrupt and a
// stub KERNAL. No SID sound and no graphics: SID writes go to a callback, with
// the cycle they happen on and the interrupt (or main code) that made them.
// Cycle counts are the base ones per opcode; page crossings aren't counted.

export const PAL = { name: "PAL", frame: 19656, line: 63, lines: 312, clock: 985248, timer: 0x4025 };
export const NTSC = { name: "NTSC", frame: 17095, line: 65, lines: 263, clock: 1022727, timer: 0x4295 };

/** The header and data of a PSID or RSID file. */
export function parseSid(buf) {
  const magic = String.fromCharCode(...buf.subarray(0, 4));
  if (magic !== "PSID" && magic !== "RSID") throw new Error("not a PSID/RSID file");
  const u16 = (o) => (buf[o] << 8) | buf[o + 1];
  const version = u16(4);
  const flags = version >= 2 ? u16(0x76) : 0;
  let load = u16(8), data = buf.subarray(u16(6));
  if (load === 0) { load = data[0] | (data[1] << 8); data = data.subarray(2); }
  const bases = [0xd400];   // further chips from the v3/v4 header: $xx means $Dxx0
  if (version >= 3 && buf[0x7a]) bases.push(0xd000 | (buf[0x7a] << 4));
  if (version >= 4 && buf[0x7b]) bases.push(0xd000 | (buf[0x7b] << 4));
  return {
    rsid: magic === "RSID", load, data, bases,
    init: u16(0xa) || load, play: u16(0xc), songs: u16(0xe),
    speed: (((buf[0x12] << 24) | (buf[0x13] << 16) | (buf[0x14] << 8) | buf[0x15]) >>> 0),
    basic: magic === "RSID" && !!(flags & 0x02),
    video: ((flags >> 2) & 3) === 2 ? NTSC : PAL,   // "both" and "unknown" play as PAL
  };
}

/** A stub KERNAL: the interrupt entry and exit paths, and RTS everywhere else,
 *  so a call to any KERNAL routine just returns. */
function kernal() {
  const k = new Uint8Array(0x2000).fill(0x60);
  const put = (addr, bytes) => k.set(bytes, addr - 0xe000);
  // IRQ/BRK entry: save A, X, Y, then JMP ($0316) for BRK or JMP ($0314).
  put(0xff48, [0x48, 0x8a, 0x48, 0x98, 0x48, 0xba, 0xbd, 0x04, 0x01, 0x29, 0x10, 0xf0, 0x03, 0x6c, 0x16, 0x03, 0x6c, 0x14, 0x03]);
  put(0xea31, [0xad, 0x0d, 0xdc, 0x4c, 0x81, 0xea]);   // default IRQ: ack CIA 1, then the exit
  put(0xea7b, [0xea, 0xea, 0xea, 0xad, 0x0d, 0xdc]);   // (keyboard scan), ack CIA 1, falls into $EA81
  put(0xea81, [0x68, 0xa8, 0x68, 0xaa, 0x68, 0x40]);   // restore Y, X, A; RTI
  put(0xfebc, [0x68, 0xa8, 0x68, 0xaa, 0x68, 0x40]);   // the NMI exit, the same
  put(0xfe43, [0x78, 0x6c, 0x18, 0x03]);               // NMI entry: SEI, JMP ($0318)
  put(0xfe47, [0x40]);                                 // default NMI: RTI
  put(0xfffa, [0x43, 0xfe, 0xe2, 0xfc, 0x48, 0xff]);   // NMI, reset, IRQ vectors
  return k;
}
const KERNAL = kernal();

function timer() { return { latch: 0xffff, counter: 0xffff, running: false, oneshot: false, at: Infinity }; }
function cia() { return { t: [timer(), timer()], flags: 0, mask: 0, cr: [0, 0], sdr: 0 }; }

/**
 * Play subtune `song` (1-based) of a parsed tune for `seconds` of C64 time.
 * onWrite(chip, register, value, cycle, source) sees every SID write; source is
 * "init", "play" (a PSID play call), "main", or an interrupt and its handler:
 * "raster@1003", "ciaA@...", "ciaB@...", "nmi@...", "irq@...". Returns how
 * often each source ran ({n, first, last, times} cycles; times holds when each
 * call began, the first MAX_TIMES of them), how the player called play ("raster",
 * "cia", or null for none), the play calls missed because the last one hadn't
 * finished, and the address of a jam opcode.
 */
const MAX_TIMES = 100000;   // per source: plenty to time a player; a sample interrupt can run millions of times

export function run(tune, song, seconds, onWrite) {
  const V = tune.video;
  const ram = new Uint8Array(0x10000), colour = new Uint8Array(0x400);
  const vic = { irr: 0, imr: 0, ctrl: 0x1b, compare: 0 };
  const cia1 = cia(), cia2 = cia();
  const psid = !tune.rsid && tune.play !== 0;           // the player calls play; otherwise the tune sets its own interrupts
  const cia1Speed = psid && !!(tune.speed & (1 << Math.min(song - 1, 31)));
  let cycle = 0, nextEvent = 0, rasterAt = Infinity, frameAt = Infinity;
  let irqLine = false, nmiLine = false, nmiPending = false, jam = null;
  let A = song - 1, X = 0, Y = 0, S = 0xff, PC = 0;
  let fC = 0, fZ = 0, fI = 1, fD = 0, fV = 0, fN = 0;
  let random = 0x1234;
  const context = [];                                   // the interrupts (and init/play) being run, innermost last
  const sources = {};                                   // source -> {n, first, last}: how often it ran
  const missed = { play: 0 };

  // --- memory --------------------------------------------------------------
  ram.set(tune.data.subarray(0, 0x10000 - tune.load), tune.load);
  ram[0] = 0x2f; ram[1] = 0x37;
  ram.set([0x31, 0xea, 0x81, 0xea, 0x47, 0xfe], 0x0314);   // IRQ, BRK, NMI vectors
  const port = () => ((ram[1] & ram[0]) | (~ram[0] & 0x07)) & 0x07;
  // PSID: bank out the ROM under the tune's own code.
  const bank = (addr) => addr < 0xa000 ? 0x37 : addr < 0xd000 ? 0x36 : addr < 0xe000 ? 0x34 : 0x35;

  function read(a) {
    if (a < 0xd000) return ram[a];
    const p = port();
    if (a < 0xe000) return (p & 3) && (p & 4) ? io(a) : ram[a];
    return p & 2 ? KERNAL[a - 0xe000] : ram[a];
  }
  function write(a, v) {
    if (a >= 0xd000 && a < 0xe000) {
      const p = port();
      if ((p & 3) && (p & 4)) { ioWrite(a, v); return; }
    }
    ram[a] = v;
  }

  // --- I/O -----------------------------------------------------------------
  const line = () => Math.floor((cycle % V.frame) / V.line);
  function sidChip(a) {
    for (let i = 1; i < tune.bases.length; i++) if ((a & 0xffe0) === tune.bases[i]) return i;
    return a >= 0xd400 && a < 0xd800 ? 0 : -1;
  }
  function io(a) {
    if (a < 0xd400) {
      switch (a & 0x3f) {
        case 0x11: return (vic.ctrl & 0x7f) | ((line() & 0x100) >> 1);
        case 0x12: return line() & 0xff;
        case 0x19: return vic.irr | (vic.irr & vic.imr ? 0x80 : 0) | 0x70;
        case 0x1a: return vic.imr | 0xf0;
        default: return 0;
      }
    }
    if (a < 0xd800) {
      const r = a & 0x1f;
      if (r === 0x1b || r === 0x1c) { random = (random * 1103515245 + 12345) >>> 0; return random >>> 24; }   // osc 3, env 3
      return r === 0x19 || r === 0x1a ? 0xff : 0;
    }
    if (a < 0xdc00) return colour[a & 0x3ff] | 0xf0;
    if (a < 0xde00) return ciaRead(a < 0xdd00 ? cia1 : cia2, a & 0x0f, a < 0xdd00);
    return 0;
  }
  function ioWrite(a, v) {
    const chip = sidChip(a);
    if (chip >= 0) { onWrite(chip, a & 0x1f, v, cycle, context.length ? context[context.length - 1] : "main"); return; }
    if (a < 0xd400) {
      switch (a & 0x3f) {
        case 0x11: vic.ctrl = v; vic.compare = (vic.compare & 0xff) | ((v & 0x80) << 1); schedRaster(); break;
        case 0x12: vic.compare = (vic.compare & 0x100) | v; schedRaster(); break;
        case 0x19: vic.irr &= ~v & 0x0f; updateIrq(); break;
        case 0x1a: vic.imr = v & 0x0f; updateIrq(); break;
      }
    } else if (a >= 0xd800 && a < 0xdc00) colour[a & 0x3ff] = v & 0x0f;
    else if (a >= 0xdc00 && a < 0xde00) ciaWrite(a < 0xdd00 ? cia1 : cia2, a & 0x0f, v);
  }

  const value = (t) => t.running ? Math.max(0, t.at - cycle - 1) : t.counter;
  const period = (t) => Math.max(t.latch, 8) + 1;      // a tiny latch would flood the emulator with interrupts
  function ciaRead(c, r, first) {
    switch (r) {
      case 0x00: case 0x01: return 0xff;               // no keys pressed, no joystick
      case 0x04: return value(c.t[0]) & 0xff;
      case 0x05: return value(c.t[0]) >> 8;
      case 0x06: return value(c.t[1]) & 0xff;
      case 0x07: return value(c.t[1]) >> 8;
      case 0x0c: return c.sdr;                         // players park an RTI here to point NMIs at
      case 0x0d: { const v = c.flags | (c.flags & c.mask ? 0x80 : 0); c.flags = 0; first ? updateIrq() : updateNmi(); return v; }
      case 0x0e: return c.cr[0];
      case 0x0f: return c.cr[1];
      default: return 0;
    }
  }
  function ciaWrite(c, r, v) {
    const i = r >= 0x06 && r <= 0x07 || r === 0x0f ? 1 : 0, t = c.t[i];
    switch (r) {
      case 0x04: case 0x06: t.latch = (t.latch & 0xff00) | v; break;
      case 0x05: case 0x07:
        t.latch = (t.latch & 0xff) | (v << 8);
        if (!t.running) t.counter = t.latch;
        break;
      case 0x0c: c.sdr = v; break;
      case 0x0d:
        c.mask = v & 0x80 ? c.mask | (v & 0x1f) : c.mask & ~v;
        c === cia1 ? updateIrq() : updateNmi();
        break;
      case 0x0e: case 0x0f: {
        c.cr[i] = v & ~0x10;
        if (t.running) t.counter = value(t);
        t.oneshot = !!(v & 0x08);
        if (v & 0x10) t.counter = t.latch;             // force load
        t.running = !!(v & 0x01);
        t.at = t.running ? cycle + t.counter + 1 : Infinity;
        schedule();
        break;
      }
    }
  }
  function startTimer(t, latch) {
    t.latch = t.counter = latch; t.running = true; t.at = cycle + latch + 1;
  }

  // --- interrupts and events -------------------------------------------------
  function updateIrq() { irqLine = ((vic.irr & vic.imr) | (cia1.flags & cia1.mask)) !== 0; }
  function updateNmi() {
    const l = (cia2.flags & cia2.mask) !== 0;
    if (l && !nmiLine) nmiPending = true;
    nmiLine = l;
  }
  function schedRaster() {
    if (vic.compare >= V.lines) { rasterAt = Infinity; schedule(); return; }
    rasterAt = cycle - (cycle % V.frame) + vic.compare * V.line;
    if (rasterAt <= cycle) rasterAt += V.frame;
    schedule();
  }
  function schedule() {
    nextEvent = Math.min(cia1.t[0].at, cia1.t[1].at, cia2.t[0].at, cia2.t[1].at, rasterAt, frameAt);
  }
  function underflow(c, i) {
    const t = c.t[i];
    c.flags |= 1 << i;
    if (t.oneshot) { t.running = false; t.counter = t.latch; t.at = Infinity; c.cr[i] &= ~1; }
    else t.at += period(t);
    if (c === cia1) { updateIrq(); if (i === 0 && cia1Speed) callPlay(); } else updateNmi();
  }
  function events() {
    while (nextEvent <= cycle) {
      if (cia1.t[0].at === nextEvent) underflow(cia1, 0);
      else if (cia1.t[1].at === nextEvent) underflow(cia1, 1);
      else if (cia2.t[0].at === nextEvent) underflow(cia2, 0);
      else if (cia2.t[1].at === nextEvent) underflow(cia2, 1);
      else if (rasterAt === nextEvent) { vic.irr |= 1; rasterAt += V.frame; updateIrq(); }
      else if (frameAt === nextEvent) { frameAt += V.frame; callPlay(); }
      schedule();
    }
  }
  function count(source) {
    const s = sources[source] ??= { n: 0, first: cycle, last: cycle, times: [] };
    s.n++; s.last = cycle;
    if (s.times.length < MAX_TIMES) s.times.push(cycle);
  }

  // --- CPU -------------------------------------------------------------------
  const push = (v) => { ram[0x100 | S] = v; S = (S - 1) & 0xff; };
  const pull = () => { S = (S + 1) & 0xff; return ram[0x100 | S]; };
  const flags = (b) => (fN << 7) | (fV << 6) | 0x20 | (b << 4) | (fD << 3) | (fI << 2) | (fZ << 1) | fC;
  const setFlags = (p) => { fN = p >> 7 & 1; fV = p >> 6 & 1; fD = p >> 3 & 1; fI = p >> 2 & 1; fZ = p >> 1 & 1; fC = p & 1; };
  const nz = (v) => { fZ = v === 0 ? 1 : 0; fN = v >> 7; };
  const fetch = () => { const v = read(PC); PC = (PC + 1) & 0xffff; return v; };
  const word = (a) => read(a) | (read((a + 1) & 0xffff) << 8);

  function interrupt(vector, source) {
    push(PC >> 8); push(PC & 0xff); push(flags(0));
    fI = 1; PC = word(vector); cycle += 7;
    // Key it by handler, so a raster split for the screen isn't taken for the player.
    const handler = PC === 0xff48 && (port() & 2) ? word(0x0314) : PC;
    const key = `${source}@${handler.toString(16).padStart(4, "0")}`;
    context.push(key); count(key);
  }
  function irqSource() {
    if (vic.irr & vic.imr & 1) return "raster";
    if (cia1.flags & cia1.mask & 1) return "ciaA";
    if (cia1.flags & cia1.mask & 2) return "ciaB";
    return "irq";
  }
  /** Call a routine as the PSID player does, from the idle loop (PC 0), with a
   *  return address that lands back there. */
  function call(addr, source) {
    ram[1] = bank(addr);
    push(0xff); push(0xff); PC = addr; fI = 1;
    context.push(source); count(source);
  }
  function callPlay() {
    if (PC === 0 && context.length === 0) call(tune.play, "play");
    else missed.play++;                                // the last call hasn't finished yet
  }

  // Addressing modes, each giving an effective address.
  const imm = () => { const a = PC; PC = (PC + 1) & 0xffff; return a; };
  const zp = () => fetch();
  const zpx = () => (fetch() + X) & 0xff;
  const zpy = () => (fetch() + Y) & 0xff;
  const abs = () => { const lo = fetch(); return lo | (fetch() << 8); };
  const abx = () => (abs() + X) & 0xffff;
  const aby = () => (abs() + Y) & 0xffff;
  const izx = () => { const z = (fetch() + X) & 0xff; return ram[z] | (ram[(z + 1) & 0xff] << 8); };
  const izy = () => { const z = fetch(); return ((ram[z] | (ram[(z + 1) & 0xff] << 8)) + Y) & 0xffff; };

  function adc(v) {
    if (fD) {
      let lo = (A & 0x0f) + (v & 0x0f) + fC, hi = (A & 0xf0) + (v & 0xf0);
      if (lo > 9) { lo += 6; hi += 0x10; }
      fZ = ((A + v + fC) & 0xff) === 0 ? 1 : 0;
      fN = (hi >> 7) & 1;
      fV = (~(A ^ v) & (A ^ hi) & 0x80) ? 1 : 0;
      if (hi > 0x90) hi += 0x60;
      fC = hi > 0xff ? 1 : 0;
      A = ((lo & 0x0f) | (hi & 0xf0)) & 0xff;
    } else {
      const r = A + v + fC;
      fV = (~(A ^ v) & (A ^ r) & 0x80) ? 1 : 0;
      fC = r > 0xff ? 1 : 0;
      A = r & 0xff; nz(A);
    }
  }
  function sbc(v) {
    const r = A - v - (1 - fC);
    fV = ((A ^ v) & (A ^ r) & 0x80) ? 1 : 0;
    if (fD) {
      let lo = (A & 0x0f) - (v & 0x0f) - (1 - fC), hi = (A & 0xf0) - (v & 0xf0);
      if (lo & 0x10) { lo -= 6; hi -= 0x10; }
      if (hi & 0x100) hi -= 0x60;
      A = ((lo & 0x0f) | (hi & 0xf0)) & 0xff;
    } else A = r & 0xff;
    fC = r >= 0 ? 1 : 0; nz(r & 0xff);
  }
  const cmp = (reg, v) => { const r = reg - v; fC = r >= 0 ? 1 : 0; nz(r & 0xff); };
  const asl = (v) => { fC = v >> 7; v = (v << 1) & 0xff; nz(v); return v; };
  const lsr = (v) => { fC = v & 1; v >>= 1; nz(v); return v; };
  const rol = (v) => { const c = fC; fC = v >> 7; v = ((v << 1) | c) & 0xff; nz(v); return v; };
  const ror = (v) => { const c = fC; fC = v & 1; v = (v >> 1) | (c << 7); nz(v); return v; };
  // Read-modify-write writes the old value back first: that's what makes INC $D019 ack the VIC.
  const rmw = (f) => (a) => { const old = read(a); if (a >= 0xd000 && a < 0xe000) write(a, old); const v = f(old); write(a, v); return v; };
  // The read of the byte after a one-byte opcode: run from $DD0C, an RTI reads
  // $DD0D with it, which acks the NMI (a sample player's trick).
  const dummy = () => { if (PC >= 0xdc00 && PC < 0xde00) read(PC); };
  const branch = (cond) => {
    const off = fetch();
    if (cond) { PC = (PC + ((off ^ 0x80) - 0x80)) & 0xffff; cycle++; }
  };

  // name: [operation on an address, or on nothing for implied modes]
  const ops = {
    LDA: (a) => nz(A = read(a)), LDX: (a) => nz(X = read(a)), LDY: (a) => nz(Y = read(a)),
    STA: (a) => write(a, A), STX: (a) => write(a, X), STY: (a) => write(a, Y),
    ADC: (a) => adc(read(a)), SBC: (a) => sbc(read(a)),
    AND: (a) => nz(A &= read(a)), ORA: (a) => nz(A |= read(a)), EOR: (a) => nz(A ^= read(a)),
    CMP: (a) => cmp(A, read(a)), CPX: (a) => cmp(X, read(a)), CPY: (a) => cmp(Y, read(a)),
    BIT: (a) => { const v = read(a); fZ = (A & v) === 0 ? 1 : 0; fN = v >> 7; fV = (v >> 6) & 1; },
    ASL: rmw(asl), LSR: rmw(lsr), ROL: rmw(rol), ROR: rmw(ror),
    INC: rmw((v) => { v = (v + 1) & 0xff; nz(v); return v; }),
    DEC: rmw((v) => { v = (v - 1) & 0xff; nz(v); return v; }),
    JMP: (a) => { PC = a; },
    NOP: () => {},
    // illegal opcodes that players do use
    LAX: (a) => nz(A = X = read(a)), SAX: (a) => write(a, A & X),
    DCP: (a) => cmp(A, rmw((v) => (v - 1) & 0xff)(a)),
    ISC: (a) => sbc(rmw((v) => (v + 1) & 0xff)(a)),
    SLO: (a) => nz(A |= rmw(asl)(a)), RLA: (a) => nz(A &= rmw(rol)(a)),
    SRE: (a) => nz(A ^= rmw(lsr)(a)), RRA: (a) => adc(rmw(ror)(a)),
    ANC: (a) => { nz(A &= read(a)); fC = fN; },
    ALR: (a) => { A = lsr(A & read(a)); },
    ARR: (a) => { A = ror(A & read(a)); fC = (A >> 6) & 1; fV = ((A >> 6) ^ (A >> 5)) & 1; },
    SBX: (a) => { const r = (A & X) - read(a); fC = r >= 0 ? 1 : 0; nz(X = r & 0xff); },
    XAA: (a) => nz(A = X & read(a)),
    LAS: (a) => nz(A = X = S = read(a) & S),
    SHA: (a) => write(a, A & X & ((a >> 8) + 1)), SHX: (a) => write(a, X & ((a >> 8) + 1)),
    SHY: (a) => write(a, Y & ((a >> 8) + 1)), TAS: (a) => { S = A & X; write(a, S & ((a >> 8) + 1)); },
  };
  const implied = {
    TAX: () => nz(X = A), TAY: () => nz(Y = A), TXA: () => nz(A = X), TYA: () => nz(A = Y),
    TSX: () => nz(X = S), TXS: () => { S = X; },
    INX: () => nz(X = (X + 1) & 0xff), INY: () => nz(Y = (Y + 1) & 0xff),
    DEX: () => nz(X = (X - 1) & 0xff), DEY: () => nz(Y = (Y - 1) & 0xff),
    CLC: () => { fC = 0; }, SEC: () => { fC = 1; }, CLI: () => { fI = 0; }, SEI: () => { fI = 1; },
    CLD: () => { fD = 0; }, SED: () => { fD = 1; }, CLV: () => { fV = 0; },
    PHA: () => push(A), PLA: () => nz(A = pull()), PHP: () => push(flags(1)), PLP: () => setFlags(pull()),
    ASLA: () => { A = asl(A); }, LSRA: () => { A = lsr(A); }, ROLA: () => { A = rol(A); }, RORA: () => { A = ror(A); },
    NOP: () => {},
    BPL: () => branch(!fN), BMI: () => branch(fN), BVC: () => branch(!fV), BVS: () => branch(fV),
    BCC: () => branch(!fC), BCS: () => branch(fC), BNE: () => branch(!fZ), BEQ: () => branch(fZ),
    JSR: () => { const a = abs(); const r = (PC - 1) & 0xffff; push(r >> 8); push(r & 0xff); PC = a; },
    RTS: () => {
      dummy();
      PC = ((pull() | (pull() << 8)) + 1) & 0xffff;
      const top = context[context.length - 1];
      if (PC === 0 && (top === "init" || top === "play")) context.pop();
    },
    RTI: () => { dummy(); setFlags(pull()); PC = pull() | (pull() << 8); context.pop(); },
    BRK: () => { PC = (PC + 1) & 0xffff; push(PC >> 8); push(PC & 0xff); push(flags(1)); fI = 1; PC = word(0xfffe); context.push("brk"); },
    JMPI: () => { const a = abs(); PC = read(a) | (read((a & 0xff00) | ((a + 1) & 0xff)) << 8); },
    KIL: () => { jam = (PC - 1) & 0xffff; },
  };

  // opcode table: "op mode cycles" per opcode, 0x00 to 0xff
  const TABLE = `
    BRK - 7|ORA izx 6|KIL - 2|SLO izx 8|NOP zp 3|ORA zp 3|ASL zp 5|SLO zp 5|PHP - 3|ORA imm 2|ASLA - 2|ANC imm 2|NOP abs 4|ORA abs 4|ASL abs 6|SLO abs 6|
    BPL - 2|ORA izy 5|KIL - 2|SLO izy 8|NOP zpx 4|ORA zpx 4|ASL zpx 6|SLO zpx 6|CLC - 2|ORA aby 4|NOP - 2|SLO aby 7|NOP abx 4|ORA abx 4|ASL abx 7|SLO abx 7|
    JSR - 6|AND izx 6|KIL - 2|RLA izx 8|BIT zp 3|AND zp 3|ROL zp 5|RLA zp 5|PLP - 4|AND imm 2|ROLA - 2|ANC imm 2|BIT abs 4|AND abs 4|ROL abs 6|RLA abs 6|
    BMI - 2|AND izy 5|KIL - 2|RLA izy 8|NOP zpx 4|AND zpx 4|ROL zpx 6|RLA zpx 6|SEC - 2|AND aby 4|NOP - 2|RLA aby 7|NOP abx 4|AND abx 4|ROL abx 7|RLA abx 7|
    RTI - 6|EOR izx 6|KIL - 2|SRE izx 8|NOP zp 3|EOR zp 3|LSR zp 5|SRE zp 5|PHA - 3|EOR imm 2|LSRA - 2|ALR imm 2|JMP abs 3|EOR abs 4|LSR abs 6|SRE abs 6|
    BVC - 2|EOR izy 5|KIL - 2|SRE izy 8|NOP zpx 4|EOR zpx 4|LSR zpx 6|SRE zpx 6|CLI - 2|EOR aby 4|NOP - 2|SRE aby 7|NOP abx 4|EOR abx 4|LSR abx 7|SRE abx 7|
    RTS - 6|ADC izx 6|KIL - 2|RRA izx 8|NOP zp 3|ADC zp 3|ROR zp 5|RRA zp 5|PLA - 4|ADC imm 2|RORA - 2|ARR imm 2|JMPI - 5|ADC abs 4|ROR abs 6|RRA abs 6|
    BVS - 2|ADC izy 5|KIL - 2|RRA izy 8|NOP zpx 4|ADC zpx 4|ROR zpx 6|RRA zpx 6|SEI - 2|ADC aby 4|NOP - 2|RRA aby 7|NOP abx 4|ADC abx 4|ROR abx 7|RRA abx 7|
    NOP imm 2|STA izx 6|NOP imm 2|SAX izx 6|STY zp 3|STA zp 3|STX zp 3|SAX zp 3|DEY - 2|NOP imm 2|TXA - 2|XAA imm 2|STY abs 4|STA abs 4|STX abs 4|SAX abs 4|
    BCC - 2|STA izy 6|KIL - 2|SHA izy 6|STY zpx 4|STA zpx 4|STX zpy 4|SAX zpy 4|TYA - 2|STA aby 5|TXS - 2|TAS aby 5|SHY abx 5|STA abx 5|SHX aby 5|SHA aby 5|
    LDY imm 2|LDA izx 6|LDX imm 2|LAX izx 6|LDY zp 3|LDA zp 3|LDX zp 3|LAX zp 3|TAY - 2|LDA imm 2|TAX - 2|LAX imm 2|LDY abs 4|LDA abs 4|LDX abs 4|LAX abs 4|
    BCS - 2|LDA izy 5|KIL - 2|LAX izy 5|LDY zpx 4|LDA zpx 4|LDX zpy 4|LAX zpy 4|CLV - 2|LDA aby 4|TSX - 2|LAS aby 4|LDY abx 4|LDA abx 4|LDX aby 4|LAX aby 4|
    CPY imm 2|CMP izx 6|NOP imm 2|DCP izx 8|CPY zp 3|CMP zp 3|DEC zp 5|DCP zp 5|INY - 2|CMP imm 2|DEX - 2|SBX imm 2|CPY abs 4|CMP abs 4|DEC abs 6|DCP abs 6|
    BNE - 2|CMP izy 5|KIL - 2|DCP izy 8|NOP zpx 4|CMP zpx 4|DEC zpx 6|DCP zpx 6|CLD - 2|CMP aby 4|NOP - 2|DCP aby 7|NOP abx 4|CMP abx 4|DEC abx 7|DCP abx 7|
    CPX imm 2|SBC izx 6|NOP imm 2|ISC izx 8|CPX zp 3|SBC zp 3|INC zp 5|ISC zp 5|INX - 2|SBC imm 2|NOP - 2|SBC imm 2|CPX abs 4|SBC abs 4|INC abs 6|ISC abs 6|
    BEQ - 2|SBC izy 5|KIL - 2|ISC izy 8|NOP zpx 4|SBC zpx 4|INC zpx 6|ISC zpx 6|SED - 2|SBC aby 4|NOP - 2|ISC aby 7|NOP abx 4|SBC abx 4|INC abx 7|ISC abx 7`;
  const modes = { imm, zp, zpx, zpy, abs, abx, aby, izx, izy };
  const OP = [], CYC = new Uint8Array(256);
  TABLE.trim().split("|").map((s) => s.trim()).filter(Boolean).forEach((entry, i) => {
    const [name, mode, cycles] = entry.split(" ");
    CYC[i] = +cycles;
    if (mode === "-") OP[i] = implied[name];
    else { const m = modes[mode], f = ops[name]; OP[i] = () => f(m()); }
  });

  // --- run -------------------------------------------------------------------
  if (!psid) {   // RSID, or a PSID that sets its own interrupts: CIA 1 timer A at 60 Hz, as after a reset
    startTimer(cia1.t[0], V.timer); cia1.cr[0] = 0x01; cia1.mask = 0x01;
  } else if (cia1Speed) {
    startTimer(cia1.t[0], V.timer); cia1.cr[0] = 0x01;   // init may set its own rate
  } else {
    frameAt = V.frame;
  }
  schedRaster();
  call(tune.init, "init");
  A = song - 1;

  const end = seconds * V.clock;
  while (cycle < end && jam === null) {
    if (nmiPending) { nmiPending = false; interrupt(0xfffa, "nmi"); }
    else if (irqLine && !fI) interrupt(0xfffe, irqSource());
    if (PC === 0) {             // idle: skip ahead to whatever happens next
      fI = 0;                   // after init the player runs with interrupts on
      if (irqLine || nmiPending) continue;
      cycle = Math.min(nextEvent, end);
      events();
      continue;
    }
    const op = read(PC);
    PC = (PC + 1) & 0xffff;
    cycle += CYC[op];
    OP[op]();
    if (cycle >= nextEvent) events();
  }
  return { cycles: cycle, sources, playBy: psid ? (cia1Speed ? "cia" : "raster") : null, missed: missed.play, jam };
}

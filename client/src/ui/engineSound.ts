// 🚗 Engine and exhaust sounds, made in the browser (no recordings).
//
// Each model's engine is built from how it really fires: one 720° cycle has a pressure pulse for
// each cylinder at its firing angle (an inline-4 fires evenly every 180°, a three-cylinder every
// 240°, the Dukati's 90° L-twin at 0° and 270°, the Harlee's 45° V-twin at 0° and 315°: the
// "potato-potato"). Every cylinder is a little different (real engines are), and a few cycles are
// recorded once, then looped and sped up with the revs, so the beat and the lumpiness follow
// the RPM.
//
// The exhaust then shapes it, like a real pipe would, at fixed frequencies that DON'T move with
// the revs: a resonating pipe (a comb filter: a short echo that feeds back, so the pipe "rings"),
// its main resonance, how bright it is (low-pass) and how hard it's driven (distortion). An
// inline-4 bike also gets its high-rev howl (the firing frequency itself, rich in harmonics).
// Gear changes cut the drive for a moment with a clunk (and a pop on a loud pipe), the rev
// limiter chops the sound, lifting off pops and crackles, and the turbo whistles and blows off.
import { engineModel, type EngineModel, type GarageConfig } from '@kh/shared';
import { audioCtx } from './sound';
import { loadPrefs } from './settings';

type Exhaust = GarageConfig['exhausts'][string];

const loops = new Map<string, { buf: AudioBuffer; baseRpm: number }>();
let noise: AudioBuffer | null = null;

function noiseBuf(ctx: BaseAudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

/** The engine's recorded cycles (made once per model), at a middle RPM. */
function engineLoop(ctx: BaseAudioContext, id: string, m: EngineModel) {
  const have = loops.get(id);
  if (have && have.buf.sampleRate === ctx.sampleRate) return have;
  const e = m.engine;
  const sr = ctx.sampleRate;
  const baseRpm = Math.sqrt(e.idleRpm * e.redline);
  const cycle = Math.round(sr * (120 / baseRpm)); // samples per 720°
  const CYCLES = 8;
  const buf = ctx.createBuffer(1, cycle * CYCLES, sr);
  const d = buf.getChannelData(0);
  const gap = cycle / e.cylinders; // average spacing between firings
  const tau = Math.min(gap * 0.32, sr * 0.01); // how long the thump rings
  const tA = sr * 0.0006; // the sharp front of the pressure pulse
  const tB = sr * 0.0022; // and the suck-back after it
  const body = e.body;
  let seed = id.length * 7919 + e.cc;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Each cylinder breathes a little differently (fixed per cylinder, like a real engine).
  const cyl = e.firing.map(() => 1 + (rnd() - 0.5) * (0.12 + e.rough * 0.4));
  for (let c = 0; c < CYCLES; c++) {
    e.firing.forEach((deg, ci) => {
      const jitter = (rnd() - 0.5) * e.rough * 0.05 * gap;
      const start = Math.round(c * cycle + (deg / 720) * cycle + jitter);
      const amp = cyl[ci] * (1 + (rnd() - 0.5) * e.rough * 0.5);
      const len = Math.min(Math.round(tau * 5), cycle);
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        const env = Math.exp(-k / tau);
        const v =
          amp *
          (0.9 * (Math.exp(-k / tA) - 0.55 * Math.exp(-k / tB)) + // the pressure pulse leaving the port
            0.55 * env * Math.sin(2 * Math.PI * body * t) + // the thump
            0.22 * env * Math.sin(2 * Math.PI * body * 2.07 * t + 0.6) + // a harmonic
            0.32 * Math.exp(-k / (tau * 0.22)) * (rnd() * 2 - 1)); // the bark (turbulence)
        d[(start + k) % d.length] += v;
      }
    });
  }
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < d.length; i++) d[i] = (d[i] / (peak || 1)) * 0.8;
  const out = { buf, baseRpm };
  loops.set(id, out);
  return out;
}

function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = 1 + drive * 18;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

export interface EngineOpts {
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Bouncing off the rev limiter. */
  limiter?: boolean;
}

/** One running engine. */
export class EngineVoice {
  private src: AudioBufferSourceNode;
  private shaper: WaveShaperNode;
  private lp: BiquadFilterNode;
  private peak: BiquadFilterNode;
  private cut: GainNode;
  private chop: GainNode;
  private chopDepth: GainNode;
  private chopLfo: OscillatorNode;
  private out: GainNode;
  private panner: StereoPannerNode | null = null;
  private howl: OscillatorNode | null = null;
  private howlGain: GainNode | null = null;
  private whine: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;
  private baseRpm: number;
  private lastThrottle = 0;
  private lastRpm = 0;
  private level = 1;
  private dead = false;

  constructor(
    private ctx: AudioContext,
    private dest: AudioNode,
    private model: EngineModel,
    id: string,
    private ex: Exhaust,
  ) {
    const loop = engineLoop(ctx, id, model);
    const e = model.engine;
    const bike = model.kind === 'bike';
    this.baseRpm = loop.baseRpm;
    this.src = ctx.createBufferSource();
    this.src.buffer = loop.buf;
    this.src.loop = true;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = driveCurve(ex.sound.drive);
    this.shaper.oversample = '2x';
    // The pipe: a short echo fed back through a damping filter rings at fixed frequencies.
    const ring = ex.sound.ring ?? 0.3;
    const pipeIn = ctx.createGain();
    pipeIn.gain.value = 1 - ring * 0.85; // keep the level about the same however much it rings
    const pipeSum = ctx.createGain();
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 1 / Math.max(60, Math.min(320, ex.sound.peak * (bike ? 1.25 : 1)));
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    const fb = ctx.createGain();
    fb.gain.value = ring;
    pipeIn.connect(pipeSum);
    pipeSum.connect(delay).connect(damp).connect(fb).connect(pipeSum);
    this.peak = ctx.createBiquadFilter();
    this.peak.type = 'peaking';
    this.peak.frequency.value = ex.sound.peak;
    this.peak.Q.value = 1.4;
    this.peak.gain.value = ex.sound.peakDb;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 30;
    // A gear change cuts the drive for a moment; the rev limiter chops it.
    this.cut = ctx.createGain();
    this.chop = ctx.createGain();
    this.chop.gain.value = 1;
    this.chopLfo = ctx.createOscillator();
    this.chopLfo.type = 'square';
    this.chopLfo.frequency.value = bike ? 22 : 15;
    this.chopDepth = ctx.createGain();
    this.chopDepth.gain.value = 0;
    this.chopLfo.connect(this.chopDepth).connect(this.chop.gain);
    this.chopLfo.start();
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    try {
      this.panner = ctx.createStereoPanner();
    } catch {
      this.panner = null;
    }
    this.src.connect(this.shaper).connect(pipeIn);
    pipeSum.connect(this.peak).connect(this.lp).connect(hp).connect(this.cut).connect(this.chop).connect(this.out);
    if (this.panner) this.out.connect(this.panner).connect(dest);
    else this.out.connect(dest);
    // An inline-4 (or triple) bike howls near the redline: the firing frequency, full of harmonics.
    if (bike && e.cylinders >= 3) {
      this.howl = ctx.createOscillator();
      this.howl.type = 'sawtooth';
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700;
      bp.Q.value = 0.7;
      this.howlGain = ctx.createGain();
      this.howlGain.gain.value = 0;
      this.howl.connect(bp).connect(this.howlGain).connect(this.cut);
      this.howl.start();
    }
    if (e.turbo) {
      this.whine = ctx.createOscillator();
      this.whine.type = 'sine';
      this.whineGain = ctx.createGain();
      this.whineGain.gain.value = 0;
      this.whine.connect(this.whineGain).connect(this.out);
      this.whine.start();
    }
    this.set(e.idleRpm, 0, 0);
    this.src.start();
  }

  /** Revs, throttle/load (0..1) and loudness (0..1, for distance). Smoothed. */
  set(rpm: number, throttle: number, level: number, opts: EngineOpts = {}) {
    if (this.dead) return;
    const now = this.ctx.currentTime;
    const e = this.model.engine;
    this.level = level;
    const share = Math.max(0, Math.min(1, (rpm - e.idleRpm) / (e.redline - e.idleRpm)));
    this.src.playbackRate.setTargetAtTime(rpm / this.baseRpm, now, 0.03);
    this.lp.frequency.setTargetAtTime(this.ex.sound.cutoff * (0.5 + 0.5 * throttle) * (0.75 + 0.9 * share), now, 0.06);
    const g = level * this.ex.sound.gain * (0.38 + 0.5 * throttle + 0.18 * share);
    this.out.gain.setTargetAtTime(g, now, 0.07);
    if (this.panner && opts.pan !== undefined) this.panner.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, opts.pan)), now, 0.08);
    this.chopDepth.gain.setTargetAtTime(opts.limiter ? 0.45 : 0, now, 0.01);
    this.chop.gain.setTargetAtTime(opts.limiter ? 0.55 : 1, now, 0.01);
    if (this.howl && this.howlGain) {
      const firing = (rpm / 60) * (e.cylinders / 2);
      this.howl.frequency.setTargetAtTime(firing, now, 0.03);
      this.howlGain.gain.setTargetAtTime(0.09 * share * share * (0.35 + 0.65 * throttle), now, 0.06);
    }
    if (this.whine && this.whineGain) {
      this.whine.frequency.setTargetAtTime(1400 + share * 4200, now, 0.08);
      this.whineGain.gain.setTargetAtTime(0.05 * throttle * share, now, 0.1);
    }
    // Lift off at speed: pops & crackles (louder exhausts pop more); the turbo blows off.
    if (this.lastThrottle > 0.6 && throttle < 0.3 && this.lastRpm > e.idleRpm + (e.redline - e.idleRpm) * 0.35) {
      const n = Math.round(this.ex.sound.pops * 7);
      for (let i = 0; i < n; i++) this.pop(now + 0.05 + Math.random() * 0.7, level);
      if (e.turbo) this.burst(now + 0.02, 0.35, 0.18 * level, 'highpass', 2500);
    }
    this.lastThrottle = throttle;
    this.lastRpm = rpm;
  }

  /** A gear change: the drive cuts out for a moment with a clunk (a loud pipe pops on an upshift). */
  shift(dir: 'up' | 'down') {
    if (this.dead || this.level <= 0) return;
    const now = this.ctx.currentTime;
    const bike = this.model.kind === 'bike';
    const dur = bike ? 0.08 : 0.2;
    this.cut.gain.cancelScheduledValues(now);
    this.cut.gain.setValueAtTime(1, now);
    this.cut.gain.linearRampToValueAtTime(dir === 'up' ? 0.25 : 0.55, now + 0.015);
    this.cut.gain.linearRampToValueAtTime(1, now + dur);
    // The clunk of the gearbox: a low knock and a little click.
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(bike ? 85 : 65, now);
    o.frequency.exponentialRampToValueAtTime(40, now + 0.08);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.22 * this.level, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    o.connect(g).connect(this.panner ?? this.dest);
    o.start(now);
    o.stop(now + 0.12);
    this.burst(now, 0.025, 0.1 * this.level, 'bandpass', 1900);
    if (dir === 'up' && this.ex.sound.pops > 0.2 && Math.random() < this.ex.sound.pops) this.pop(now + 0.02, this.level * 0.8);
  }

  private burst(t: number, dur: number, gain: number, type: BiquadFilterType, freq: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = noiseBuf(this.ctx);
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.panner ?? this.dest);
    s.start(t, Math.random() * 0.8);
    s.stop(t + dur + 0.02);
  }

  /** One exhaust pop: a sharp crack plus a low bang. */
  private pop(t: number, level: number) {
    const v = level;
    if (v <= 0) return;
    this.burst(t, 0.05 + Math.random() * 0.05, 0.5 * v * this.ex.sound.gain, 'bandpass', 900 + Math.random() * 1800);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(90 + Math.random() * 60, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.08);
    g.gain.setValueAtTime(0.35 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(this.panner ?? this.dest);
    o.start(t);
    o.stop(t + 0.12);
  }

  stop(fade = 0.25) {
    if (this.dead) return;
    this.dead = true;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + fade);
    window.setTimeout(() => {
      for (const n of [this.src, this.whine, this.howl, this.chopLfo]) {
        try {
          n?.stop();
        } catch {
          /* stopped */
        }
      }
      this.out.disconnect();
      this.panner?.disconnect();
    }, fade * 1000 + 80);
  }
}

function masterLevel(): number {
  const p = loadPrefs();
  return p.engineSound ? 0.32 * Math.max(0, Math.min(1, (p.volume ?? 70) / 100)) : 0;
}

let bus: GainNode | null = null;
function master(ctx: AudioContext): GainNode {
  if (!bus || bus.context !== ctx) {
    bus = ctx.createGain();
    // A limiter so a straight pipe (or three riders at once) never clips.
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -10;
    lim.knee.value = 6;
    lim.ratio.value = 8;
    lim.attack.value = 0.003;
    lim.release.value = 0.15;
    bus.connect(lim).connect(ctx.destination);
  }
  bus.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.1);
  return bus;
}
window.addEventListener('kh-prefs', () => {
  const ctx = audioCtx();
  if (ctx && bus) bus.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.1);
});

/** Starts an engine (null if sound isn't available or is off). */
export function startEngine(cfg: GarageConfig, id: string, exhaust: string): EngineVoice | null {
  const m = engineModel(cfg, id);
  const ex = cfg.exhausts[exhaust] ?? cfg.exhausts.stock;
  if (!m || !ex || !loadPrefs().engineSound) return null;
  const ctx = audioCtx();
  if (!ctx) return null;
  try {
    return new EngineVoice(ctx, master(ctx), m, id, ex);
  } catch {
    return null;
  }
}

/** How far away others hear this exhaust (px), and how loud at a distance (0..1). */
/** How loud another rider's engine is at this distance (1 = as loud as your own with that exhaust):
 *  full volume up close, fading out by the exhaust's range × `driving.hearingMult`. */
export function hearing(cfg: GarageConfig, exhaust: string, dist: number, tilePx = 32): number {
  const ex = cfg.exhausts[exhaust] ?? cfg.exhausts.stock;
  const dv = cfg.driving;
  const range = (ex?.sound.range ?? 380) * dv.hearingMult;
  const full = dv.fullVolumeTiles * tilePx;
  if (dist <= full) return 1;
  if (dist >= range) return 0;
  return Math.pow(1 - (dist - full) / (range - full), 1.3);
}

/** Showroom: idle, a blip, then a run up through three gears and a lift (with pops). */
export function revDemo(cfg: GarageConfig, id: string, exhaust: string): () => void {
  const v = startEngine(cfg, id, exhaust);
  const m = engineModel(cfg, id);
  if (!v || !m) return () => {};
  const e = m.engine;
  const at = (share: number) => e.idleRpm + (e.redline - e.idleRpm) * share;
  const timers: number[] = [];
  // [ms, rpm share, throttle, shift?]
  const keys: Array<[number, number, number, ('up' | null)?]> = [[0, 0, 0], [500, 0.45, 1], [900, 0.1, 0], [1500, 0, 0], [1700, 0.3, 1]];
  // Three gears: climb, shift (the revs drop), climb again.
  let t = 1800;
  for (let gear = 0; gear < 3; gear++) {
    for (let i = 1; i <= 8; i++) keys.push([t + i * 70, (gear === 0 ? 0.3 : 0.55) + (0.93 - (gear === 0 ? 0.3 : 0.55)) * (i / 8), 1]);
    t += 8 * 70;
    if (gear < 2) keys.push([t + 10, 0.55, 1, 'up']);
    t += 60;
  }
  keys.push([t + 150, 0.2, 0], [t + 900, 0, 0]);
  for (const [ms, share, thr, sh] of keys) {
    timers.push(window.setTimeout(() => {
      if (sh) v.shift(sh);
      v.set(at(share), thr, 1);
    }, ms));
  }
  const end = window.setTimeout(() => v.stop(0.4), t + 1500);
  return () => {
    timers.forEach(clearTimeout);
    clearTimeout(end);
    v.stop(0.15);
  };
}

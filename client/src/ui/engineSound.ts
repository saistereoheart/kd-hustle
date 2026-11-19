// 🚗 Engine and exhaust sounds, made in the browser (no recordings).
//
// Each model's engine is built from how it really fires: one 720° cycle has a pulse for each
// cylinder at its firing angle (an inline-4 fires evenly every 180°, a three-cylinder every
// 240°, the Dukati's 90° L-twin at 0° and 270°, the Harlee's 45° V-twin at 0° and 315°: the
// "potato-potato"). A few cycles are recorded once with a little roughness, then looped and sped
// up with the revs, so the pitch, the beat and the lumpiness all follow the RPM.
// The exhaust shapes the sound after that: how loud, how bright (low-pass), the pipe's resonance,
// how much it distorts, and pops & crackles when you lift off the throttle. The turbo S7O also
// whistles and goes "pssh" when you lift.
import type { GarageConfig, GarageModel } from '@kh/shared';
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
function engineLoop(ctx: BaseAudioContext, id: string, m: GarageModel) {
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
  const tau = Math.min(gap * 0.42, sr * 0.014); // how long a pulse rings
  const body = e.body;
  let seed = id.length * 7919;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let c = 0; c < CYCLES; c++) {
    for (const deg of e.firing) {
      const jitter = (rnd() - 0.5) * e.rough * 0.05 * gap;
      const start = Math.round(c * cycle + (deg / 720) * cycle + jitter);
      const amp = 1 + (rnd() - 0.5) * e.rough * 0.7;
      const len = Math.min(Math.round(tau * 5), cycle);
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        const env = Math.exp(-k / tau);
        const v =
          amp *
          (env * Math.sin(2 * Math.PI * body * t) + // the thump
            0.45 * env * Math.sin(2 * Math.PI * body * 2.07 * t + 0.6) + // a harmonic
            0.5 * Math.exp(-k / (tau * 0.25)) * (rnd() * 2 - 1)); // the bark of the pulse
        d[(start + k) % d.length] += v;
      }
    }
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

/** One running engine. */
export class EngineVoice {
  private src: AudioBufferSourceNode;
  private shaper: WaveShaperNode;
  private lp: BiquadFilterNode;
  private peak: BiquadFilterNode;
  private out: GainNode;
  private whine: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;
  private baseRpm: number;
  private lastThrottle = 0;
  private lastRpm = 0;
  private dead = false;

  constructor(
    private ctx: AudioContext,
    private dest: AudioNode,
    private model: GarageModel,
    id: string,
    private ex: Exhaust,
  ) {
    const loop = engineLoop(ctx, id, model);
    this.baseRpm = loop.baseRpm;
    this.src = ctx.createBufferSource();
    this.src.buffer = loop.buf;
    this.src.loop = true;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = driveCurve(ex.sound.drive);
    this.shaper.oversample = '2x';
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.9;
    this.peak = ctx.createBiquadFilter();
    this.peak.type = 'peaking';
    this.peak.frequency.value = ex.sound.peak;
    this.peak.Q.value = 1.4;
    this.peak.gain.value = ex.sound.peakDb;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 28;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.src.connect(this.shaper).connect(this.peak).connect(this.lp).connect(hp).connect(this.out).connect(dest);
    if (model.engine.turbo) {
      this.whine = ctx.createOscillator();
      this.whine.type = 'sine';
      this.whineGain = ctx.createGain();
      this.whineGain.gain.value = 0;
      this.whine.connect(this.whineGain).connect(this.out);
      this.whine.start();
    }
    this.set(model.engine.idleRpm, 0, 0);
    this.src.start();
  }

  /** Revs, throttle (0..1) and loudness (0..1, for distance). Smoothed. */
  set(rpm: number, throttle: number, level: number) {
    if (this.dead) return;
    const now = this.ctx.currentTime;
    const e = this.model.engine;
    const share = Math.max(0, Math.min(1, (rpm - e.idleRpm) / (e.redline - e.idleRpm)));
    this.src.playbackRate.setTargetAtTime(rpm / this.baseRpm, now, 0.05);
    this.lp.frequency.setTargetAtTime(this.ex.sound.cutoff * (0.55 + 0.45 * throttle) * (0.75 + 0.9 * share), now, 0.06);
    const g = level * this.ex.sound.gain * (0.42 + 0.5 * throttle + 0.15 * share);
    this.out.gain.setTargetAtTime(g, now, 0.07);
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
    s.connect(f).connect(g).connect(this.dest);
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
    o.connect(g).connect(this.dest);
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
      try {
        this.src.stop();
        this.whine?.stop();
      } catch {
        /* stopped */
      }
      this.out.disconnect();
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
  const m = cfg.models[id];
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

/** Showroom: idle, a blip, then a full rev to the redline and a lift (with pops). */
export function revDemo(cfg: GarageConfig, id: string, exhaust: string): () => void {
  const v = startEngine(cfg, id, exhaust);
  const m = cfg.models[id];
  if (!v || !m) return () => {};
  const e = m.engine;
  const at = (share: number) => e.idleRpm + (e.redline - e.idleRpm) * share;
  const steps: Array<[number, number, number]> = [
    // [ms from start, rpm share, throttle]
    [0, 0, 0], [700, 0.45, 1], [950, 0.1, 0], [1500, 0, 0], [1700, 0.4, 1], [2200, 0.75, 1], [2700, 0.98, 1], [2950, 0.2, 0], [3600, 0, 0],
  ];
  const timers = steps.map(([ms, share, thr]) => window.setTimeout(() => v.set(at(share), thr, 1), ms));
  const end = window.setTimeout(() => v.stop(0.4), 4300);
  return () => {
    timers.forEach(clearTimeout);
    clearTimeout(end);
    v.stop(0.15);
  };
}

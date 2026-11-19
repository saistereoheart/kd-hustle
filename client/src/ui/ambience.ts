// 🏙️ Background sounds, made in the browser like the rest (spec §16: "ambient city noise, casino
// ambience, cooking sizzles"). Quiet beds under everything else:
//  - town: a low traffic rumble, the odd car going by (left to right or back), birds by day and
//    crickets at night;
//  - casino: a murmuring crowd, slot jingles and chips clinking;
//  - indoor (shops, homes): almost silent, just a soft room tone;
//  - sizzle: a frying pan while you cook (on top of whichever bed is playing).
// Everything goes through one gain that follows the volume and the "Ambient sounds" setting.
import { audioCtx } from './sound';
import { loadPrefs } from './settings';

export type AmbienceKind = 'town' | 'casino' | 'indoor' | null;

let bus: GainNode | null = null;
let kind: AmbienceKind = null;
let bed: { nodes: AudioScheduledSourceNode[]; out: GainNode } | null = null;
let timer: number | null = null;
let darkFn: () => number = () => 0;
const buffers = new Map<string, AudioBuffer>();

function level(): number {
  const p = loadPrefs();
  return p.ambience ? 0.5 * Math.max(0, Math.min(1, (p.volume ?? 70) / 100)) : 0;
}

function master(ctx: AudioContext): GainNode {
  if (!bus || bus.context !== ctx) {
    bus = ctx.createGain();
    bus.connect(ctx.destination);
  }
  bus.gain.setTargetAtTime(level(), ctx.currentTime, 0.3);
  return bus;
}
window.addEventListener('kh-prefs', () => {
  const ctx = audioCtx();
  if (ctx && bus) bus.gain.setTargetAtTime(level(), ctx.currentTime, 0.3);
});

/** Looped noise: 'white', 'pink' or 'brown' (deeper = more rumble). */
function noise(ctx: BaseAudioContext, color: 'white' | 'pink' | 'brown'): AudioBuffer {
  const key = `${color}@${ctx.sampleRate}`;
  const have = buffers.get(key);
  if (have) return have;
  const n = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'white') d[i] = w * 0.5;
    else if (color === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
  }
  // Fade the ends together so the loop has no click.
  const f = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < f; i++) {
    const t = i / f;
    d[n - f + i] = d[n - f + i] * (1 - t) + d[i] * t;
  }
  buffers.set(key, buf);
  return buf;
}

function loopNoise(ctx: AudioContext, color: 'white' | 'pink' | 'brown', filter: BiquadFilterType, freq: number, q: number, gain: number, dest: AudioNode) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx, color);
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  s.connect(f).connect(g).connect(dest);
  s.start(0, Math.random() * 3);
  return { s, f, g };
}

function stopBed(fade = 1.2) {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  const ctx = audioCtx();
  const b = bed;
  bed = null;
  if (!b || !ctx) return;
  const now = ctx.currentTime;
  b.out.gain.cancelScheduledValues(now);
  b.out.gain.setValueAtTime(b.out.gain.value, now);
  b.out.gain.linearRampToValueAtTime(0, now + fade);
  window.setTimeout(() => {
    for (const n of b.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    b.out.disconnect();
  }, fade * 1000 + 100);
}

// ------------------------------------------------------------------ one-off sounds
function blip(ctx: AudioContext, dest: AudioNode, freq: number, t: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** A car going past: a swell of road noise that pans across. */
function carPass(ctx: AudioContext, dest: AudioNode) {
  const t = ctx.currentTime;
  const dur = 2.5 + Math.random() * 2;
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx, 'brown');
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.8;
  f.frequency.setValueAtTime(220, t);
  f.frequency.linearRampToValueAtTime(520 + Math.random() * 300, t + dur * 0.5);
  f.frequency.linearRampToValueAtTime(200, t + dur);
  const g = ctx.createGain();
  const peak = 0.18 + Math.random() * 0.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + dur * 0.5);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const pan = ctx.createStereoPanner();
  const dir = Math.random() < 0.5 ? -1 : 1;
  pan.pan.setValueAtTime(-0.8 * dir, t);
  pan.pan.linearRampToValueAtTime(0.8 * dir, t + dur);
  s.connect(f).connect(g).connect(pan).connect(dest);
  s.start(t, Math.random() * 2);
  s.stop(t + dur + 0.1);
}

/** A bird: two or three quick rising chirps. */
function bird(ctx: AudioContext, dest: AudioNode) {
  const t = ctx.currentTime;
  const base = 2600 + Math.random() * 1800;
  const n = 2 + Math.floor(Math.random() * 3);
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.6 - 0.8;
  pan.connect(dest);
  for (let i = 0; i < n; i++) blip(ctx, pan, base, t + i * 0.13, 0.08, 0.05, 'sine', base * 1.35);
}

/** Crickets: a buzzy pulse train. */
function crickets(ctx: AudioContext, dest: AudioNode, amount: number) {
  const t = ctx.currentTime;
  const f = 4200 + Math.random() * 600;
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.6 - 0.8;
  pan.connect(dest);
  const pulses = 6 + Math.floor(Math.random() * 8);
  for (let i = 0; i < pulses; i++) blip(ctx, pan, f, t + i * 0.055, 0.035, 0.022 * amount, 'triangle');
}

/** A far-off horn (two quick toots). */
function horn(ctx: AudioContext, dest: AudioNode) {
  const t = ctx.currentTime;
  const f = 330 + Math.random() * 80;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  lp.connect(dest);
  blip(ctx, lp, f, t, 0.16, 0.035, 'square');
  blip(ctx, lp, f, t + 0.22, 0.3, 0.035, 'square');
}

/** A slot machine somewhere: a little rising jingle. */
function slotJingle(ctx: AudioContext, dest: AudioNode) {
  const t = ctx.currentTime;
  const root = [523, 587, 659, 698][Math.floor(Math.random() * 4)];
  const steps = [0, 4, 7, 12, 7, 12, 16];
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.6 - 0.8;
  pan.connect(dest);
  const n = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) blip(ctx, pan, root * Math.pow(2, steps[i] / 12), t + i * 0.09, 0.12, 0.03, 'triangle');
}

/** Chips clicking together. */
function chips(ctx: AudioContext, dest: AudioNode) {
  const t = ctx.currentTime;
  const n = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) blip(ctx, dest, 2400 + Math.random() * 1600, t + i * (0.04 + Math.random() * 0.05), 0.03, 0.04, 'sine');
}

// ------------------------------------------------------------------ beds
function startTown(ctx: AudioContext, out: GainNode) {
  const a = loopNoise(ctx, 'brown', 'lowpass', 320, 0.7, 0.55, out); // traffic rumble
  const b = loopNoise(ctx, 'pink', 'bandpass', 900, 0.6, 0.05, out); // city air
  bed = { nodes: [a.s, b.s], out };
  timer = window.setInterval(() => {
    if (!bed) return;
    const dark = Math.max(0, Math.min(1, darkFn()));
    // Less traffic late at night.
    a.g.gain.setTargetAtTime(0.55 * (1 - 0.5 * dark), ctx.currentTime, 2);
    if (Math.random() < 0.16 * (1 - 0.6 * dark)) carPass(ctx, out);
    if (dark < 0.5 && Math.random() < 0.12) bird(ctx, out);
    if (dark > 0.4 && Math.random() < 0.3) crickets(ctx, out, dark);
    if (Math.random() < 0.015 * (1 - dark)) horn(ctx, out);
  }, 1000);
}

function startCasino(ctx: AudioContext, out: GainNode) {
  const crowd = loopNoise(ctx, 'pink', 'bandpass', 520, 0.9, 0.22, out);
  // The crowd swells and settles.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lg = ctx.createGain();
  lg.gain.value = 0.07;
  lfo.connect(lg).connect(crowd.g.gain);
  lfo.start();
  const hum = ctx.createOscillator(); // the machines' hum
  hum.frequency.value = 110;
  const hg = ctx.createGain();
  hg.gain.value = 0.012;
  hum.connect(hg).connect(out);
  hum.start();
  bed = { nodes: [crowd.s, lfo, hum], out };
  timer = window.setInterval(() => {
    if (!bed) return;
    if (Math.random() < 0.35) slotJingle(ctx, out);
    if (Math.random() < 0.3) chips(ctx, out);
  }, 700);
}

function startIndoor(ctx: AudioContext, out: GainNode) {
  const room = loopNoise(ctx, 'pink', 'lowpass', 260, 0.5, 0.12, out); // air con and room tone
  bed = { nodes: [room.s], out };
}

export const ambience = {
  /** Switches the background bed (crossfades). `dark` tells the town how dark it is (0..1). */
  set(next: AmbienceKind, dark?: () => number) {
    if (dark) darkFn = dark;
    if (next === kind && bed) return;
    stopBed();
    kind = next;
    if (!next) return;
    const ctx = audioCtx();
    if (!ctx) return;
    try {
      const out = ctx.createGain();
      out.gain.setValueAtTime(0, ctx.currentTime);
      out.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
      out.connect(master(ctx));
      if (next === 'town') startTown(ctx, out);
      else if (next === 'casino') startCasino(ctx, out);
      else startIndoor(ctx, out);
    } catch {
      bed = null;
    }
  },
  get kind() {
    return kind;
  },
};

/** A frying pan while you cook. Returns a stop function. */
export function sizzle(): () => void {
  const ctx = audioCtx();
  if (!ctx || !loadPrefs().ambience) return () => {};
  try {
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 0.6);
    out.connect(master(ctx));
    const hiss = loopNoise(ctx, 'white', 'highpass', 3200, 0.7, 0.09, out);
    // Crackles: little bursts of bright noise at random.
    const crackle = window.setInterval(() => {
      const n = Math.floor(Math.random() * 4);
      const t = ctx.currentTime;
      for (let i = 0; i < n; i++) {
        const s = ctx.createBufferSource();
        s.buffer = noise(ctx, 'white');
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 2500 + Math.random() * 4000;
        const g = ctx.createGain();
        const at = t + Math.random() * 0.25;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(0.12 + Math.random() * 0.15, at + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.02 + Math.random() * 0.03);
        s.connect(f).connect(g).connect(out);
        s.start(at, Math.random() * 3);
        s.stop(at + 0.08);
      }
    }, 250);
    return () => {
      window.clearInterval(crackle);
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0, now + 0.4);
      window.setTimeout(() => {
        try {
          hiss.s.stop();
        } catch {
          /* stopped */
        }
        out.disconnect();
      }, 500);
    };
  } catch {
    return () => {};
  }
}

// ⚔️ Battle music, made in your browser like the lofi: loops recorded once (off the main thread)
// and played from memory. "fight" is a quick minor-key 8-bit chip tune; "boss" is slower, lower and
// heavier; "labirin" is the calm, eerie walking music of Labirin Purba (slow minor pads, a far-off
// music box with echoes, a low drone). While one plays, the lofi and the shared radio hush
// (`musicDucked`), and they come back when it stops. Follows the 🎵 music on/off and volume settings.
import { audioCtx } from './sound';
import { loadPrefs } from './settings';

export type BattleTrack = 'fight' | 'boss' | 'labirin';

/** One beat of a track, in seconds (for things that move in time with it). */
export function beatSec(track: BattleTrack): number {
  return 60 / (track === 'labirin' ? CALM_BPM : STYLES[track].bpm);
}

let ducked = false;
/** True while battle music owns the speakers (the lofi and radio stay quiet). */
export const musicDucked = () => ducked;
function setDucked(on: boolean) {
  if (ducked === on) return;
  ducked = on;
  window.dispatchEvent(new Event('kh-prefs')); // lofi + radio re-check their state
}

const RATE = 22050;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Style {
  bpm: number;
  bars: number;
  /** One chord root per bar (MIDI), minor chords. */
  roots: number[];
  bassOct: number;
  leadType: OscillatorType;
  heavy: boolean;
}
const STYLES: Record<'fight' | 'boss', Style> = {
  fight: { bpm: 150, bars: 8, roots: [57, 53, 55, 52, 57, 53, 50, 52], bassOct: -24, leadType: 'square', heavy: false }, // Am F G E…
  boss: { bpm: 126, bars: 8, roots: [50, 51, 50, 56, 50, 51, 48, 49], bassOct: -24, leadType: 'sawtooth', heavy: true }, // D Eb D Ab… (tense)
};

async function record(track: 'fight' | 'boss'): Promise<AudioBuffer> {
  const st = STYLES[track];
  const step = 60 / st.bpm / 4;
  const len = Math.ceil(st.bars * 16 * step * RATE);
  const tail = Math.ceil(1 * RATE);
  const ctx = new OfflineAudioContext(1, len + tail, RATE);
  const master = ctx.createBiquadFilter();
  master.type = 'lowpass';
  master.frequency.value = st.heavy ? 3200 : 4200;
  master.connect(ctx.destination);
  const noise = ctx.createBuffer(1, RATE, RATE);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const voice = (f: number, t: number, dur: number, type: OscillatorType, gain: number, slide = 0) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.8, dur * 0.25 + 0.01);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.3);
  };
  const hit = (t: number, dur: number, gain: number, type: BiquadFilterType, freq: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(freq, RATE / 2 - 200);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  };
  const kick = (t: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(st.heavy ? 95 : 130, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    g.gain.setValueAtTime(st.heavy ? 0.5 : 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.25);
  };

  // A fixed riff per track (seeded so the recording is the same every time).
  let seed = track === 'boss' ? 7 : 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const minor = [0, 3, 7, 12, 15, 19];
  const riff = Array.from({ length: 16 }, () => minor[Math.floor(rnd() * minor.length)]);

  for (let s = 0; s < st.bars * 16; s++) {
    const t = s * step;
    const p = s % 16;
    const bar = Math.floor(s / 16);
    const root = st.roots[bar % st.roots.length];
    // Drums
    if (st.heavy ? p % 8 === 0 || p === 3 || p === 11 : p % 4 === 0) kick(t);
    if (p === 4 || p === 12) hit(t, 0.16, st.heavy ? 0.2 : 0.16, 'bandpass', 1800);
    if (p % 2 === 0 || !st.heavy) hit(t, 0.03, p % 4 === 2 ? 0.05 : 0.03, 'highpass', 8000);
    if (st.heavy && p === 0 && bar % 4 === 0) hit(t, 0.9, 0.12, 'highpass', 5000); // crash
    // Bass: driving 8ths (fight) / pounding root + octave (boss)
    if (p % 2 === 0) voice(hz(root + st.bassOct + (st.heavy ? (p % 4 === 2 ? 12 : 0) : p % 8 === 6 ? 7 : 0)), t, step * 1.8, st.heavy ? 'sawtooth' : 'triangle', st.heavy ? 0.13 : 0.16);
    // Arpeggio (16ths) on the chord
    const arp = [0, 3, 7, 12][p % 4];
    voice(hz(root + arp), t, step * 0.9, 'square', st.heavy ? 0.02 : 0.03);
    // Lead riff: the second half of each 4 bars
    if (bar % 4 >= 2 && (p % 2 === 0 || rnd() < 0.3)) voice(hz(root + 12 + riff[p]), t, step * 1.6, st.leadType, st.heavy ? 0.035 : 0.04);
    // Boss: a low drone stab each bar and a rising siren every 4
    if (st.heavy && p === 0) voice(hz(root - 12), t, step * 14, 'sawtooth', 0.05);
    if (st.heavy && p === 8 && bar % 4 === 3) voice(hz(root + 24), t, step * 8, 'triangle', 0.03, 1.5);
  }
  const out = await ctx.startRendering();
  const loop = ctx.createBuffer(1, len, RATE);
  const dst = loop.getChannelData(0);
  const src = out.getChannelData(0);
  dst.set(src.subarray(0, len));
  for (let i = 0; i < tail; i++) dst[i] += src[len + i];
  return loop;
}

// ------------------------------------------------------------------ 🗝️ the Labirin's calm music
const CALM_BPM = 66;
/** Slow and eerie: minor pads that swell in and out, a sub drone, and a music box far away whose
 *  notes echo off the walls. Harmonic minor (the raised 7th) gives it the unease. */
async function recordCalm(): Promise<AudioBuffer> {
  const bars = 8;
  const beat = 60 / CALM_BPM;
  const len = Math.ceil(bars * 4 * beat * RATE);
  const tail = Math.ceil(3 * RATE);
  const ctx = new OfflineAudioContext(1, len + tail, RATE);
  const master = ctx.createBiquadFilter();
  master.type = 'lowpass';
  master.frequency.value = 2400;
  master.connect(ctx.destination);
  // An echo for the music box (a cave).
  const echoIn = ctx.createGain();
  const delay = ctx.createDelay(2);
  delay.delayTime.value = beat * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.42;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 1600;
  echoIn.connect(master);
  echoIn.connect(delay).connect(damp).connect(fb).connect(delay);
  damp.connect(master);
  const tone = (f: number, t: number, dur: number, type: OscillatorType, gain: number, attack: number, dest: AudioNode = master, detune = 0) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0.0001, t + Math.max(attack, dur - attack), dur * 0.3 + 0.05);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 2);
  };
  const roots = [57, 53, 50, 52, 57, 53, 55, 52]; // Am F Dm E(major: eerie) Am F G E
  const scale = [0, 2, 3, 5, 7, 8, 11, 12, 14, 15]; // A harmonic minor
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let bar = 0; bar < bars; bar++) {
    const t = bar * 4 * beat;
    const root = roots[bar];
    const third = bar % 4 === 3 ? 4 : 3;
    // Pads: a soft swell over the whole bar, two slightly detuned voices per note.
    for (const iv of [0, third, 7]) {
      tone(hz(root - 12 + iv), t, 4 * beat, 'triangle', 0.035, 1.4, master, -6);
      tone(hz(root - 12 + iv), t, 4 * beat, 'sine', 0.04, 1.6, master, 7);
    }
    tone(hz(root - 24), t, 4 * beat, 'sine', 0.09, 0.8); // the drone underneath
    // The music box: a few notes per bar, some silences, a high bell harmonic on each.
    for (let st = 0; st < 8; st++) {
      if (rnd() > (st % 2 ? 0.18 : 0.42)) continue;
      const n = root + 12 + scale[Math.floor(rnd() * scale.length)];
      const nt = t + st * beat * 0.5;
      tone(hz(n), nt, 1.2, 'sine', 0.05, 0.005, echoIn);
      tone(hz(n + 24), nt, 0.4, 'sine', 0.012, 0.003, echoIn);
    }
  }
  const out = await ctx.startRendering();
  const loop = ctx.createBuffer(1, len, RATE);
  const dst = loop.getChannelData(0);
  const src = out.getChannelData(0);
  dst.set(src.subarray(0, len));
  for (let i = 0; i < tail; i++) dst[i] += src[len + i];
  return loop;
}

class BattleMusic {
  private buffers = new Map<BattleTrack, Promise<AudioBuffer | null>>();
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private current: BattleTrack | null = null;
  private wanted: BattleTrack | null = null;

  constructor() {
    window.addEventListener('kh-prefs', () => this.applyPrefs());
  }

  private buffer(t: BattleTrack) {
    let b = this.buffers.get(t);
    if (!b) {
      b = (t === 'labirin' ? recordCalm() : record(t)).catch(() => null);
      this.buffers.set(t, b);
    }
    return b;
  }

  /** Get the loops ready early (the battle window calls this when it opens). */
  warm(...tracks: BattleTrack[]) {
    for (const t of tracks.length ? tracks : (['fight', 'boss'] as BattleTrack[])) void this.buffer(t);
  }

  private level(track: BattleTrack | null = this.current) {
    return (track === 'labirin' ? 0.38 : 0.5) * Math.max(0, Math.min(1, loadPrefs().musicVolume / 100));
  }

  /** Start a track right now, at full volume from its first beat (no fade-in), cutting the old one
   *  quickly: for a battle that starts on the downbeat. Resolves when it's playing (true) or not. */
  async playNow(track: BattleTrack): Promise<boolean> {
    this.wanted = track;
    setDucked(true);
    const buf = await Promise.race([this.buffer(track), new Promise<null>((r) => window.setTimeout(() => r(null), 1500))]);
    const ctx = audioCtx();
    if (!buf || !ctx || this.wanted !== track) return false;
    this.fadeOut(0.12);
    this.current = track;
    const g = ctx.createGain();
    g.gain.setValueAtTime(loadPrefs().musicOn ? this.level(track) : 0, ctx.currentTime);
    g.connect(ctx.destination);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(g);
    s.start();
    this.src = s;
    this.gain = g;
    return true;
  }

  /** Play this track (crossfading from the other), or null to stop and give the speakers back. */
  play(track: BattleTrack | null) {
    this.wanted = track;
    setDucked(track !== null);
    void this.sync();
  }

  private applyPrefs() {
    if (this.gain && this.src) {
      const ctx = audioCtx();
      if (ctx) this.gain.gain.setTargetAtTime(loadPrefs().musicOn ? this.level() : 0, ctx.currentTime, 0.2);
    }
  }

  private async sync() {
    const want = this.wanted;
    if (want === this.current) return;
    this.fadeOut();
    this.current = want;
    if (!want) return;
    const buf = await this.buffer(want);
    const ctx = audioCtx();
    if (!buf || !ctx || this.current !== want || this.src) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(loadPrefs().musicOn ? this.level(want) : 0, ctx.currentTime + (want === 'labirin' ? 2.5 : 0.6));
    g.connect(ctx.destination);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(g);
    s.start();
    this.src = s;
    this.gain = g;
  }

  private fadeOut(sec = 0.5) {
    const ctx = audioCtx();
    const s = this.src, g = this.gain;
    this.src = null;
    this.gain = null;
    if (!s || !g || !ctx) return;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + sec);
    window.setTimeout(() => {
      try {
        s.stop();
      } catch {
        /* stopped */
      }
      g.disconnect();
    }, sec * 1000 + 100);
  }
}

export const battleMusic = new BattleMusic();

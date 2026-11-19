// ⚔️ Battle music, made in your browser like the lofi: two loops recorded once (off the main
// thread) and played from memory. "fight" is a quick minor-key chip tune; "boss" is slower,
// lower and heavier. While one plays, the lofi and the shared radio hush (`musicDucked`), and
// they come back when the fight window closes. Follows the 🎵 music on/off and volume settings.
import { audioCtx } from './sound';
import { loadPrefs } from './settings';

export type BattleTrack = 'fight' | 'boss';

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
const STYLES: Record<BattleTrack, Style> = {
  fight: { bpm: 150, bars: 8, roots: [57, 53, 55, 52, 57, 53, 50, 52], bassOct: -24, leadType: 'square', heavy: false }, // Am F G E…
  boss: { bpm: 126, bars: 8, roots: [50, 51, 50, 56, 50, 51, 48, 49], bassOct: -24, leadType: 'sawtooth', heavy: true }, // D Eb D Ab… (tense)
};

async function record(track: BattleTrack): Promise<AudioBuffer> {
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
      b = record(t).catch(() => null);
      this.buffers.set(t, b);
    }
    return b;
  }

  /** Get the loops ready early (the battle window calls this when it opens). */
  warm() {
    void this.buffer('fight');
    void this.buffer('boss');
  }

  private level() {
    return 0.5 * Math.max(0, Math.min(1, loadPrefs().musicVolume / 100));
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
    g.gain.linearRampToValueAtTime(loadPrefs().musicOn ? this.level() : 0, ctx.currentTime + 0.6);
    g.connect(ctx.destination);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(g);
    s.start();
    this.src = s;
    this.gain = g;
  }

  private fadeOut() {
    const ctx = audioCtx();
    const s = this.src, g = this.gain;
    this.src = null;
    this.gain = null;
    if (!s || !g || !ctx) return;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    window.setTimeout(() => {
      try {
        s.stop();
      } catch {
        /* stopped */
      }
      g.disconnect();
    }, 600);
  }
}

export const battleMusic = new BattleMusic();

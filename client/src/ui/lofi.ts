// Chill lofi chiptune, made with WebAudio in your own browser (no music files, no streaming, so
// no licences to worry about). Soft square/triangle chip voices through a warm low-pass filter,
// slow swung drums, a walking bass, a lazy pentatonic melody and vinyl crackle. It plays when
// the shared radio has nothing on (no music files in server/music/), fades in once the town has
// loaded, and follows the 🎵 music on/off and volume settings.
//
// It is RECORDED once (two ~107 s pieces, made faster than real time off the main thread) and
// then played back from memory. The old note-by-note scheduler gapped whenever the game was busy;
// a recording plays on the audio thread and can't.
import { audioCtx } from './sound';
import { loadPrefs } from './settings';
import { musicDucked } from './battleMusic';

const BPM = 72;
const STEP = 60 / BPM / 4; // a 16th note (s)
const SWING = 0.12; // late off-beat 8ths (share of a 16th... of an 8th)

// Chord progressions (MIDI notes, root in the bass); each is 4 bars, one chord per bar.
const PROGRESSIONS: number[][][] = [
  [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]], // Fmaj7 Em7 Dm7 Cmaj7
  [[50, 53, 57, 60, 64], [43, 47, 50, 53, 57], [48, 52, 55, 59], [45, 48, 52, 55]], // Dm9 G9 Cmaj7 Am7
  [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]], // Am7 Fmaj7 Cmaj7 G7
  [[51, 55, 58, 62], [50, 53, 57, 60], [48, 51, 55, 58], [46, 50, 53, 57]], // Ebmaj7 Dm7 Cm7 Bbmaj7
];
// C major pentatonic, two octaves (melody pool).
const PENTA = [72, 74, 76, 79, 81, 84, 86, 88];

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Bars in one recorded piece (~107 s at 72 BPM); two pieces alternate. */
const BARS = 32;
const SAMPLE_RATE = 22050;

/** Records one piece into an AudioBuffer that loops seamlessly. */
async function renderPiece(firstProg: number): Promise<AudioBuffer> {
  const len = Math.ceil(BARS * 16 * STEP * SAMPLE_RATE);
  const tail = Math.ceil(2 * SAMPLE_RATE); // notes ringing past the end wrap round to the start
  const ctx = new OfflineAudioContext(1, len + tail, SAMPLE_RATE);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;
  filter.Q.value = 0.6;
  filter.connect(ctx.destination);
  const noise = ctx.createBuffer(1, SAMPLE_RATE * 2, SAMPLE_RATE);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const v = new Voices(ctx, filter, noise);
  v.prog = PROGRESSIONS[firstProg % PROGRESSIONS.length];
  for (let step = 0; step < BARS * 16; step++) v.playStep(step, step * STEP);
  const out = await ctx.startRendering();
  // Seamless loop: fold the tail back onto the start, then lay vinyl hiss and pops over it all.
  const loop = ctx.createBuffer(1, len, SAMPLE_RATE);
  const src = out.getChannelData(0);
  const dst = loop.getChannelData(0);
  dst.set(src.subarray(0, len));
  for (let i = 0; i < tail; i++) dst[i] += src[len + i];
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const w = (Math.random() * 2 - 1) * 0.05 + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 0.9 : 0);
    hp = 0.85 * (hp + w - prev); // a simple high-pass, like the old crackle filter
    prev = w;
    dst[i] += hp * 0.05;
  }
  return loop;
}

/** The instruments, scheduled into an audio context (the offline one above). */
class Voices {
  prog = PROGRESSIONS[0];
  private melodyIdx = 3;
  constructor(private ctx: BaseAudioContext, private dest: AudioNode, private noise: AudioBuffer) {}

  playStep(step: number, t0: number) {
    const s16 = step % 16; // position in the bar
    const bar = Math.floor(step / 16);
    if (s16 === 0 && bar % 8 === 0 && bar > 0) this.prog = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
    const chord = this.prog[bar % 4];
    // Swing: off-beat 8ths come late.
    const t = s16 % 4 === 2 ? t0 + STEP * SWING * 2 : t0;
    // Drums: kick on 1 and the "and" of 3, snare on 2 and 4, soft hats on 8ths.
    if (s16 === 0 || s16 === 10 || (s16 === 7 && Math.random() < 0.3)) this.kick(t);
    if (s16 === 4 || s16 === 12) this.snare(t);
    if (s16 % 2 === 0) this.hat(t, s16 % 4 === 0 ? 0.05 : 0.03);
    // Chords: a long soft pad on the bar, with a stab on the "and" of 2.
    if (s16 === 0) for (const n of chord.slice(1)) this.voice(hz(n), t, STEP * 15, 'triangle', 0.045, 0.12);
    if (s16 === 6 && Math.random() < 0.6) for (const n of chord.slice(1)) this.voice(hz(n + 12), t, STEP * 1.5, 'square', 0.012, 0.01);
    // Bass: root on 1, fifth or octave on 3.
    if (s16 === 0) this.voice(hz(chord[0] - 12), t, STEP * 6, 'triangle', 0.16, 0.02);
    if (s16 === 8) this.voice(hz(chord[0] - 12 + (Math.random() < 0.5 ? 7 : 12)), t, STEP * 5, 'triangle', 0.12, 0.02);
    // Melody: a lazy random walk on the pentatonic, more notes on the beat, rests often.
    if (s16 % 2 === 0 && bar % 8 >= 2 && Math.random() < (s16 % 4 === 0 ? 0.42 : 0.22)) {
      this.melodyIdx = Math.max(0, Math.min(PENTA.length - 1, this.melodyIdx + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
      this.voice(hz(PENTA[this.melodyIdx]), t, STEP * (Math.random() < 0.3 ? 4 : 2), 'square', 0.022, 0.01, true);
    }
  }

  /** One chip voice with a soft envelope (and a little tape wobble on the melody). */
  private voice(freq: number, t: number, dur: number, type: OscillatorType, gain: number, attack: number, wobble = false) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (wobble) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5;
      lg.gain.value = freq * 0.004;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.3);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.12);
    o.connect(g).connect(this.dest);
    o.start(t);
    o.stop(t + dur + 0.8);
  }

  private kick(t: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.dest);
    o.start(t);
    o.stop(t + 0.32);
  }

  private noiseHit(t: number, dur: number, gain: number, type: BiquadFilterType, freq: number) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(freq, ctx.sampleRate / 2 - 200);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  private snare(t: number) {
    this.noiseHit(t, 0.18, 0.12, 'bandpass', 1700);
    this.voice(190, t, 0.05, 'triangle', 0.05, 0.002);
  }

  private hat(t: number, gain: number) {
    this.noiseHit(t, 0.035, gain, 'highpass', 7000);
  }
}

class Lofi {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  /** Recorded pieces (made once per page, then reused). */
  private pieces: AudioBuffer[] = [];
  private rendering: Promise<void> | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private queuedUntil = 0;
  private next = 0;
  private timer = 0;
  private playing = false;
  /** Whether something else (the radio) wants the speakers. */
  private yielded = false;
  private stopTimer = 0;

  /** Fade in (if music is on and the radio isn't playing). */
  start(fadeSec = 4) {
    const prefs = loadPrefs();
    if (!prefs.musicOn || this.yielded || musicDucked()) return;
    const ctx = audioCtx();
    if (!ctx) return;
    clearTimeout(this.stopTimer);
    if (!this.playing) this.build(ctx);
    const g = this.out!.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this.level(), now + fadeSec);
  }

  /** Fade out and stop. */
  stop(fadeSec = 1.5) {
    if (!this.playing || !this.ctx || !this.out) return;
    const now = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fadeSec);
    clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => this.teardown(), fadeSec * 1000 + 100);
  }

  /** The radio has a track (true) or not (false). */
  yieldTo(radioPlaying: boolean) {
    if (radioPlaying === this.yielded) return;
    this.yielded = radioPlaying;
    if (radioPlaying) this.stop(1.5);
    else if (this.wanted) this.start(3);
  }

  /** Was it started (after the intro)? Then settings changes turn it on and off. */
  private wanted = false;
  begin() {
    if (!this.wanted) window.addEventListener('kh-prefs', () => this.applyPrefs()); // once per page
    this.wanted = true;
    this.start(4);
  }

  private applyPrefs() {
    if (!this.wanted) return;
    const p = loadPrefs();
    if (!p.musicOn || this.yielded || musicDucked()) return this.stop(0.6);
    if (!this.playing) return this.start(1.5);
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.2);
  }

  private level() {
    return 0.55 * Math.max(0, Math.min(1, loadPrefs().musicVolume / 100));
  }

  private build(ctx: AudioContext) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(ctx.destination);
    this.playing = true;
    this.queuedUntil = 0;
    // Record the pieces (once per page); the first starts playing as soon as it's ready.
    this.rendering ??= (async () => {
      try {
        this.pieces.push(await renderPiece(Math.floor(Math.random() * PROGRESSIONS.length)));
        this.queue();
        this.pieces.push(await renderPiece(Math.floor(Math.random() * PROGRESSIONS.length) + 1));
      } catch {
        /* no OfflineAudioContext in this browser: no lofi */
      }
    })();
    void this.rendering.then(() => this.queue());
    this.queue();
    this.timer = window.setInterval(() => this.queue(), 5000);
  }

  /** Keep 20 s or more lined up on the audio clock (back to back, sample-exact: no gaps). */
  private queue() {
    const ctx = this.ctx;
    if (!ctx || !this.out || !this.playing || !this.pieces.length) return;
    if (this.queuedUntil < ctx.currentTime) this.queuedUntil = ctx.currentTime + 0.1;
    while (this.queuedUntil < ctx.currentTime + 20) {
      const buf = this.pieces[this.next++ % this.pieces.length];
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.out);
      src.start(this.queuedUntil);
      src.onended = () => (this.sources = this.sources.filter((x) => x !== src));
      this.sources.push(src);
      this.queuedUntil += buf.duration;
    }
  }

  private teardown() {
    clearInterval(this.timer);
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.out?.disconnect();
    this.playing = false;
    this.ctx = null;
    this.out = null;
  }
}

export const lofi = new Lofi();

// Tiny WebAudio synth for game feel (no audio files). Respects the volume setting.
import { loadPrefs } from './settings';

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, when = 0, slideTo?: number) {
  const a = ac();
  if (!a) return;
  const vol = (loadPrefs().volume ?? 70) / 100;
  if (vol <= 0) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain * vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  tick: () => tone(1800, 0.03, 'square', 0.05),
  coin: () => {
    if (!loadPrefs().moneySound) return;
    tone(988, 0.08, 'square', 0.08);
    tone(1319, 0.18, 'square', 0.08, 0.07);
  },
  click: () => tone(600, 0.05, 'triangle', 0.08),
  error: () => tone(220, 0.18, 'sawtooth', 0.06, 0, 150),
  whoosh: () => tone(300, 0.4, 'sawtooth', 0.04, 0, 1200),
  /** Reveal stinger, grander for rarer tiers. */
  reveal: (tierIndex: number) => {
    const base = [523, 587, 659, 784, 880, 988, 1047, 1175][Math.min(7, tierIndex)];
    if (tierIndex <= 1) return tone(base, 0.15, 'triangle', 0.1);
    const notes = tierIndex >= 5 ? [0, 4, 7, 12, 16] : tierIndex >= 4 ? [0, 4, 7, 12] : [0, 4, 7];
    notes.forEach((n, i) => tone(base * Math.pow(2, n / 12), 0.35 + i * 0.05, tierIndex >= 4 ? 'square' : 'triangle', 0.09, i * 0.09));
    if (tierIndex >= 5) tone(80, 1.2, 'sawtooth', 0.08, 0, 40);
  },
  /** Level up: a quick rising arpeggio. */
  levelUp: () => [0, 4, 7, 12].forEach((n, i) => tone(659 * Math.pow(2, n / 12), 0.22, 'square', 0.08, i * 0.08)),
  /** New wealth stage: a bigger fanfare. */
  fanfare: () => {
    [0, 4, 7, 12, 7, 12, 16].forEach((n, i) => tone(523 * Math.pow(2, n / 12), 0.3, 'square', 0.08, i * 0.11));
    tone(130, 1, 'triangle', 0.1, 0, 65);
  },
  /** A soft chime (goal done, quest ready). */
  chime: () => {
    tone(1319, 0.12, 'triangle', 0.08);
    tone(1760, 0.25, 'triangle', 0.07, 0.09);
  },
  /** A shop door: a little two-note bell. */
  door: () => {
    tone(1568, 0.12, 'triangle', 0.06);
    tone(1175, 0.2, 'triangle', 0.05, 0.1);
  },
  /** A locked door: two dull knocks and a rattle. */
  locked: () => {
    tone(140, 0.07, 'square', 0.1);
    tone(130, 0.07, 'square', 0.1, 0.11);
    tone(95, 0.14, 'sawtooth', 0.05, 0.2, 80);
  },
  /** Coins from a sale made by your staff (softer than your own). */
  staffCoin: () => {
    if (!loadPrefs().moneySound) return;
    tone(1175, 0.06, 'triangle', 0.05);
    tone(1568, 0.12, 'triangle', 0.05, 0.05);
  },
  /** Potion gulp. */
  gulp: () => {
    tone(420, 0.1, 'sine', 0.12, 0, 260);
    tone(380, 0.12, 'sine', 0.1, 0.12, 220);
  },
};

/** The shared AudioContext (resumed if the browser suspended it). */
export const audioCtx = ac;

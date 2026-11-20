// ⚙️ Keeps the frame rate up on weak devices (no dedicated GPU): watches the real frame rate and,
// with Graphics on "Auto", lowers the render resolution step by step while it's below the target
// (and raises it again when there's plenty of headroom). On the lowest step it also switches to
// "lite" effects (fewer night lights, no smoke puffs). The level it settles on is remembered per
// device, so the next visit starts there instead of re-learning it.
import { loadPrefs } from '../ui/settings';

const KEY = 'kh_render_scale';
/** Below this many frames a second (averaged over a window) we step down... */
const LOW_FPS = 40;
/** ...and above this for a while we try one step up. */
const HIGH_FPS = 56;
const STEPS = [1, 0.85, 0.72, 0.62, 0.55];
const WINDOW_MS = 2000;
/** Good windows in a row needed before stepping back up (slow to go up, quick to go down). */
const UP_AFTER = 8;
/** After a change, ignore a moment (the map redraws at the new size and stutters once). */
const SETTLE_MS = 3000;

function readStep(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isInteger(v) && v >= 0 && v < STEPS.length ? v : 0;
  } catch {
    return 0;
  }
}
function saveStep(i: number) {
  try {
    localStorage.setItem(KEY, String(i));
  } catch {
    /* private mode: just don't remember */
  }
}

export class FrameGovernor {
  private step = readStep();
  private frames = 0;
  private elapsed = 0;
  private worst = 0;
  private good = 0;
  private settleUntil = 0;
  private listeners: Array<() => void> = [];
  /** The last window's frame rate (for Settings / debugging). */
  fps = 60;

  /** Multiplies the device pixel ratio the game renders at (1 = full sharpness). */
  get scale(): number {
    return loadPrefs().quality === 'auto' ? STEPS[this.step] : 1;
  }
  /** For Settings: "41 FPS · resolution 72%". */
  describe(): string {
    return `${Math.round(this.fps)} FPS · resolution ${Math.round(this.scale * 100)}%`;
  }
  /** On the lowest step: cheaper effects too. */
  get lite(): boolean {
    const q = loadPrefs().quality;
    return q === 'saver' || (q === 'auto' && this.step >= STEPS.length - 1);
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  /** Call once a frame with its length (ms). */
  tick(deltaMs: number) {
    const now = performance.now();
    if (now < this.settleUntil || document.hidden) return;
    this.frames++;
    this.elapsed += deltaMs;
    this.worst = Math.max(this.worst, deltaMs);
    if (this.elapsed < WINDOW_MS) return;
    const fps = (this.frames * 1000) / this.elapsed;
    // A window with a long freeze (a panel opening, the tab in the background) says nothing.
    const freeze = this.worst > 600;
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
    if (freeze) return;
    this.fps = fps;
    if (loadPrefs().quality !== 'auto') return;
    if (fps < LOW_FPS && this.step < STEPS.length - 1) {
      this.good = 0;
      // Far too slow: two steps at once, so a weak device settles in seconds.
      this.set(Math.min(STEPS.length - 1, this.step + (fps < LOW_FPS * 0.6 ? 2 : 1)));
    } else if (fps > HIGH_FPS && this.step > 0) {
      if (++this.good >= UP_AFTER) {
        this.good = 0;
        this.set(this.step - 1);
      }
    } else this.good = 0;
  }

  /** Back to full sharpness (Settings → Graphics changed). */
  reset() {
    this.good = 0;
    this.set(0);
  }

  private set(i: number) {
    if (i === this.step) return;
    this.step = i;
    saveStep(i);
    this.settleUntil = performance.now() + SETTLE_MS;
    for (const fn of this.listeners) fn();
  }
}

export const governor = new FrameGovernor();

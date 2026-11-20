// 🚶 Simple walk-in customers: an NPC walks a few points (stopping to say something on the way if
// asked) and disappears at the end (into a shop's door, or out of one). Purely for show: the
// customers that matter are the server's (kopitiam orders) or just numbers (Ventures).
import type Phaser from 'phaser';
import { randomAppearance, type CharacterConfig, type ItemDef } from '@kh/shared';
import { Avatar } from './avatar';

interface Step {
  x: number;
  y: number;
  /** Say this when you get here, and wait a moment. */
  say?: string;
  waitMs?: number;
  /** Turn this way on arriving. */
  face?: 'up' | 'down' | 'left' | 'right';
  /** On arriving (e.g. sit down and eat): returns how long to stay. */
  arrive?: (av: Avatar) => number | void;
  /** When setting off again from here. */
  leave?: (av: Avatar) => void;
}
interface Walker {
  av: Avatar;
  steps: Step[];
  waitUntil: number;
  done: (() => void) | null;
  fading: boolean;
  /** Called when it sets off from where it's waiting. */
  onLeave: ((av: Avatar) => void) | null;
}

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Walkers {
  private list: Walker[] = [];
  private last = 0;

  constructor(
    private scene: Phaser.Scene,
    private character: CharacterConfig,
    private items: Map<string, ItemDef>,
    /** At most this many at once (slow devices). */
    private max = 10,
    /** Walking speed (px/s). */
    private speed = 70,
  ) {}

  get count() {
    return this.list.length;
  }

  /** Someone walks from `from` through `steps` and vanishes at the last one. */
  walk(from: { x: number; y: number }, steps: Step[], seed = Math.floor(Math.random() * 1e9), done?: () => void): boolean {
    if (this.list.length >= this.max || !steps.length) return false;
    const av = new Avatar(this.scene, this.character, this.items, {
      name: '', level: 1, appearance: randomAppearance(this.character, seeded(seed)), x: from.x, y: from.y, isSelf: false, npc: true, particles: false,
    });
    av.container.setAlpha(0);
    this.scene.tweens.add({ targets: av.container, alpha: 1, duration: 300 });
    this.list.push({ av, steps: [...steps], waitUntil: 0, done: done ?? null, fading: false, onLeave: null });
    return true;
  }

  /** Move everyone along (call every frame). */
  update(now: number) {
    const dt = Math.min(0.1, Math.max(0, (now - (this.last || now)) / 1000));
    this.last = now;
    for (const w of [...this.list]) {
      w.av.tick(now);
      if (w.fading) continue;
      if (now < w.waitUntil) {
        w.av.setState(w.av.dir, false);
        continue;
      }
      if (w.onLeave) {
        const f = w.onLeave;
        w.onLeave = null;
        f(w.av);
      }
      const s = w.steps[0];
      if (!s) {
        this.vanish(w);
        continue;
      }
      const dx = s.x - w.av.x, dy = s.y - w.av.y;
      const d = Math.hypot(dx, dy);
      const stepLen = this.speed * dt;
      if (d <= stepLen) {
        w.av.setPosition(s.x, s.y);
        w.steps.shift();
        if (s.face) w.av.setState(s.face, false);
        let wait = 0;
        if (s.say) {
          w.av.say(s.say, s.waitMs ?? 1800);
          wait = s.waitMs ?? 1800;
        } else if (s.waitMs) wait = s.waitMs;
        const stay = s.arrive?.(w.av);
        if (typeof stay === 'number') wait = Math.max(wait, stay);
        if (wait > 0) w.waitUntil = now + wait;
        w.onLeave = s.leave ?? null;
        continue;
      }
      w.av.setPosition(w.av.x + (dx / d) * stepLen, w.av.y + (dy / d) * stepLen);
      w.av.setState(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up', true);
    }
  }

  private vanish(w: Walker) {
    w.fading = true;
    w.av.setState(w.av.dir, false);
    this.scene.tweens.add({
      targets: w.av.container,
      alpha: 0,
      duration: 260,
      onComplete: () => {
        w.av.destroy();
        this.list = this.list.filter((x) => x !== w);
        w.done?.();
      },
    });
  }

  destroy() {
    for (const w of this.list) {
      w.onLeave?.(w.av);
      w.av.destroy();
      w.done?.();
    }
    this.list = [];
  }
}

/** Things customers say at the counter. */
export const COUNTER_LINES = {
  kopitiam: ['Teh tarik satu!', 'Roti canai kosong, bang', 'Kopi O ais satu', 'Nasi lemak bungkus', 'Kira, bang!', 'Sedap macam biasa 👍'],
  shop: ['Berapa ni?', 'Ada stok lagi?', 'Terima kasih!', 'Nak satu, boss', 'Boleh kurang sikit?', 'Mantap kedai ni 👍'],
};

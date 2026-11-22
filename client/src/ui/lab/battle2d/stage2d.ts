// ⚔️ Labirin Purba: the pixel-art fight stage (the default). Built from the dungeon's own tileset:
// a cobbled floor that runs off into the dark (fake 3D: each line drawn narrower towards the
// horizon), rock walls and lit lamps at the back, your party up close (seen from behind, drawn by the
// game's own character painter), the monsters across the floor (their 3D models, rendered once into
// small pixel pictures). Every move is played big, as in 3D: wind-up, lunge, squash and stretch,
// hit-stop, knockback, screen shake, slash arcs, pixel sparks, shockwaves, a charge aura and zoom
// punch on skills, big numbers.
//
// Cheap: one 2D canvas drawn at a low resolution and scaled up with hard pixel edges (that IS the
// pixel-art look); the backdrop is painted once; a frame is one backdrop copy, a few sprites and the
// effects. No 3D engine.
import type { Appearance, CharacterConfig, LabEvent } from '@kh/shared';
import { drawCharacter, FRAME_H, FRAME_W, type Pose } from '../../../character/draw';
import { LAB_FRAMES, LAB_SHEET_URL, type LabFrame } from '../../../world/labSheet';
import type { StageFighter } from '../battle3d/stage';
import { loadMonsterPics, monsterPic } from '../portraits';

export interface Stage2DFighter extends StageFighter {
  appearance?: Appearance;
}

export interface Stage2DOpts {
  host: HTMLElement;
  boss: boolean;
  character: CharacterConfig;
  onAim: (id: string) => void;
}

interface Actor {
  f: Stage2DFighter;
  home: { x: number; y: number };
  off: { x: number; y: number };
  scale: number;
  lean: number;
  squash: number;
  down: number;
  gone: number;
  flashT: number;
  pose: 'idle' | 'act' | 'hurt';
  busy: number;
  hover: boolean;
  /** Pictures (and white copies for the hit flash), per pose. */
  pics: Partial<Record<'idle' | 'act' | 'hurt', { img: HTMLCanvasElement; white: HTMLCanvasElement }>>;
  /** Picture height on screen (internal px). */
  h: number;
}

interface Tween {
  t: number;
  dur: number;
  step: (k: number) => void;
  done?: () => void;
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  g: number;
}

interface Fx {
  kind: 'slash' | 'ring' | 'ball' | 'shield';
  x: number;
  y: number;
  r: number;
  ang: number;
  t: number;
  dur: number;
  color: string;
}

const ease = {
  out: (k: number) => 1 - Math.pow(1 - k, 3),
  in: (k: number) => k * k * k,
  back: (k: number) => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2),
};

/** Monsters that float (bats, flames, books, ghosts). */
const HOVER_KINDS = new Set(['kelawar', 'api_liar', 'buku_hidup', 'hantu_pustaka']);
const HOVER_ICONS = new Set(['🦇', '🔥', '📚', '👻']);

let sheetImg: HTMLImageElement | null = null;
function sheet(): Promise<HTMLImageElement | null> {
  if (sheetImg?.complete) return Promise.resolve(sheetImg);
  return new Promise((res) => {
    const im = sheetImg ?? new Image();
    sheetImg = im;
    im.onload = () => res(im);
    im.onerror = () => res(null);
    if (!im.src) im.src = LAB_SHEET_URL;
  });
}

/** The picture cut to what's actually drawn (so its feet sit on its shadow, not floating above). */
function trimmed(im: HTMLImageElement): HTMLCanvasElement {
  const a = document.createElement('canvas');
  a.width = im.width;
  a.height = im.height;
  const ax = a.getContext('2d')!;
  ax.drawImage(im, 0, 0);
  const d = ax.getImageData(0, 0, a.width, a.height).data;
  let x0 = a.width, y0 = a.height, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++)
      if (d[(y * a.width + x) * 4 + 3] > 20) (x0 = Math.min(x0, x), y0 = Math.min(y0, y), x1 = Math.max(x1, x), y1 = Math.max(y1, y));
  if (x1 < 0) return a;
  const c = document.createElement('canvas');
  c.width = x1 - x0 + 1;
  c.height = y1 - y0 + 1;
  c.getContext('2d')!.drawImage(a, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

function whiteCopy(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const x = c.getContext('2d')!;
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

export class Battle2D {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement | null = null;
  private overlay: HTMLElement;
  private W = 320;
  private H = 180;
  private PX = 3;
  private actors = new Map<string, Actor>();
  private tweens: Tween[] = [];
  private timers: Array<{ at: number; fn: () => void }> = [];
  private bits: Bit[] = [];
  private fx: Fx[] = [];
  private time = 0;
  private stop = 0;
  private shakeAmp = 0;
  private punch = 0;
  private flash = 0;
  private last = performance.now();
  private raf = 0;
  private dead = false;
  private aimId: string | null = null;
  private lamps: Array<{ x: number; y: number; r: number }> = [];
  private ro: ResizeObserver;
  private sheet: HTMLImageElement | null = null;

  constructor(private o: Stage2DOpts) {
    this.cv = document.createElement('canvas');
    this.cv.className = 'b2-canvas';
    this.ctx = this.cv.getContext('2d')!;
    this.overlay = document.createElement('div');
    this.overlay.className = 'b3-overlay';
    o.host.append(this.cv, this.overlay);
    this.cv.addEventListener('pointerdown', this.onTap);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(o.host);
    this.resize();
    void sheet().then((im) => {
      this.sheet = im;
      this.paintBackdrop();
    });
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ the backdrop (painted once)
  private resize() {
    const r = this.o.host.getBoundingClientRect();
    // One art pixel = this many screen pixels (bigger screens: chunkier pixels, same art).
    this.PX = Math.max(2, Math.min(4, Math.round(r.width / 430)));
    this.W = Math.max(120, Math.ceil(r.width / this.PX));
    this.H = Math.max(90, Math.ceil(r.height / this.PX));
    this.cv.width = this.W;
    this.cv.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
    this.paintBackdrop();
    // Re-place everyone for the new size.
    for (const a of this.actors.values()) this.place(a);
  }

  private frame_(f: LabFrame) {
    return LAB_FRAMES[f];
  }

  private paintBackdrop() {
    const { W, H } = this;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d')!;
    x.imageSmoothingEnabled = false;
    const horizon = Math.round(H * 0.4);
    x.fillStyle = this.o.boss ? '#160a10' : '#0c0a12';
    x.fillRect(0, 0, W, H);
    const im = this.sheet;
    // The floor: a strip of cobbles, each line drawn narrower towards the horizon (perspective).
    if (im) {
      const [fx, fy, fw, fh] = this.frame_('floor_dark_a');
      const tile = Math.max(24, Math.round(H * 0.32));
      const strip = document.createElement('canvas');
      strip.width = W * 3;
      strip.height = tile * 4;
      const sx = strip.getContext('2d')!;
      sx.imageSmoothingEnabled = false;
      for (let yy = 0; yy < strip.height; yy += tile) for (let xx = 0; xx < strip.width; xx += tile) {
        const f = (xx / tile + yy / tile) % 5 === 0 ? this.frame_('floor_moss') : [fx, fy, fw, fh];
        sx.drawImage(im, f[0], f[1], f[2], f[3], xx, yy, tile, tile);
      }
      for (let y = horizon; y < H; y++) {
        const t = (y - horizon) / (H - horizon); // 0 far → 1 near
        const k = 0.35 + 0.65 * t; // width scale
        const srcY = Math.floor(Math.pow(t, 0.7) * (strip.height - 1));
        const sw = (W / k);
        x.drawImage(strip, (strip.width - sw) / 2, srcY, sw, 1, 0, y, W, 1);
      }
      // Darker far away.
      const g = x.createLinearGradient(0, horizon, 0, H);
      g.addColorStop(0, 'rgba(8,6,14,0.85)');
      g.addColorStop(0.5, 'rgba(8,6,14,0.25)');
      g.addColorStop(1, 'rgba(8,6,14,0.05)');
      x.fillStyle = g;
      x.fillRect(0, horizon, W, H - horizon);
      // The back wall: rock pieces in two rows, lamps and a banner, an arch in the middle.
      const rock = (f: LabFrame, cx: number, by: number, w: number, flip = false) => {
        const [rx, ry, rw, rh] = this.frame_(f);
        const h = (w / rw) * rh * 0.9;
        x.save();
        x.translate(cx, by);
        if (flip) x.scale(-1, 1);
        x.drawImage(im, rx, ry, rw, rh, -w / 2, -h, w, h);
        x.restore();
      };
      const rw = Math.round(H * 0.2);
      for (let cx = -rw / 2, k = 0; cx < W + rw; cx += rw * 0.8, k++) rock((['rock_cluster_a', 'rock_cluster_c', 'rock_wide', 'rock_cluster_d'] as const)[k % 4], cx, horizon - H * 0.07, rw * 1.25, k % 2 === 0);
      for (let cx = 0, k = 0; cx < W + rw; cx += rw * 0.7, k++) rock((['rock_cluster_b', 'rock_small', 'rock_cluster_c'] as const)[k % 3], cx + rw * 0.35, horizon + 2, rw, k % 2 === 1);
      rock('arch_door_blue', W * 0.5, horizon + 1, rw * 1.6);
      rock('banner', W * 0.37, horizon - H * 0.05, rw * 0.55);
      rock('lamp_post', W * 0.18, horizon + H * 0.04, rw * 0.42);
      rock('lamp_post', W * 0.83, horizon + H * 0.04, rw * 0.42);
      rock('barrel', W * 0.08, horizon + H * 0.1, rw * 0.5);
      rock('crate_b', W * 0.93, horizon + H * 0.09, rw * 0.55);
      this.lamps = [
        { x: W * 0.18, y: horizon + H * 0.04 - rw * 0.42 * (LAB_FRAMES.lamp_post[3] / LAB_FRAMES.lamp_post[2]) * 0.82, r: H * 0.3 },
        { x: W * 0.83, y: horizon + H * 0.04 - rw * 0.42 * (LAB_FRAMES.lamp_post[3] / LAB_FRAMES.lamp_post[2]) * 0.82, r: H * 0.3 },
        { x: W * 0.5, y: horizon - H * 0.06, r: H * 0.22 },
      ];
    }
    // A dark edge all round.
    const v = x.createRadialGradient(W / 2, H * 0.6, H * 0.25, W / 2, H * 0.6, H * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, this.o.boss ? 'rgba(40,0,0,0.75)' : 'rgba(0,0,0,0.75)');
    x.fillStyle = v;
    x.fillRect(0, 0, W, H);
    this.bg = c;
  }

  // ------------------------------------------------------------------ fighters
  setFighters(list: Stage2DFighter[], aim: string | null) {
    const party = list.filter((f) => f.side === 'party');
    const foes = list.filter((f) => f.side === 'foe');
    const add = (row: Stage2DFighter[]) =>
      row.forEach((f) => {
        let a = this.actors.get(f.id);
        if (!a) {
          a = {
            f, home: { x: 0, y: 0 }, off: { x: 0, y: 0 }, scale: 1, lean: 0, squash: 1, down: f.out && !f.fled ? 1 : 0,
            gone: f.out && (f.fled || f.side === 'foe') ? 1 : 0, flashT: 0, pose: 'idle', busy: 0,
            hover: f.side === 'foe' && (HOVER_KINDS.has(f.kind ?? '') || HOVER_ICONS.has(f.icon ?? '')), pics: {}, h: 40,
          };
          this.actors.set(f.id, a);
          this.makePics(a);
          if (f.side === 'foe' && !f.out) {
            // Monsters drop in.
            const act = a;
            act.off.y = -this.H;
            this.tween(0.55, (k) => (act.off.y = -this.H * (1 - ease.in(k))), () => this.land(act));
          }
        }
        a.f = f;
        if (!a.busy && !f.out && a.down > 0 && f.side === 'party') this.tween(0.4, (k) => (a!.down = 1 - k));
        if (!a.busy && f.out && f.fled) a.gone = 1;
      });
    add(party);
    add(foes);
    const order = (row: Stage2DFighter[]) => row.forEach((f, i) => {
      const a = this.actors.get(f.id)!;
      (a as Actor & { slot: [number, number] }).slot = [i, row.length];
      this.place(a);
    });
    order(party);
    order(foes);
    this.aimId = aim;
  }

  private place(a: Actor) {
    const [i, n] = (a as Actor & { slot?: [number, number] }).slot ?? [0, 1];
    const { W, H } = this;
    const mid = i - (n - 1) / 2;
    if (a.f.side === 'party') {
      a.home = { x: W * 0.2 + mid * W * 0.14, y: H * 0.9 - Math.abs(mid) * H * 0.03 };
      a.scale = 1;
      a.h = H * 0.36;
    } else {
      a.home = { x: W * 0.68 + mid * W * (a.f.boss ? 0 : 0.17), y: H * 0.62 + Math.abs(mid) * H * 0.04 };
      a.scale = a.f.boss ? 1.55 : 0.95;
      a.h = H * 0.24 * a.scale;
    }
  }

  private makePics(a: Actor) {
    if (a.f.side === 'party') {
      const ap = a.f.appearance;
      if (!ap) return;
      const R = 3;
      const draw = (pose: Pose) => {
        const c = document.createElement('canvas');
        c.width = FRAME_W * R;
        c.height = FRAME_H * R;
        const x = c.getContext('2d')!;
        x.scale(R, R);
        drawCharacter(x, ap, this.o.character, pose);
        return { img: c, white: whiteCopy(c) };
      };
      // Your party from behind (facing the monsters).
      a.pics = {
        idle: draw({ view: 'back', armR: 0.3 }),
        act: draw({ view: 'back', armR: 2.6, bendR: 0.4, legL: 0.6, tilt: 0.05 }),
        hurt: draw({ view: 'back', armL: 0.7, armR: 0.7, tilt: -0.1, bob: 1 }),
      };
      return;
    }
    const set = (url: string) => {
      const im = new Image();
      im.onload = () => {
        const c = trimmed(im);
        const p = { img: c, white: whiteCopy(c) };
        a.pics = { idle: p, act: p, hurt: p };
      };
      im.src = url;
    };
    // Its picture (made once per kind; a second monster of the same kind waits for the first's).
    const tryPic = (n: number) => {
      if (this.dead) return;
      const u = monsterPic(a.f.kind, a.f.icon, a.f.boss, 96);
      if (u) return set(u);
      if (n === 0) void loadMonsterPics([{ kind: a.f.kind, icon: a.f.icon, boss: a.f.boss }], () => tryPic(1), 96);
      if (n < 20) window.setTimeout(() => tryPic(n + 1), 250);
    };
    tryPic(0);
  }

  private land(a: Actor) {
    a.squash = 0.6;
    this.tween(0.3, (k) => (a.squash = 0.6 + 0.4 * ease.back(k)));
    this.burst(a.home.x, a.home.y, 14, '#9aa7c7', 2.5, -1.5, 5, 0.5);
    this.fx.push({ kind: 'ring', x: a.home.x, y: a.home.y, r: this.H * (a.f.boss ? 0.3 : 0.18), ang: 0, t: 0, dur: 0.45, color: '#aab8e0' });
    this.shake(a.f.boss ? 6 : 2.5);
  }

  // ------------------------------------------------------------------ playing a round
  play(e: LabEvent): number {
    const A = this.actors.get(e.actor);
    const B = e.target ? this.actors.get(e.target) : undefined;
    if (e.kind === 'hit' && A && B) return this.attack(A, B, e);
    if (e.kind === 'guard' && A) {
      const [cx, cy] = this.chest(A);
      this.fx.push({ kind: 'shield', x: cx, y: cy, r: A.h * 0.55, ang: 0, t: 0, dur: 0.7, color: '#74c0fc' });
      this.fx.push({ kind: 'ring', x: A.home.x, y: A.home.y, r: A.h * 0.6, ang: 0, t: 0, dur: 0.5, color: '#74c0fc' });
      this.burst(cx, cy, 16, '#a5d8ff', 2, 0, 0, 0.5);
      return 500;
    }
    if (e.kind === 'faint' && A) {
      A.busy++;
      if (A.f.side === 'foe') {
        this.tween(0.35, (k) => ((A.lean = Math.sin(k * 30) * 0.12), (A.flashT = k < 0.5 ? 0.05 : 0)), () => {
          const [cx, cy] = this.chest(A);
          this.burst(cx, cy, 40, '#9775fa', 3.5, -1, 1, 0.9);
          this.burst(cx, cy, 20, '#ffffff', 5, -1.5, 6, 0.5);
          this.fx.push({ kind: 'ring', x: A.home.x, y: A.home.y, r: A.h * 0.9, ang: 0, t: 0, dur: 0.6, color: '#b197fc' });
          this.tween(0.35, (k) => (A.gone = ease.in(k)), () => A.busy--);
          this.shake(A.f.boss ? 8 : 3);
        });
      } else this.tween(0.5, (k) => (A.down = ease.back(k)), () => A.busy--);
      return 800;
    }
    if (e.kind === 'run' && A) {
      A.busy++;
      const away = A.f.side === 'party' ? -1 : 1;
      this.tween(0.6, (k) => ((A.off.x = away * this.W * 0.6 * ease.in(k)), (A.off.y = -Math.abs(Math.sin(k * 12)) * 4)), () => ((A.gone = 1), A.busy--));
      return 700;
    }
    if (e.kind === 'runfail' && A) {
      A.busy++;
      this.tween(0.6, (k) => ((A.off.y = -Math.sin(k * Math.PI) * A.h * 0.3), (A.lean = Math.sin(k * Math.PI * 2) * 0.3), (A.squash = k > 0.8 ? 0.75 : 1)), () => ((A.squash = 1), (A.lean = 0), A.busy--));
      this.popup(A, '!?', 'miss');
      return 650;
    }
    if (e.kind === 'item') {
      const T = B ?? A;
      if (!T) return 600;
      const [cx, cy] = this.chest(T);
      const color = e.revived ? '#ffd43b' : '#69db7c';
      this.burst(cx, cy, 30, color, 1.5, -2.5, -1, 1);
      this.fx.push({ kind: 'ring', x: T.home.x, y: T.home.y, r: T.h * 0.7, ang: 0, t: 0, dur: 0.6, color });
      if (e.revived) this.tween(0.5, (k) => (T.down = 1 - ease.out(k)));
      this.popup(T, e.revived ? 'REVIVED!' : '+HP', 'heal');
      return 800;
    }
    if (e.kind === 'win') {
      for (const a of this.actors.values())
        if (a.f.side === 'party' && !a.f.out) this.tween(0.9, (k) => (a.off.y = -Math.abs(Math.sin(k * Math.PI * 2)) * a.h * 0.25), () => (a.off.y = 0));
      for (const c of ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#da77f2']) this.burst(this.W * 0.3, this.H * 0.45, 14, c, 4, -3, 5, 1.2);
      return 1000;
    }
    return 500;
  }

  private attack(A: Actor, B: Actor, e: LabEvent): number {
    A.busy++;
    const skill = !!e.skill;
    const party = A.f.side === 'party';
    const color = party ? (skill ? '#4dabf7' : '#ffd43b') : skill ? '#da77f2' : '#ff6b6b';
    const dx = B.home.x - A.home.x, dy = B.home.y - A.home.y;
    const len = Math.hypot(dx, dy) || 1;
    const stopAt = Math.max(0, len - (B.h * 0.55 + A.h * 0.25));
    const reach = { x: (dx / len) * stopAt, y: (dy / len) * stopAt };
    const charge = skill ? 0.45 : 0;
    if (skill) {
      const [cx, cy] = this.chest(A);
      this.fx.push({ kind: 'ball', x: cx, y: cy, r: A.h * 0.8, ang: 0, t: 0, dur: charge, color });
      this.fx.push({ kind: 'ring', x: A.home.x, y: A.home.y, r: A.h, ang: 0, t: 0, dur: charge, color });
      this.burst(cx, cy, 26, color, 2, -2, -2, charge);
      this.punch = 1;
      this.tween(charge, (k) => ((A.squash = 1 - 0.18 * Math.sin(k * Math.PI)), (A.off.y = -Math.sin(k * Math.PI) * A.h * 0.12)));
    }
    this.after(charge, () =>
      this.tween(0.16, (k) => ((A.lean = -0.25 * k), (A.pose = k > 0.3 ? 'act' : 'idle')), () =>
        this.tween(skill ? 0.13 : 0.16, (k) => {
          const q = ease.in(k);
          A.off.x = reach.x * q;
          A.off.y = reach.y * q - Math.sin(k * Math.PI) * A.h * (skill ? 0.4 : 0.15);
          A.squash = 1 + 0.25 * Math.sin(k * Math.PI);
          A.lean = 0.3 * k * (party ? 1 : -1);
        }, () =>
          this.tween(0.09, () => {}, () => {
            this.impact(A, B, e, color, dx / len, dy / len);
            this.after(0.12, () =>
              this.tween(0.3, (k) => {
                const q = 1 - ease.out(k);
                A.off.x = reach.x * q;
                A.off.y = reach.y * q;
                A.lean = 0.3 * q * (party ? 1 : -1);
              }, () => ((A.lean = 0), (A.squash = 1), (A.pose = 'idle'), A.busy--)),
            );
          }),
        ),
      ),
    );
    return (charge + 0.16 + 0.16 + 0.09 + 0.12 + 0.3) * 1000 + (e.crit || skill ? 220 : 120);
  }

  private impact(A: Actor, B: Actor, e: LabEvent, color: string, ux: number, uy: number) {
    const skill = !!e.skill, crit = !!e.crit, blocked = !!e.blocked;
    const [cx, cy] = this.chest(B);
    const heavy = (e.dmg ?? 0) / Math.max(1, B.f.maxHp);
    this.stop = Math.max(this.stop, skill ? 0.17 : crit ? 0.14 : 0.08);
    B.flashT = 0.12;
    B.pose = 'hurt';
    const kb = (B.h * 0.25) * (0.5 + heavy * 2 + (skill ? 0.6 : 0));
    this.tween(0.38, (k) => {
      const q = Math.sin(k * Math.PI) * (1 - k * 0.3);
      B.off.x = ux * kb * q;
      B.off.y = uy * kb * q;
      B.squash = 1 - 0.3 * Math.sin(k * Math.PI);
      B.lean = -0.35 * Math.sin(k * Math.PI) * (B.f.side === 'foe' ? -1 : 1);
    }, () => ((B.off.x = 0), (B.off.y = 0), (B.squash = 1), (B.lean = 0), (B.pose = 'idle')));
    this.shake(2 + heavy * 14 + (crit ? 3 : 0) + (skill ? 5 : 0));
    if (blocked) {
      this.fx.push({ kind: 'shield', x: cx, y: cy, r: B.h * 0.5, ang: 0, t: 0, dur: 0.3, color: '#74c0fc' });
      this.burst(cx, cy, 20, '#74c0fc', 4, -1, 3, 0.4);
    }
    const n = skill ? 60 : crit ? 40 : 22;
    this.burst(cx, cy, n, crit ? '#fff3bf' : color, skill ? 6 : 4.5, -1.5, 7, 0.6);
    this.burst(cx, cy, Math.round(n / 3), '#ffffff', 7, -1, 9, 0.3);
    this.fx.push({ kind: 'slash', x: cx, y: cy, r: B.h * 0.55, ang: 0.6, t: 0, dur: 0.3, color });
    if (crit || skill) this.fx.push({ kind: 'slash', x: cx, y: cy, r: B.h * 0.65, ang: -1.1, t: 0, dur: 0.3, color: crit ? '#fff3bf' : '#ffffff' });
    if (skill) {
      this.fx.push({ kind: 'slash', x: cx, y: cy, r: B.h * 0.9, ang: 2.2, t: 0, dur: 0.35, color });
      this.fx.push({ kind: 'ring', x: B.home.x, y: B.home.y, r: B.h * 1.4, ang: 0, t: 0, dur: 0.6, color });
      this.flash = 0.55;
    } else if (crit) this.flash = 0.3;
    this.popup(B, `${blocked ? '🛡' : ''}${e.dmg ?? 0}`, skill ? 'skill' : crit ? 'crit' : blocked ? 'block' : A.f.side === 'party' ? 'hit' : 'hurt');
  }

  private chest(a: Actor): [number, number] {
    return [a.home.x + a.off.x, a.home.y + a.off.y - a.h * 0.5 - (a.hover ? a.h * 0.35 : 0)];
  }

  // ------------------------------------------------------------------ juice
  private tween(dur: number, step: (k: number) => void, done?: () => void) {
    step(0);
    this.tweens.push({ t: 0, dur, step, done });
  }

  private after(sec: number, fn: () => void) {
    if (sec <= 0) fn();
    else this.timers.push({ at: this.time + sec, fn });
  }

  private shake(px: number) {
    this.shakeAmp = Math.min(14, Math.max(this.shakeAmp, px));
  }

  /** Pixel sparks: `n` squares flying out at `speed`, `up` extra upward speed, falling with `g`. */
  private burst(x: number, y: number, n: number, color: string, speed: number, up: number, g: number, life: number) {
    const k = this.H / 180;
    for (let i = 0; i < n && this.bits.length < 400; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * k * 30 * (0.4 + Math.random() * 0.8);
      const l = life * (0.6 + Math.random() * 0.6);
      this.bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7 + up * k * 30, life: l, max: l, color, size: Math.random() < 0.3 ? 2 : 1, g: g * k * 30 });
    }
  }

  /** A big number (or word) that pops off a fighter (same look as the 3D fight). */
  private popup(a: Actor, text: string, kind: string) {
    if (this.overlay.childElementCount > 10) this.overlay.firstElementChild?.remove();
    const [cx] = this.chest(a);
    const top = a.home.y + a.off.y - a.h * (a.hover ? 1.4 : 1.05);
    const el = document.createElement('div');
    el.className = `b3-num ${kind}`;
    el.innerHTML = kind === 'crit' ? `<small>CRIT!</small>${text}` : kind === 'skill' ? `<small>SKILL!</small>${text}` : text;
    el.style.left = `${cx * this.PX}px`;
    el.style.top = `${top * this.PX}px`;
    this.overlay.append(el);
    window.setTimeout(() => el.remove(), 1100);
  }

  // ------------------------------------------------------------------ frames
  private frame = () => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.frame);
    const now = performance.now();
    const real = Math.min(0.1, (now - this.last) / 1000) * ((window as unknown as { __kh3dSlow?: number }).__kh3dSlow ?? 1);
    this.last = now;
    let dt = real;
    if (this.stop > 0) {
      this.stop -= real;
      dt = real * 0.05;
    }
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].at <= this.time) this.timers.splice(i, 1)[0].fn();
    for (let i = 0; i < this.tweens.length; i++) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      if (k >= 1) {
        this.tweens.splice(i--, 1);
        tw.done?.();
      }
    }
    this.draw(real);
  };

  private draw(real: number) {
    const { ctx: x, W, H } = this;
    const t = this.time;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    // Camera: shake and the zoom punch on skills.
    this.shakeAmp *= Math.pow(0.02, real);
    this.punch *= Math.pow(0.08, real);
    const z = 1 + this.punch * 0.08;
    const sx = Math.round((Math.random() - 0.5) * this.shakeAmp), sy = Math.round((Math.random() - 0.5) * this.shakeAmp);
    x.setTransform(z, 0, 0, z, W / 2 - (W / 2) * z + sx, H / 2 - (H / 2) * z + sy);
    if (this.bg) x.drawImage(this.bg, 0, 0);
    else (x.fillStyle = '#0c0a12'), x.fillRect(0, 0, W, H);
    // Lamp light, flickering.
    x.globalCompositeOperation = 'lighter';
    for (const [i, l] of this.lamps.entries()) {
      const r = l.r * (1 + Math.sin(t * 9 + i * 2) * 0.04);
      const g = x.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
      g.addColorStop(0, i === 2 ? 'rgba(120,170,255,0.32)' : 'rgba(255,150,60,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    x.globalCompositeOperation = 'source-over';
    // Fighters, far ones first.
    const list = [...this.actors.values()].sort((a, b) => a.home.y + a.off.y - (b.home.y + b.off.y));
    for (const a of list) this.drawActor(a, t, real);
    // The aim marker under the monster you're aiming at.
    const aimed = this.aimId ? this.actors.get(this.aimId) : undefined;
    if (aimed && !aimed.f.out && aimed.gone < 0.5) {
      const ax = aimed.home.x + aimed.off.x, ay = aimed.home.y + aimed.off.y;
      x.strokeStyle = '#ffd43b';
      x.lineWidth = 1;
      x.beginPath();
      x.ellipse(ax, ay, aimed.h * 0.45, aimed.h * 0.13, 0, 0, Math.PI * 2);
      x.stroke();
      const top = ay - aimed.h * (aimed.hover ? 1.45 : 1.1) + Math.sin(t * 5) * 2;
      x.fillStyle = '#ffd43b';
      x.beginPath();
      x.moveTo(ax - 4, top - 5);
      x.lineTo(ax + 4, top - 5);
      x.lineTo(ax, top);
      x.fill();
    }
    // Effects.
    x.globalCompositeOperation = 'lighter';
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += real;
      const k = Math.min(1, f.t / f.dur);
      if (k >= 1) {
        this.fx.splice(i, 1);
        continue;
      }
      const e = ease.out(k);
      x.globalAlpha = 1 - k * k;
      x.strokeStyle = f.color;
      x.fillStyle = f.color;
      if (f.kind === 'slash') {
        x.lineWidth = Math.max(1, 4 * (1 - k));
        x.beginPath();
        x.arc(f.x, f.y, f.r * (0.5 + e), f.ang + k * 2, f.ang + k * 2 + Math.PI * 1.1);
        x.stroke();
      } else if (f.kind === 'ring') {
        x.lineWidth = 2;
        x.beginPath();
        x.ellipse(f.x, f.y, f.r * (0.2 + e), f.r * (0.2 + e) * 0.32, 0, 0, Math.PI * 2);
        x.stroke();
      } else if (f.kind === 'ball') {
        const g = x.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * (0.3 + e));
        g.addColorStop(0, f.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.fillRect(f.x - f.r * 1.3, f.y - f.r * 1.3, f.r * 2.6, f.r * 2.6);
      } else {
        x.lineWidth = 1;
        x.globalAlpha = (1 - k) * 0.6;
        x.beginPath();
        x.ellipse(f.x, f.y, f.r, f.r * 1.15, 0, 0, Math.PI * 2);
        x.fill();
        x.globalAlpha = 1 - k;
        x.stroke();
      }
    }
    x.globalAlpha = 1;
    // Pixel sparks.
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life -= real;
      if (b.life <= 0) {
        this.bits.splice(i, 1);
        continue;
      }
      b.vy += b.g * real;
      b.vx *= 1 - 1.8 * real;
      b.x += b.vx * real;
      b.y += b.vy * real;
      x.globalAlpha = Math.min(1, b.life / (b.max * 0.4));
      x.fillStyle = b.color;
      x.fillRect(Math.round(b.x), Math.round(b.y), b.size, b.size);
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - real * 1.8);
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.fillStyle = `rgba(255,255,255,${this.flash})`;
      x.fillRect(0, 0, W, H);
    }
  }

  private drawActor(a: Actor, t: number, real: number) {
    if (a.gone >= 1) return;
    const x = this.ctx;
    const p = a.pics[a.pose] ?? a.pics.idle;
    const px = a.home.x + a.off.x;
    const hoverY = a.hover && a.down < 0.5 ? a.h * 0.35 + Math.sin(t * 2.6 + a.home.x) * 2 : 0;
    const py = a.home.y + a.off.y - hoverY;
    const shrink = 1 - a.gone;
    // A soft shadow on the floor (smaller and fainter when it's off the ground).
    const lift = Math.max(0, -a.off.y + hoverY);
    const k = 1 / (1 + lift / (a.h * 0.6));
    x.fillStyle = `rgba(0,0,0,${0.45 * k})`;
    x.beginPath();
    x.ellipse(a.home.x + a.off.x, a.home.y, a.h * 0.32 * k * shrink, a.h * 0.09 * k * shrink, 0, 0, Math.PI * 2);
    x.fill();
    if (!p) return;
    const breathe = a.busy ? 0 : Math.sin(t * 3 + a.home.x) * 0.03;
    const sq = a.squash + breathe;
    const h = a.h * shrink;
    const w = (p.img.width / p.img.height) * h;
    x.save();
    x.translate(Math.round(px), Math.round(py));
    x.rotate(a.lean + a.down * (a.f.side === 'party' ? -1.4 : 1.4));
    x.scale(1 / Math.sqrt(sq), sq);
    x.drawImage(p.img, -w / 2, -h, w, h);
    if (a.flashT > 0) {
      a.flashT -= real;
      x.globalAlpha = 0.85;
      x.drawImage(p.white, -w / 2, -h, w, h);
      x.globalAlpha = 1;
    }
    x.restore();
  }

  private onTap = (ev: PointerEvent) => {
    const r = this.cv.getBoundingClientRect();
    const ix = ((ev.clientX - r.left) / r.width) * this.W, iy = ((ev.clientY - r.top) / r.height) * this.H;
    let best: { id: string; d: number } | null = null;
    for (const [id, a] of this.actors) {
      if (a.f.side !== 'foe' || a.f.out) continue;
      const [cx, cy] = this.chest(a);
      const d = Math.hypot(ix - cx, iy - cy);
      if (d < a.h * 0.7 && (!best || d < best.d)) best = { id, d };
    }
    if (best) this.o.onAim(best.id);
  };

  destroy() {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.cv.removeEventListener('pointerdown', this.onTap);
    this.cv.remove();
    this.overlay.remove();
    this.actors.clear();
  }
}

// ⚔️ Labirin Purba: the pixel-art fight stage (the default). Built from the dungeon's own tileset:
// a cobbled floor that runs off into the dark (fake 3D: each line drawn narrower towards the
// horizon), rock walls and lit lamps at the back, your party up close (seen from behind, drawn by the
// game's own character painter), the monsters across the floor (their 3D models, rendered once into
// small pixel pictures). Every move is played big, as in 3D: wind-up, lunge, squash and stretch,
// hit-stop, knockback, screen shake, slash arcs, pixel sparks, shockwaves, a charge aura and zoom
// punch on skills, big numbers.
//
// The arena is pixel art (painted once at a low resolution, scaled up with hard edges); the fighters
// are drawn sharp on top: you in a side-on battle stance (the game's own character art: real hair,
// face, outfit) holding a keris and a shield in your Labirin gear's tier colours, the monsters from
// their 3D models. Each has a set of poses (stance ×2, wind-up, strike, follow-through, skill, guard,
// hurt, victory) painted once per fight, then just swapped. Every picture gets a dark outline, darker
// purple shading and a warm rim from the lamps, so they sit in the same dark cave as the arena.
//
// Cheap: one 2D canvas, a few sprites and the effects per frame. No 3D engine.
import type { Appearance, CharacterConfig, LabEvent } from '@kh/shared';
import { drawCharacter, FRAME_H, FRAME_W, sideHand, type Pose } from '../../../character/draw';
import { LAB_FRAMES, LAB_SHEET_URL, type LabFrame } from '../../../world/labSheet';
import type { StageFighter } from '../battle3d/stage';
import { loadMonsterPoses, monsterPoses } from '../portraits';

export interface Stage2DFighter extends StageFighter {
  appearance?: Appearance;
  /** Labirin gear tier colours (what they hold and wear), if known. */
  gear?: { weapon?: string; shield?: string; armour?: string; charm?: string };
}

type PoseName = 'idle' | 'idle1' | 'windup' | 'strike' | 'follow' | 'skill' | 'guard' | 'hurt' | 'win';
type Pic = { img: HTMLCanvasElement; white: HTMLCanvasElement };

/** Your fighter's poses (side view: the art faces left, it's flipped to face the monsters). */
const PLAYER_POSES: Record<PoseName, Pose> = {
  idle: { view: 'side', legL: 0.45, legR: -0.35, armL: 0.95, bendL: 0.55, armR: 0.55, bendR: -0.6, tilt: -0.05 },
  idle1: { view: 'side', legL: 0.45, legR: -0.35, armL: 0.85, bendL: 0.65, armR: 0.5, bendR: -0.55, tilt: -0.04, bob: 0.6 },
  windup: { view: 'side', legL: 0.6, legR: -0.5, armL: -2.2, bendL: -0.6, armR: 0.9, bendR: -0.4, tilt: 0.07 },
  strike: { view: 'side', legL: 0.95, legR: -0.85, armL: 1.7, bendL: 0.1, armR: -0.4, bendR: 0, tilt: -0.15, mouth: 'open' },
  follow: { view: 'side', legL: 0.8, legR: -0.7, armL: 0.5, bendL: -0.9, armR: -0.2, bendR: 0, tilt: -0.1 },
  skill: { view: 'side', legL: 0.55, legR: -0.5, armL: 2.9, bendL: 0.2, armR: 2.5, bendR: 0.2, mouth: 'grin' },
  guard: { view: 'side', legL: 0.4, legR: -0.4, armL: 0.5, bendL: 0.3, armR: 1.4, bendR: -1.2, tilt: 0.05 },
  hurt: { view: 'side', eyes: 'closed', mouth: 'open', tilt: 0.17, armL: -0.4, armR: -0.6, legL: 0.25, legR: -0.25 },
  win: { view: 'side', armL: 2.8, bendL: 0.3, armR: 2.4, mouth: 'grin', eyes: 'happy', bob: -2, legL: 0.3, legR: -0.3 },
};
/** Monster pictures per pose (from their 3D model's own motion). */
const MONSTER_FOR: Record<PoseName, string> = { idle: 'idle0', idle1: 'idle1', windup: 'windup', strike: 'strike', follow: 'strike', skill: 'windup', guard: 'idle0', hurt: 'hurt', win: 'idle1' };

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
  pose: PoseName;
  busy: number;
  hover: boolean;
  /** Pictures (and white copies for the hit flash), per pose. */
  pics: Partial<Record<PoseName, Pic>>;
  /** Picture height on screen (internal px), and where its feet are (share of the picture's height). */
  h: number;
  feet: number;
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
  /** bolt: a zigzag from the top of the screen down to (x, y); pillar: a column of light `r` wide rising
   *  from (x, y); nova: a starburst of rays (screen-sized for an ultimate). */
  kind: 'slash' | 'ring' | 'ball' | 'shield' | 'bolt' | 'pillar' | 'nova';
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

/** Several pictures cut to the area any of them draws (same crop for all poses: no size jumps). */
function unionTrim(list: HTMLCanvasElement[]): { list: HTMLCanvasElement[]; y0: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const c of list) {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (d[(y * c.width + x) * 4 + 3] > 20) (x0 = Math.min(x0, x), y0 = Math.min(y0, y), x1 = Math.max(x1, x), y1 = Math.max(y1, y));
  }
  if (x1 < 0) return { list, y0: 0 };
  return {
    y0,
    list: list.map((c) => {
      const o = document.createElement('canvas');
      o.width = x1 - x0 + 1;
      o.height = y1 - y0 + 1;
      o.getContext('2d')!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
      return o;
    }),
  };
}

/**
 * Lit like the cave: darker with a purple cast, deeper shade towards the feet, a warm rim from the
 * lamps on the side facing the light, and a dark outline all round.
 */
function gradeDark(src: HTMLCanvasElement, outline: number, lightFromLeft: boolean, tint = '#9b8bb8'): HTMLCanvasElement {
  const pad = outline + 1;
  const W = src.width + pad * 2, H = src.height + pad * 2;
  // The shaded sprite.
  const sh = document.createElement('canvas');
  sh.width = W;
  sh.height = H;
  const s = sh.getContext('2d')!;
  s.drawImage(src, pad, pad);
  s.globalCompositeOperation = 'multiply';
  s.fillStyle = tint;
  s.fillRect(0, 0, W, H);
  s.globalCompositeOperation = 'destination-in';
  s.drawImage(src, pad, pad);
  s.globalCompositeOperation = 'source-atop';
  const down = s.createLinearGradient(0, 0, 0, H);
  down.addColorStop(0, 'rgba(0,0,0,0)');
  down.addColorStop(0.55, 'rgba(10,4,20,0.1)');
  down.addColorStop(1, 'rgba(10,4,20,0.5)');
  s.fillStyle = down;
  s.fillRect(0, 0, W, H);
  const side = s.createLinearGradient(lightFromLeft ? 0 : W, 0, lightFromLeft ? W : 0, 0);
  side.addColorStop(0, 'rgba(255,160,80,0.28)');
  side.addColorStop(0.35, 'rgba(255,160,80,0)');
  side.addColorStop(0.8, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(120,150,255,0.18)');
  s.fillStyle = side;
  s.fillRect(0, 0, W, H);
  // Outline (the silhouette, stamped round in a ring), then the sprite on top.
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const o = out.getContext('2d')!;
  const sil = document.createElement('canvas');
  sil.width = W;
  sil.height = H;
  const si = sil.getContext('2d')!;
  si.drawImage(src, pad, pad);
  si.globalCompositeOperation = 'source-in';
  si.fillStyle = '#07040d';
  si.fillRect(0, 0, W, H);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    o.drawImage(sil, Math.round(Math.cos(a) * outline), Math.round(Math.sin(a) * outline));
  }
  o.drawImage(sh, 0, 0);
  return out;
}

/** A keris held in a hand (frame units): grip, gold guard, a wavy blade with its tier's edge. */
function drawKeris(x: CanvasRenderingContext2D, hx: number, hy: number, angle: number, edge: string) {
  x.save();
  x.translate(hx, hy);
  x.rotate(Math.atan2(Math.cos(angle), -Math.sin(angle)));
  x.lineCap = 'round';
  x.strokeStyle = '#2a1608';
  x.lineWidth = 2.2;
  x.beginPath();
  x.moveTo(-3.2, 0);
  x.lineTo(0.5, 0);
  x.stroke();
  x.strokeStyle = '#7a4a22';
  x.lineWidth = 1.4;
  x.stroke();
  x.fillStyle = '#e0b030';
  x.beginPath();
  x.ellipse(0.8, 0, 0.9, 2.1, 0, 0, Math.PI * 2);
  x.fill();
  // The wavy blade.
  x.beginPath();
  x.moveTo(1.5, -1.1);
  for (let i = 0; i <= 14; i++) x.lineTo(1.5 + i, -1.1 + Math.sin(i * 1.3) * 0.7 + i * 0.05);
  x.lineTo(17, 0.2);
  for (let i = 14; i >= 0; i--) x.lineTo(1.5 + i, 1.1 + Math.sin(i * 1.3) * 0.7 - i * 0.03);
  x.closePath();
  x.fillStyle = '#cfd6e2';
  x.fill();
  x.strokeStyle = edge;
  x.lineWidth = 0.6;
  x.stroke();
  x.strokeStyle = 'rgba(255,255,255,0.7)';
  x.lineWidth = 0.35;
  x.beginPath();
  x.moveTo(2.5, -0.3);
  x.lineTo(14, 0);
  x.stroke();
  x.restore();
}

/** A round shield on the far arm (frame units), rimmed in its tier colour. */
function drawShield(x: CanvasRenderingContext2D, hx: number, hy: number, rim: string) {
  x.save();
  x.translate(hx - 1.5, hy - 1);
  x.fillStyle = '#5a3a1c';
  x.beginPath();
  x.ellipse(0, 0, 4.6, 6, 0, 0, Math.PI * 2);
  x.fill();
  for (let i = -2; i <= 2; i++) (x.strokeStyle = 'rgba(0,0,0,0.25)'), (x.lineWidth = 0.4), x.beginPath(), x.moveTo(i * 1.6, -5.5), x.lineTo(i * 1.6, 5.5), x.stroke();
  x.strokeStyle = rim;
  x.lineWidth = 1.2;
  x.beginPath();
  x.ellipse(0, 0, 4.6, 6, 0, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = rim;
  x.beginPath();
  x.arc(0, 0, 1.3, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = 'rgba(255,255,255,0.5)';
  x.beginPath();
  x.arc(-0.4, -0.4, 0.5, 0, Math.PI * 2);
  x.fill();
  x.restore();
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
  /** The flash's colour (white, or a spell's). */
  private flashColor = '#ffffff';
  private last = performance.now();
  private raf = 0;
  private dead = false;
  private aimId: string | null = null;
  private lamps: Array<{ x: number; y: number; r: number }> = [];
  private ro: ResizeObserver;
  private sheet: HTMLImageElement | null = null;
  /** Canvas pixels per art pixel. */
  private S = 3;

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
    // The canvas itself is at screen sharpness (fighters drawn sharp); everything is laid out in art
    // pixels and scaled by S, and the backdrop is scaled up with hard edges (the pixel look).
    this.S = this.PX * Math.min(1.5, window.devicePixelRatio || 1);
    this.cv.width = Math.ceil(this.W * this.S);
    this.cv.height = Math.ceil(this.H * this.S);
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
            hover: f.side === 'foe' && (HOVER_KINDS.has(f.kind ?? '') || HOVER_ICONS.has(f.icon ?? '')), pics: {}, h: 40, feet: 1,
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
      a.h = H * 0.42;
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
      const R = 5; // sharp: hair strands, face, the keris's wave
      const weapon = a.f.gear?.weapon ?? '#a0763c';
      const shield = a.f.gear?.shield;
      const raw: HTMLCanvasElement[] = [];
      const names = Object.keys(PLAYER_POSES) as PoseName[];
      for (const n of names) {
        const pose = PLAYER_POSES[n];
        const c = document.createElement('canvas');
        c.width = (FRAME_W + 24) * R;
        c.height = (FRAME_H + 20) * R;
        const x = c.getContext('2d')!;
        x.scale(R, R);
        x.translate(12, 14); // room round the frame for a raised keris
        drawCharacter(x, ap, this.o.character, pose);
        if (shield) {
          const f = sideHand(ap, this.o.character, pose, 'far');
          drawShield(x, f.x, f.y, shield);
        }
        const h = sideHand(ap, this.o.character, pose, 'near');
        drawKeris(x, h.x, h.y, h.angle, weapon);
        raw.push(c);
      }
      const { list: cut, y0 } = unionTrim(raw);
      // Where the feet are in the cut picture (the frame's feet line: 68 of 72, 14 down from the top).
      const pad = Math.max(2, Math.round(R * 0.5));
      a.feet = Math.min(1, (pad + 1 + (14 + 68) * R - y0) / (cut[0].height + (pad + 1) * 2));
      a.pics = {};
      names.forEach((n, i) => {
        const g = gradeDark(cut[i], pad, false, '#7f739c'); // (the flat character art needs more shade)
        a.pics[n] = { img: g, white: whiteCopy(g) };
      });
      return;
    }
    const set = (urls: Record<string, string>) => {
      const keys = Object.keys(urls);
      const ims = keys.map((k) => {
        const im = new Image();
        im.src = urls[k];
        return im;
      });
      void Promise.all(ims.map((im) => im.decode().catch(() => {}))).then(() => {
        if (this.dead) return;
        const cvs = ims.map((im) => {
          const c = document.createElement('canvas');
          c.width = im.width || 1;
          c.height = im.height || 1;
          c.getContext('2d')!.drawImage(im, 0, 0);
          return c;
        });
        const { list: cut } = unionTrim(cvs);
        // Its feet: the lowest drawn row of the idle picture (the other poses may reach lower).
        const idle = cut[Math.max(0, keys.indexOf('idle0'))];
        const d = idle.getContext('2d')!.getImageData(0, 0, idle.width, idle.height).data;
        let low = idle.height - 1;
        find: for (let y = idle.height - 1; y >= 0; y--) for (let x = 0; x < idle.width; x++) if (d[(y * idle.width + x) * 4 + 3] > 40) {
          low = y;
          break find;
        }
        const byKey: Record<string, Pic> = {};
        keys.forEach((k, i) => {
          const g = gradeDark(cut[i], 3, true);
          byKey[k] = { img: g, white: whiteCopy(g) };
        });
        a.pics = {};
        for (const n of Object.keys(MONSTER_FOR) as PoseName[]) a.pics[n] = byKey[MONSTER_FOR[n]] ?? byKey.idle0;
        a.feet = (4 + low + 1) / (idle.height + 8); // (gradeDark adds 3 + 1 px all round)
      });
    };
    // Its posed pictures (made once per kind; a second monster of the same kind waits for the first's).
    const tryPic = (n: number) => {
      if (this.dead) return;
      const u = monsterPoses(a.f.kind, a.f.icon, a.f.boss);
      if (u) return set(u);
      if (n === 0) void loadMonsterPoses([{ kind: a.f.kind, icon: a.f.icon, boss: a.f.boss }], () => tryPic(1));
      if (n < 30) window.setTimeout(() => tryPic(n + 1), 250);
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
    // 📜 An ultimate: the cast, then every hit lands together (no lunge).
    if (e.kind === 'spell' && A) return this.cast(A, e);
    // 🔥 A burn ticking: a lick of flame and the number.
    if (e.kind === 'hit' && e.burn && B) {
      const [cx, cy] = this.chest(B);
      this.burst(cx, cy + B.h * 0.2, 18, '#ff922b', 1.2, -4, -3, 0.6);
      this.burst(cx, cy, 8, '#ffe066', 1, -3, -2, 0.4);
      B.flashT = 0.08;
      this.popup(B, `${e.dmg ?? 0}`, 'hurt');
      return 380;
    }
    // 🌪️ A skill that hits everyone: a short charge of the element's colour (the hits follow).
    if (e.kind === 'cast' && A) {
      const color = e.color ?? '#63e6be';
      const [cx, cy] = this.chest(A);
      A.pose = 'skill';
      this.fx.push({ kind: 'ball', x: cx, y: cy, r: A.h * 0.8, ang: 0, t: 0, dur: 0.4, color });
      this.fx.push({ kind: 'ring', x: A.home.x, y: A.home.y, r: A.h * 1.1, ang: 0, t: 0, dur: 0.45, color });
      this.burst(cx, cy, 26, color, 3, -1, 0, 0.45);
      this.punch = 1;
      this.after(0.45, () => A.pose === 'skill' && (A.pose = 'idle'));
      return 450;
    }
    if (e.kind === 'hit' && e.aoe && A && B) {
      const dx = B.home.x - A.home.x, dy = B.home.y - A.home.y, len = Math.hypot(dx, dy) || 1;
      const [cx, cy] = this.chest(B);
      const color = e.color ?? '#ff922b';
      // It comes down from above.
      this.burst(cx, cy - B.h * 0.9, e.spell ? 40 : 24, color, 1.2, 9, 14, 0.5, e.spell ? 3 : 2);
      this.fx.push({ kind: 'ball', x: cx, y: cy, r: B.h * (e.spell ? 1.3 : 0.9), ang: 0, t: 0, dur: 0.4, color });
      this.impact(A, B, e, color, dx / len, dy / len);
      return e.spell ? 340 : 280;
    }
    if (e.kind === 'hit' && A && B) return this.attack(A, B, e);
    if (e.kind === 'guard' && A) {
      A.pose = 'guard';
      this.after(0.7, () => A.pose === 'guard' && (A.pose = 'idle'));
      const [cx, cy] = this.chest(A);
      const gc = e.color ?? '#74c0fc';
      this.fx.push({ kind: 'shield', x: cx, y: cy, r: A.h * 0.55, ang: 0, t: 0, dur: 0.7, color: gc });
      this.fx.push({ kind: 'ring', x: A.home.x, y: A.home.y, r: A.h * 0.6, ang: 0, t: 0, dur: 0.5, color: gc });
      this.burst(cx, cy, 16, e.element ? gc : '#a5d8ff', 2, 0, 0, 0.5);
      // 🪨 Stone: chips fall off.
      if (e.element === 'tanah') this.burst(cx, cy, 14, '#8d6e4f', 1.5, -1, 8, 0.6);
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
      const color = e.revived ? '#ffd43b' : e.color ?? '#69db7c';
      if (e.aoe) {
        this.burst(cx, cy - T.h * 0.8, 26, color, 1, 5, 6, 0.8);
        this.fx.push({ kind: 'ring', x: T.home.x, y: T.home.y, r: T.h * 0.7, ang: 0, t: 0, dur: 0.6, color });
        this.popup(T, '+HP', 'heal');
        return 300;
      }
      this.burst(cx, cy, 30, color, 1.5, -2.5, -1, 1);
      this.fx.push({ kind: 'ring', x: T.home.x, y: T.home.y, r: T.h * 0.7, ang: 0, t: 0, dur: 0.6, color });
      if (e.revived) this.tween(0.5, (k) => (T.down = 1 - ease.out(k)));
      this.popup(T, e.revived ? 'REVIVED!' : '+HP', 'heal');
      return 800;
    }
    if (e.kind === 'win') {
      for (const a of this.actors.values())
        if (a.f.side === 'party' && !a.f.out) (a.pose = 'win'), this.tween(0.9, (k) => (a.off.y = -Math.abs(Math.sin(k * Math.PI * 2)) * a.h * 0.25), () => (a.off.y = 0));
      for (const c of ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#da77f2']) this.burst(this.W * 0.3, this.H * 0.45, 14, c, 4, -3, 5, 1.2);
      return 1000;
    }
    return 500;
  }

  private attack(A: Actor, B: Actor, e: LabEvent): number {
    A.busy++;
    const skill = !!e.skill;
    const party = A.f.side === 'party';
    const color = party ? (skill ? (e.color ?? '#4dabf7') : '#ffd43b') : skill ? '#da77f2' : '#ff6b6b';
    const dx = B.home.x - A.home.x, dy = B.home.y - A.home.y;
    const len = Math.hypot(dx, dy) || 1;
    const stopAt = Math.max(0, len - (B.h * 0.55 + A.h * 0.25));
    const reach = { x: (dx / len) * stopAt, y: (dy / len) * stopAt };
    const charge = skill ? 0.5 : 0;
    if (skill) {
      const [cx, cy] = this.chest(A);
      this.fx.push({ kind: 'ball', x: cx, y: cy, r: A.h * 1.5, ang: 0, t: 0, dur: charge, color });
      this.fx.push({ kind: 'ring', x: A.home.x, y: A.home.y, r: A.h * 1.6, ang: 0, t: 0, dur: charge, color });
      this.fx.push({ kind: 'ring', x: A.home.x, y: A.home.y, r: A.h * 1.0, ang: 0, t: 0, dur: charge * 0.8, color: '#ffffff' });
      this.fx.push({ kind: 'pillar', x: A.home.x, y: A.home.y, r: A.h * 0.9, ang: 0, t: 0, dur: charge + 0.15, color });
      this.burst(cx, cy, 40, color, 2.5, -3, -3, charge, 3);
      this.punch = 1.6;
      this.shake(3);
      A.pose = 'skill';
      this.tween(charge, (k) => ((A.squash = 1 - 0.18 * Math.sin(k * Math.PI)), (A.off.y = -Math.sin(k * Math.PI) * A.h * 0.12)));
    }
    this.after(charge, () =>
      this.tween(0.16, (k) => ((A.lean = -0.25 * k), (A.pose = 'windup')), () =>
        this.tween(skill ? 0.13 : 0.16, (k) => {
          const q = ease.in(k);
          A.off.x = reach.x * q;
          A.off.y = reach.y * q - Math.sin(k * Math.PI) * A.h * (skill ? 0.4 : 0.15);
          A.squash = 1 + 0.25 * Math.sin(k * Math.PI);
          A.lean = 0.3 * k * (party ? 1 : -1);
          if (k > 0.6) A.pose = 'strike';
        }, () =>
          this.tween(0.09, () => (A.pose = 'strike'), () => {
            this.impact(A, B, e, color, dx / len, dy / len);
            this.after(0.12, () =>
              this.tween(0.3, (k) => {
                const q = 1 - ease.out(k);
                A.off.x = reach.x * q;
                A.off.y = reach.y * q;
                A.lean = 0.3 * q * (party ? 1 : -1);
                A.pose = k < 0.5 ? 'follow' : 'idle';
              }, () => ((A.lean = 0), (A.squash = 1), (A.pose = 'idle'), A.busy--)),
            );
          }),
        ),
      ),
    );
    return (charge + 0.16 + 0.16 + 0.09 + 0.12 + 0.3) * 1000 + (e.crit || skill ? 220 : 120);
  }

  /** 📜 Casting an ultimate: the caster rises in a glow of the spell's colour, the screen flashes. */
  private cast(A: Actor, e: LabEvent): number {
    A.busy++;
    const color = e.color ?? '#ff922b';
    const [cx, cy] = this.chest(A);
    A.pose = 'skill';
    this.punch = 1;
    this.fx.push({ kind: 'ball', x: cx, y: cy, r: A.h * 1.1, ang: 0, t: 0, dur: 0.7, color });
    this.fx.push({ kind: 'ring', x: A.home.x, y: A.home.y, r: A.h * 1.2, ang: 0, t: 0, dur: 0.7, color });
    this.fx.push({ kind: 'ring', x: A.home.x, y: A.home.y, r: A.h * 0.7, ang: 0, t: 0, dur: 0.5, color: '#ffffff' });
    this.burst(cx, cy, 60, color, 3, -3, -1, 0.8, 3);
    this.burst(cx, cy, 20, '#ffffff', 3.5, -2, 0, 0.6, 2);
    this.fx.push({ kind: 'pillar', x: A.home.x, y: A.home.y, r: A.h * 1.3, ang: 0, t: 0, dur: 0.75, color });
    this.popup(A, e.text.replace(/^.* casts /, '').replace(/!$/, ''), 'ult');
    if (e.element) this.elementFx(A, e.element, color);
    this.tween(0.7, (k) => ((A.off.y = -Math.sin(k * Math.PI) * A.h * 0.25), (A.squash = 1 + 0.1 * Math.sin(k * Math.PI * 2))), () => {
      A.off.y = 0;
      A.squash = 1;
      A.pose = 'idle';
      A.busy--;
    });
    this.after(0.4, () => {
      this.flash = 0.95;
      this.flashColor = color;
      this.punch = 3;
      this.shake(20, 22);
      this.stop = Math.max(this.stop, 0.12);
      const W = this.W, H = this.H;
      this.fx.push({ kind: 'nova', x: W / 2, y: H * 0.45, r: Math.hypot(W, H) * 0.75, ang: Math.random() * 6, t: 0, dur: 0.55, color });
      this.fx.push({ kind: 'ring', x: W / 2, y: H * 0.7, r: W * 0.9, ang: 0, t: 0, dur: 0.6, color: '#ffffff' });
      this.screenMotif(e.element, color);
    });
    return 1150;
  }

  /** 📜 An ultimate's element across the whole field (under the full-screen burst as it fades). */
  private screenMotif(element: string | undefined, color: string) {
    const W = this.W, H = this.H;
    const xs = [0.12, 0.3, 0.5, 0.7, 0.88].map((q) => W * q);
    if (element === 'api') {
      xs.forEach((x0, j) => this.after(j * 0.04, () => this.fx.push({ kind: 'pillar', x: x0, y: H, r: W * 0.14, ang: 0, t: 0, dur: 0.7, color: j % 2 ? '#ff6b00' : '#ffa94d' })));
      this.burst(W / 2, H, 90, '#ff922b', 9, -9, -4, 1, 3);
    } else if (element === 'air') {
      for (let j = 0; j < 3; j++) this.fx.push({ kind: 'ring', x: W / 2, y: H * 0.75, r: W * (0.5 + j * 0.3), ang: 0, t: 0, dur: 0.6 + j * 0.1, color: j % 2 ? '#e7f5ff' : color });
      for (const x0 of xs) this.burst(x0, 0, 18, '#a5d8ff', 1, 6, 20, 0.9, 2);
    } else if (element === 'petir') {
      xs.slice(0, 4).forEach((x0, j) => this.after(j * 0.05, () => this.fx.push({ kind: 'bolt', x: x0 + W * 0.05, y: H * 0.8, r: W * 0.05, ang: Math.random() * 9, t: 0, dur: 0.3, color: j % 2 ? '#fff3bf' : color })));
    } else if (element === 'angin') {
      for (let j = 0; j < 4; j++) this.fx.push({ kind: 'ring', x: W / 2, y: H * (0.85 - j * 0.15), r: W * (0.8 - j * 0.12), ang: 0, t: 0, dur: 0.55 + j * 0.05, color: j % 2 ? '#c3fae8' : color });
      this.burst(0, H * 0.5, 50, '#96f2d7', 12, -1, 0, 0.8, 2);
      this.burst(W, H * 0.4, 50, '#c3fae8', 12, -1, 0, 0.8, 2);
    } else if (element === 'tanah') {
      xs.forEach((x0, j) => this.fx.push({ kind: 'pillar', x: x0, y: H, r: W * 0.1, ang: 0, t: 0, dur: 0.5 + j * 0.03, color: '#a47148' }));
      for (const x0 of xs) this.burst(x0, H, 16, '#8d6e4f', 4, -10, 22, 1, 3);
    } else {
      this.burst(W / 2, H * 0.45, 80, color, 10, -2, 4, 0.9, 3);
    }
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
    const ult = !!e.spell;
    const n = ult ? 70 : skill ? 90 : crit ? 40 : 22;
    this.burst(cx, cy, n, crit ? '#fff3bf' : color, ult ? 7 : skill ? 8 : 4.5, -1.5, 7, ult || skill ? 0.8 : 0.6, ult || skill ? 3 : undefined);
    this.burst(cx, cy, Math.round(n / 3), '#ffffff', 7, -1, 9, 0.3);
    this.fx.push({ kind: 'slash', x: cx, y: cy, r: B.h * 0.55, ang: 0.6, t: 0, dur: 0.3, color });
    if (crit || skill) this.fx.push({ kind: 'slash', x: cx, y: cy, r: B.h * 0.65, ang: -1.1, t: 0, dur: 0.3, color: crit ? '#fff3bf' : '#ffffff' });
    if (skill || ult) {
      this.fx.push({ kind: 'slash', x: cx, y: cy, r: B.h * 1.4, ang: 2.2, t: 0, dur: 0.4, color });
      this.fx.push({ kind: 'slash', x: cx, y: cy, r: B.h * 1.8, ang: -0.4, t: 0, dur: 0.45, color: '#ffffff' });
      this.fx.push({ kind: 'ring', x: B.home.x, y: B.home.y, r: B.h * 2.4, ang: 0, t: 0, dur: 0.7, color });
      this.fx.push({ kind: 'nova', x: cx, y: cy, r: B.h * (ult ? 2.2 : 1.6), ang: Math.random() * 6, t: 0, dur: 0.4, color });
      this.flash = Math.max(this.flash, ult ? 0.5 : 0.7);
      this.flashColor = color;
      this.punch = Math.max(this.punch, ult ? 1.8 : 2);
      this.stop = Math.max(this.stop, 0.22);
      this.shake(ult ? 10 : 12, 18);
    } else if (crit) this.flash = 0.3;
    if (e.element) this.elementFx(B, e.element, color, ult ? 2.2 : skill ? 1.7 : 1);
    this.popup(B, `${blocked ? '🛡' : ''}${e.dmg ?? 0}`, skill ? 'skill' : crit ? 'crit' : blocked ? 'block' : A.f.side === 'party' ? 'hit' : 'hurt');
  }

  /** 🔥💧⚡🌪️🪨 What each element adds where it lands (same style, its own look). `big`: 1 a plain hit,
   *  ~1.7 a skill, ~2.2 an ultimate's hit (bigger sparks, and the element's own column or bolt). */
  private elementFx(B: Actor, element: string, color: string, big = 1) {
    const [cx, cy] = this.chest(B);
    const h = B.h;
    const n = (k: number) => Math.round(k * big);
    const px = big > 1.5 ? 3 : big > 1 ? 2 : undefined;
    const col = (c: string, w: number, d = 0.55) => big > 1 && this.fx.push({ kind: 'pillar', x: B.home.x, y: B.home.y, r: h * w * big * 0.5, ang: 0, t: 0, dur: d, color: c });
    if (element === 'api') {
      // Flames licking up (a column of fire on a skill), embers drifting.
      this.burst(cx, cy + h * 0.3, n(30), '#ff922b', 1.6 * big, -5 * big, -4, 0.7 + 0.2 * big, px);
      this.burst(cx, cy, n(14), '#ffe066', 1.2 * big, -4 * big, -3, 0.5 + 0.2 * big, px);
      this.fx.push({ kind: 'ball', x: cx, y: cy, r: h * 0.6 * big, ang: 0, t: 0, dur: 0.3 + 0.1 * big, color: '#ff6b00' });
      col('#ff6b00', 1.1, 0.7);
    } else if (element === 'air') {
      // A splash: drops thrown up that rain back, a ripple on the ground (a water spout on a skill).
      this.burst(cx, cy, n(30), '#74c0fc', 3.5 * big, -4 * big, 14, 0.7 + 0.2 * big, px);
      this.burst(cx, cy, n(10), '#e7f5ff', 2.5 * big, -3 * big, 12, 0.5 + 0.2 * big, px);
      this.fx.push({ kind: 'ring', x: B.home.x, y: B.home.y, r: h * 0.9 * big, ang: 0, t: 0, dur: 0.5, color: '#a5d8ff' });
      if (big > 1) this.fx.push({ kind: 'ring', x: B.home.x, y: B.home.y, r: h * 1.5 * big, ang: 0, t: 0, dur: 0.7, color: '#4dabf7' });
      col('#4dabf7', 0.9, 0.6);
    } else if (element === 'petir') {
      // A bolt from above (from the top of the screen on a skill) and a white flash.
      if (big > 1) {
        this.fx.push({ kind: 'bolt', x: cx, y: cy, r: h * 0.5, ang: Math.random() * 9, t: 0, dur: 0.35, color });
        this.fx.push({ kind: 'bolt', x: cx + h * 0.15, y: cy, r: h * 0.7, ang: Math.random() * 9, t: 0, dur: 0.28, color: '#fff3bf' });
      } else {
        this.fx.push({ kind: 'slash', x: cx, y: cy - h * 0.6, r: h * 1.3, ang: -1.45, t: 0, dur: 0.22, color: '#fff3bf' });
        this.fx.push({ kind: 'slash', x: cx, y: cy - h * 0.6, r: h * 1.1, ang: -1.7, t: 0, dur: 0.22, color });
      }
      this.burst(cx, cy, n(24), '#ffe066', 6 * big, 0, 2, 0.3 + 0.15 * big, px);
      this.flash = Math.max(this.flash, 0.4 + 0.15 * (big - 1));
      this.flashColor = '#fff9db';
    } else if (element === 'angin') {
      // Swirling rings and leaves blown sideways (a tornado of rings on a skill).
      const rings = big > 1 ? 4 : 2;
      for (let j = 0; j < rings; j++) this.fx.push({ kind: 'ring', x: B.home.x, y: B.home.y - h * (0.3 + j * 0.4), r: h * (0.8 - j * 0.08) * big, ang: 0, t: 0, dur: 0.45 + j * 0.05, color: j % 2 ? '#c3fae8' : color });
      this.burst(cx, cy, n(22), '#96f2d7', 4 * big, -1, -1, 0.6 + 0.2 * big, px);
    } else if (element === 'tanah') {
      // Rocks thrown up that fall hard, a heavy thud (a rock spike on a skill).
      this.burst(B.home.x, B.home.y, n(26), '#a47148', 3 * big, -6 * big, 16, 0.8 + 0.1 * big, px);
      this.burst(B.home.x, B.home.y, n(10), '#5c3d2e', 2 * big, -4 * big, 16, 0.7 + 0.1 * big, px);
      this.fx.push({ kind: 'ring', x: B.home.x, y: B.home.y, r: h * 1.1 * big, ang: 0, t: 0, dur: 0.5, color: '#c08a5a' });
      col('#a47148', 0.8, 0.45);
      this.shake(5 * big, 18);
    }
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

  private shake(px: number, cap = 14) {
    this.shakeAmp = Math.min(cap, Math.max(this.shakeAmp, px));
  }

  /** Pixel sparks: `n` squares flying out at `speed`, `up` extra upward speed, falling with `g`. */
  private burst(x: number, y: number, n: number, color: string, speed: number, up: number, g: number, life: number, size?: number) {
    const k = this.H / 180;
    for (let i = 0; i < n && this.bits.length < 520; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * k * 30 * (0.4 + Math.random() * 0.8);
      const l = life * (0.6 + Math.random() * 0.6);
      this.bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7 + up * k * 30, life: l, max: l, color, size: size ? (Math.random() < 0.5 ? size : Math.max(1, size - 1)) : Math.random() < 0.3 ? 2 : 1, g: g * k * 30 });
    }
  }

  /** A big number (or word) that pops off a fighter (same look as the 3D fight). */
  private popup(a: Actor, text: string, kind: string) {
    if (this.overlay.childElementCount > 10) this.overlay.firstElementChild?.remove();
    const [cx] = this.chest(a);
    const top = a.home.y + a.off.y - a.h * (a.hover ? 1.4 : 1.05);
    const el = document.createElement('div');
    el.className = `b3-num ${kind}`;
    el.innerHTML = kind === 'crit' ? `<small>CRIT!</small>${text}` : kind === 'skill' ? `<small>SKILL!</small>${text}` : kind === 'ult' ? `<small>ULTIMATE!</small>${text.replace(/[<>&]/g, '')}` : text;
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
    const S = this.S;
    x.setTransform(S, 0, 0, S, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    // Camera: shake and the zoom punch on skills.
    this.shakeAmp *= Math.pow(0.02, real);
    this.punch *= Math.pow(0.08, real);
    const z = 1 + Math.min(3, this.punch) * 0.08;
    const sx = Math.round((Math.random() - 0.5) * this.shakeAmp), sy = Math.round((Math.random() - 0.5) * this.shakeAmp);
    x.setTransform(z * S, 0, 0, z * S, (W / 2 - (W / 2) * z + sx) * S, (H / 2 - (H / 2) * z + sy) * S);
    x.imageSmoothingEnabled = false;
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
      } else if (f.kind === 'bolt') {
        // Jagged, flickering; a white core inside the colour.
        const steps = 9;
        const pts: Array<[number, number]> = [];
        for (let j = 0; j <= steps; j++) {
          const q = j / steps;
          const jit = j === 0 || j === steps ? 0 : (Math.sin((f.ang + j) * 12.9898 + Math.floor(f.t * 30)) * 0.5) * f.r;
          pts.push([f.x + jit, f.y * q - 4 * (1 - q)]);
        }
        for (const [w, c] of [[Math.max(1, 6 * (1 - k)), f.color], [Math.max(1, 2 * (1 - k)), '#ffffff']] as const) {
          x.lineWidth = w;
          x.strokeStyle = c;
          x.beginPath();
          pts.forEach(([px, py], j) => (j ? x.lineTo(px, py) : x.moveTo(px, py)));
          x.stroke();
        }
      } else if (f.kind === 'pillar') {
        const w = f.r * (0.6 + 0.6 * Math.sin(k * Math.PI));
        const top = f.y - (f.y + 10) * ease.out(Math.min(1, k * 2.5));
        const g = x.createLinearGradient(f.x - w / 2, 0, f.x + w / 2, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.5, f.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.fillRect(f.x - w / 2, top, w, f.y - top);
        x.globalAlpha = (1 - k) * 0.9;
        x.fillStyle = '#ffffff';
        x.fillRect(f.x - w * 0.08, top, w * 0.16, f.y - top);
      } else if (f.kind === 'nova') {
        const R = f.r * (0.25 + e * 0.95);
        const g = x.createRadialGradient(f.x, f.y, 0, f.x, f.y, R);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.25, f.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.fillRect(f.x - R, f.y - R, R * 2, R * 2);
        // Rays.
        const n = 18;
        x.beginPath();
        for (let j = 0; j < n; j++) {
          const a = f.ang + (j / n) * Math.PI * 2 + k * 0.6;
          const len = R * (j % 2 ? 1.15 : 0.8);
          const half = (Math.PI / n) * 0.35;
          x.moveTo(f.x, f.y);
          x.lineTo(f.x + Math.cos(a - half) * len, f.y + Math.sin(a - half) * len);
          x.lineTo(f.x + Math.cos(a + half) * len, f.y + Math.sin(a + half) * len);
          x.closePath();
        }
        x.fillStyle = f.color;
        x.fill();
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
      x.setTransform(S, 0, 0, S, 0, 0);
      x.globalAlpha = this.flash;
      x.fillStyle = this.flashColor;
      x.fillRect(0, 0, W, H);
      x.globalAlpha = 1;
      if (this.flash === 0) this.flashColor = '#ffffff';
    }
  }

  private drawActor(a: Actor, t: number, real: number) {
    if (a.gone >= 1) return;
    const x = this.ctx;
    // Idle breathes between two frames (flyers flap faster).
    const idleFrame = Math.floor(t / (a.hover ? 0.16 : 0.55)) % 2 ? 'idle1' : 'idle';
    const p = a.pics[a.pose === 'idle' ? idleFrame : a.pose] ?? a.pics.idle;
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
    x.scale((a.f.side === 'party' ? -1 : 1) / Math.sqrt(sq), sq); // (your art faces left: flipped to face the monsters)
    const top = -h * a.feet;
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(p.img, -w / 2, top, w, h);
    if (a.flashT > 0) {
      a.flashT -= real;
      x.globalAlpha = 0.85;
      x.drawImage(p.white, -w / 2, top, w, h);
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

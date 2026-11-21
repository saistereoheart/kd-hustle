// 🗝️ Labirin Purba: a room drawn as a moody cave, in code. Blue-grey flagstones, a winding cobbled
// path with edge stones between the doors, rock cliffs (raised, so they hide whoever stands behind
// them), torches with warm glow, frost and pebbles, a dark vignette, and rock roofs over the
// doorways (and some overhangs) that turn see-through when you walk under them.
//
// Also: 🌿 bushes you wade through and cobwebs, wall lamps, signs, skeletons, cold campfires, a
// working campfire (rest chambers and the entrance hall), and the entrance hall's tavern counter,
// benches and the merchant's stall.
//
// Cheap on purpose: everything still is drawn ONCE per room into a few pictures (the floor, one strip
// per row for depth, one per roof), so a frame costs the same as a plain room. Only the lights move,
// a few tweens each: a pool of light on the floor, a halo round the flame, the flame itself.
import Phaser from 'phaser';
import type { LabDir, RoomLayout } from '@kh/shared';
import { AVATAR_DEPTH } from './avatar';

export interface RoomArtOpts {
  T: number;
  seed: number;
  /** Floor colours from the config (tinted towards a cold, moody blue here). */
  wall: string;
  floor: string;
  /** Picture sharpness (texels per world px). */
  res: number;
  /** Doors that are locked (barred gates). */
  locked: Partial<Record<LabDir, boolean>>;
  /** At most this many lights (fewer on Low memory). */
  torches: number;
  /** 🔥 A working campfire here (rest chambers: the feature spot). */
  fire?: [number, number];
  /** 🛒 The merchant stands here (his stall goes beside him; he holds a staff with a glowing orb). */
  merchant?: [number, number];
}

export interface RoomArt {
  objs: Phaser.GameObjects.GameObject[];
  /** Fade the roofs you're under (call every frame with your position, px). */
  update(x: number, y: number, dtMs: number): void;
  destroy(): void;
}

/** Above every avatar (and the rock), below labels. */
export const ROOF_DEPTH = AVATAR_DEPTH + 420_000;
export const LABEL_DEPTH = AVATAR_DEPTH + 440_000;

const hex = (s: string) => parseInt(s.slice(1), 16);
function mix(a: number, b: number, k: number) {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
function shade(c: number, k: number) {
  const ch = (s: number) => Math.min(255, Math.max(0, Math.round(((c >> s) & 255) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Soft round textures (made once per game): the torch glow, the flame, the vignette. */
function ensureTextures(scene: Phaser.Scene) {
  const tm = scene.textures;
  if (!tm.exists('lab_glow')) {
    const c = tm.createCanvas('lab_glow', 128, 128)!;
    const x = c.context;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    c.refresh();
  }
  if (!tm.exists('lab_flame')) {
    const c = tm.createCanvas('lab_flame', 32, 48)!;
    const x = c.context;
    const g = x.createRadialGradient(16, 34, 2, 16, 30, 20);
    g.addColorStop(0, '#fff9db');
    g.addColorStop(0.35, '#ffd43b');
    g.addColorStop(0.7, '#fd7e14');
    g.addColorStop(1, 'rgba(232,89,12,0)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(16, 2);
    x.bezierCurveTo(26, 18, 30, 30, 16, 46);
    x.bezierCurveTo(2, 30, 6, 18, 16, 2);
    x.fill();
    c.refresh();
  }
  if (!tm.exists('lab_vignette')) {
    const c = tm.createCanvas('lab_vignette', 256, 256)!;
    const x = c.context;
    const g = x.createRadialGradient(128, 128, 60, 128, 128, 182);
    g.addColorStop(0, 'rgba(4,6,14,0)');
    g.addColorStop(0.55, 'rgba(4,6,14,0.32)');
    g.addColorStop(1, 'rgba(4,6,14,0.92)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
    c.refresh();
  }
}

export function buildRoomArt(scene: Phaser.Scene, L: RoomLayout, o: RoomArtOpts): RoomArt {
  ensureTextures(scene);
  const { T } = o;
  const W = L.w * T, H = L.h * T;
  const mx = Math.floor(L.w / 2), my = Math.floor(L.h / 2);
  let seed = (o.seed % 2147483646) + 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const objs: Phaser.GameObjects.GameObject[] = [];
  const res = Math.max(1, Math.min(3, o.res));

  // Moody palette: the floor's own colour, pulled towards cold night blue.
  const night = 0x2b3452;
  const floorC = shade(mix(hex(o.floor), night, 0.55), 0.62);
  const rockTop = mix(hex(o.wall), 0x8c99bd, 0.55);
  const rockFace = shade(mix(hex(o.wall), 0x161b2c, 0.6), 0.75);
  const frost = 0xc5d6f2;
  const pathC = mix(floorC, 0xb9c3d9, 0.3);

  // ---- which tiles are rock: the room's own rock + the outer walls (minus the doorways)
  const isDoorGap = (x: number, y: number) =>
    (!!L.doorAt.n && y === 0 && Math.abs(x - mx) <= 1) ||
    (!!L.doorAt.s && y === L.h - 1 && Math.abs(x - mx) <= 1) ||
    (!!L.doorAt.w && x === 0 && Math.abs(y - my) <= 1) ||
    (!!L.doorAt.e && x === L.w - 1 && Math.abs(y - my) <= 1);
  // The entrance hall's furniture is solid too, but it isn't rock.
  const furniture = new Set<number>(L.hall ? [...L.hall.counter, L.hall.fire, ...L.hall.benches].map(([x, y]) => y * L.w + x) : []);
  const rock = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return true;
    if (furniture.has(y * L.w + x)) return false;
    if (x === 0 || y === 0 || x === L.w - 1 || y === L.h - 1) return !isDoorGap(x, y);
    return L.solid.has(y * L.w + x);
  };

  /** A wobbly blob (points around an ellipse). */
  const blob = (g: Phaser.GameObjects.Graphics, cx: number, cy: number, rx: number, ry: number, n = 8, j = 0.22) => {
    const pts: Phaser.Math.Vector2[] = [];
    const a0 = rnd() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const k = 1 - j / 2 + rnd() * j;
      pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k));
    }
    g.fillPoints(pts, true);
  };

  // ------------------------------------------------------------------ props (drawn in code)
  const wood = 0x6b4a2b, woodDark = 0x3d2a17, woodLight = 0x9a7048;
  /** 🌿 A bush: overlapping leaf clumps, dark underneath, a few lit leaves and berries on top. */
  const drawBush = (g: Phaser.GameObjects.Graphics, cx: number, by: number) => {
    const leaf = mix(0x2f6b3a, night, 0.25);
    g.fillStyle(0x000000, 0.3).fillEllipse(cx, by + 2, T * 0.95, T * 0.25);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI;
      g.fillStyle(shade(leaf, 0.7 + rnd() * 0.25), 1);
      blob(g, cx + Math.cos(a) * T * 0.3, by - T * 0.22 - Math.sin(a) * T * 0.25, T * 0.24, T * 0.2, 7, 0.35);
    }
    for (let k = 0; k < 5; k++) {
      g.fillStyle(shade(leaf, 1.05 + rnd() * 0.3), 1);
      blob(g, cx + (rnd() - 0.5) * T * 0.6, by - T * 0.35 - rnd() * T * 0.25, T * 0.14, T * 0.1, 6, 0.3);
    }
    if (rnd() < 0.5) for (let k = 0; k < 3; k++) g.fillStyle(0xc92a2a, 1).fillCircle(cx + (rnd() - 0.5) * T * 0.5, by - T * 0.3 - rnd() * T * 0.2, 2);
  };
  /** 🏮 A wall lamp: an iron post, a bracket and a lantern cage (the flame and its light are added live). */
  const drawLampPost = (g: Phaser.GameObjects.Graphics, cx: number, cy: number) => {
    const top = cy - T * 0.95;
    g.fillStyle(0x000000, 0.35).fillEllipse(cx, cy + T * 0.3, T * 0.5, T * 0.14);
    g.fillStyle(0x2b2b30, 1).fillRect(cx - 3, top, 6, T * 1.25);
    g.fillStyle(0x4a4a55, 1).fillRect(cx - 1, top, 2, T * 1.25);
    g.fillStyle(0x2b2b30, 1).fillRect(cx - T * 0.14, cy + T * 0.22, T * 0.28, 5);
    g.lineStyle(2, 0x2b2b30, 1).strokeRect(cx - T * 0.13, top - T * 0.2, T * 0.26, T * 0.3);
    g.fillStyle(0xffc078, 0.35).fillRect(cx - T * 0.12, top - T * 0.19, T * 0.24, T * 0.28);
    g.fillStyle(0x2b2b30, 1).fillTriangle(cx - T * 0.17, top - T * 0.2, cx + T * 0.17, top - T * 0.2, cx, top - T * 0.36);
  };
  /** 🪧 An old wooden sign: a post and a board with scratched writing. */
  const drawSign = (g: Phaser.GameObjects.Graphics, cx: number, cy: number) => {
    g.fillStyle(0x000000, 0.35).fillEllipse(cx, cy + T * 0.3, T * 0.6, T * 0.15);
    g.fillStyle(woodDark, 1).fillRect(cx - 3, cy - T * 0.55, 6, T * 0.85);
    g.fillStyle(wood, 1).fillRoundedRect(cx - T * 0.38, cy - T * 0.85, T * 0.76, T * 0.42, 4);
    g.fillStyle(woodLight, 1).fillRect(cx - T * 0.36, cy - T * 0.83, T * 0.72, 3);
    g.lineStyle(1.5, woodDark, 1);
    for (let k = 0; k < 3; k++) g.lineBetween(cx - T * 0.28, cy - T * 0.74 + k * 7, cx + T * (0.1 + rnd() * 0.18), cy - T * 0.74 + k * 7);
    g.fillStyle(0xc92a2a, 0.9).fillCircle(cx + T * 0.26, cy - T * 0.72, 2.5);
  };
  /** 💀 Bones of someone who didn't make it: a skull, ribs, a long bone. */
  function drawSkeleton(g: Phaser.GameObjects.Graphics, cx: number, cy: number) {
    const bone = 0xd8d2c0;
    g.fillStyle(0x000000, 0.3).fillEllipse(cx, cy + 4, T * 0.8, T * 0.3);
    g.fillStyle(bone, 1).fillCircle(cx - T * 0.25, cy - 2, T * 0.13);
    g.fillStyle(0x1a1a1a, 1).fillCircle(cx - T * 0.29, cy - 3, 2.5).fillCircle(cx - T * 0.2, cy - 3, 2.5);
    g.lineStyle(2.5, bone, 1);
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.arc(cx + T * 0.05, cy + k * 4 - 6, T * 0.13, Math.PI * 0.15, Math.PI * 0.85);
      g.strokePath();
    }
    g.lineBetween(cx + T * 0.05, cy - 8, cx + T * 0.05, cy + 10);
    g.lineBetween(cx + T * 0.15, cy + 8, cx + T * 0.4, cy + 2);
    g.fillStyle(bone, 1).fillCircle(cx + T * 0.4, cy + 2, 3).fillCircle(cx + T * 0.15, cy + 8, 3);
  }
  /** 🔥 A fire pit: a ring of stones, crossed logs; a working one has bright coals (its flames are live). */
  function drawFirePit(g: Phaser.GameObjects.Graphics, cx: number, cy: number, lit: boolean) {
    g.fillStyle(lit ? 0x3a2a1a : 0x2a2a2e, 1).fillEllipse(cx, cy, T * 0.8, T * 0.42);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      g.fillStyle(shade(0x7a7f8c, 0.8 + rnd() * 0.4), 1);
      blob(g, cx + Math.cos(a) * T * 0.42, cy + Math.sin(a) * T * 0.22, T * 0.1, T * 0.075, 6, 0.3);
    }
    g.fillStyle(lit ? 0x5c3a1e : 0x1f1a16, 1);
    g.fillRoundedRect(cx - T * 0.3, cy - 4, T * 0.6, 7, 3);
    g.fillRoundedRect(cx - 4, cy - T * 0.18, 7, T * 0.36, 3);
    if (lit) {
      g.fillStyle(0xff6b00, 0.9).fillEllipse(cx, cy, T * 0.36, T * 0.16);
      g.fillStyle(0xffd43b, 0.9).fillEllipse(cx, cy, T * 0.18, T * 0.08);
    } else for (let k = 0; k < 6; k++) g.fillStyle(0x9a9a9a, 0.5).fillCircle(cx + (rnd() - 0.5) * T * 0.4, cy + (rnd() - 0.5) * T * 0.2, 2);
  }
  /** 🍵 The tavern counter: planks, a darker front, mugs and a teapot on top. */
  const drawCounter = (g: Phaser.GameObjects.Graphics, x0: number, y0: number, w: number) => {
    g.fillStyle(0x000000, 0.35).fillRect(x0, y0 + T * 0.95, w, T * 0.12);
    g.fillStyle(woodDark, 1).fillRect(x0, y0 + T * 0.3, w, T * 0.65);
    for (let x = x0 + 6; x < x0 + w; x += 14) g.fillStyle(wood, 1).fillRect(x, y0 + T * 0.34, 10, T * 0.58);
    g.fillStyle(woodLight, 1).fillRoundedRect(x0 - 4, y0 + T * 0.05, w + 8, T * 0.3, 4);
    g.fillStyle(shade(woodLight, 1.2), 1).fillRect(x0 - 2, y0 + T * 0.07, w + 4, 3);
    for (let k = 0; k < 4; k++) {
      const mxk = x0 + T * 0.4 + k * (w - T * 0.8) / 3;
      g.fillStyle(k % 2 ? 0xe9ecef : 0xc9a227, 1).fillRoundedRect(mxk - 5, y0 - 4, 10, 12, 2);
      g.fillStyle(0x6b3f1d, 1).fillRect(mxk - 4, y0 - 3, 8, 3);
    }
  };
  /** The shelf behind the counter: bottles and jars catching the light. */
  const drawShelf = (g: Phaser.GameObjects.Graphics, x0: number, y0: number, w: number) => {
    g.fillStyle(woodDark, 1).fillRect(x0, y0 + T * 0.5, w, 6);
    g.fillStyle(woodDark, 1).fillRect(x0, y0 + T * 0.05, w, 6);
    const cols = [0x2b8a3e, 0xc92a2a, 0xf59f00, 0x1971c2, 0x862e9c, 0xe8590c];
    for (let k = 0; k < 9; k++) {
      const bx = x0 + 8 + k * (w - 16) / 8, row = k % 2;
      g.fillStyle(cols[k % cols.length], 0.9).fillRoundedRect(bx - 4, y0 + T * (row ? 0.22 : 0.0) - 12 + T * 0.05 + (row ? T * 0.45 - T * 0.22 : 0), 8, 14, 3);
      g.fillStyle(0xffffff, 0.5).fillRect(bx - 2, y0 + T * (row ? 0.45 : 0.05) - 10, 2, 6);
    }
  };
  /** A wooden bench. */
  const drawBench = (g: Phaser.GameObjects.Graphics, x0: number, y0: number, w: number) => {
    g.fillStyle(0x000000, 0.3).fillEllipse(x0 + w / 2, y0 + T * 0.85, w, T * 0.22);
    g.fillStyle(woodDark, 1).fillRect(x0 + 8, y0 + T * 0.5, 6, T * 0.35).fillRect(x0 + w - 14, y0 + T * 0.5, 6, T * 0.35);
    g.fillStyle(wood, 1).fillRoundedRect(x0 + 2, y0 + T * 0.35, w - 4, T * 0.2, 3);
    g.fillStyle(woodLight, 1).fillRect(x0 + 4, y0 + T * 0.36, w - 8, 3);
  };
  /** 🛒 The merchant's stall: a table with a striped cloth, potion bottles, a scroll. */
  const drawStall = (g: Phaser.GameObjects.Graphics, x0: number, y0: number) => {
    const w = T * 1.5;
    g.fillStyle(0x000000, 0.3).fillEllipse(x0 + w / 2, y0 + T * 0.6, w * 1.05, T * 0.2);
    g.fillStyle(woodDark, 1).fillRect(x0 + 4, y0 + T * 0.1, 5, T * 0.5).fillRect(x0 + w - 9, y0 + T * 0.1, 5, T * 0.5);
    g.fillStyle(0x862e2e, 1).fillRect(x0, y0 - T * 0.12, w, T * 0.42);
    for (let x = x0 + 4; x < x0 + w; x += 12) g.fillStyle(0xc9a227, 1).fillRect(x, y0 - T * 0.12, 5, T * 0.42);
    g.fillStyle(woodLight, 1).fillRect(x0 - 2, y0 - T * 0.2, w + 4, 6);
    const cols = [0x40c057, 0xfa5252, 0x4dabf7, 0xfcc419];
    for (let k = 0; k < 4; k++) {
      const bx = x0 + 10 + k * (w - 24) / 3;
      g.fillStyle(cols[k], 0.95).fillCircle(bx, y0 - T * 0.28, 5);
      g.fillStyle(0xe9ecef, 1).fillRect(bx - 2, y0 - T * 0.28 - 9, 4, 5);
      g.fillStyle(0xffffff, 0.6).fillCircle(bx - 2, y0 - T * 0.3, 1.5);
    }
    g.fillStyle(0xf1e3c6, 1).fillRoundedRect(x0 + w - 18, y0 - T * 0.27, 14, 6, 3);
  };

  /** Draw with `paint` (world px) into a picture covering [x0, y0, w, h], at `depth`. */
  const bake = (x0: number, y0: number, w: number, h: number, depth: number, paint: (g: Phaser.GameObjects.Graphics) => void) => {
    const g = scene.make.graphics({}, false);
    paint(g);
    g.setScale(res);
    const rt = scene.add.renderTexture(x0, y0, Math.ceil(w * res), Math.ceil(h * res)).setOrigin(0, 0);
    rt.draw(g, -x0 * res, -y0 * res);
    g.destroy();
    rt.setScale(1 / res).setDepth(depth);
    objs.push(rt);
    return rt;
  };

  // ------------------------------------------------------------------ the floor
  bake(0, 0, W, H, -10, (g) => {
    g.fillStyle(0x05060b, 1).fillRect(0, 0, W, H);
    // Mortar, then irregular flagstones in staggered rows (no grid: sizes and shapes vary).
    g.fillStyle(shade(floorC, 0.5), 1).fillRect(T * 0.5, T * 0.5, W - T, H - T);
    const rowH = T * 0.58;
    for (let ry = T * 0.5, row = 0; ry < H - T * 0.4; ry += rowH, row++) {
      let rx = T * 0.5 - (row % 2 ? rnd() * T * 0.5 : 0);
      while (rx < W - T * 0.4) {
        const sw = T * (0.45 + rnd() * 0.6);
        const cxs = rx + sw / 2, cys = ry + rowH / 2 + (rnd() - 0.5) * 4;
        const tx = Math.floor(cxs / T), ty = Math.floor(cys / T);
        if (!rock(tx, ty)) {
          g.fillStyle(shade(floorC, 0.8 + rnd() * 0.4), 1);
          blob(g, cxs, cys, sw / 2 - 2, rowH / 2 - 2, 8, 0.12);
          if (rnd() < 0.35) (g.fillStyle(shade(floorC, 1.15), 0.5), blob(g, cxs - sw * 0.12, cys - rowH * 0.12, sw * 0.22, rowH * 0.16, 6, 0.3));
          if (rnd() < 0.15) g.lineStyle(1, shade(floorC, 0.5), 0.9).lineBetween(cxs - sw * 0.2, cys - rowH * 0.25, cxs + sw * 0.1, cys + rowH * 0.3);
        }
        rx += sw;
      }
    }
    // Frost and damp patches.
    for (let i = 0; i < 9; i++) {
      g.fillStyle(rnd() < 0.6 ? frost : 0x3d5a4a, 0.07 + rnd() * 0.06);
      blob(g, T + rnd() * (W - 2 * T), T + rnd() * (H - 2 * T), T * (0.8 + rnd() * 1.4), T * (0.5 + rnd()), 9, 0.35);
    }
    // The winding cobbled path: from each door to the middle, with edge stones like an old road.
    const arms: Array<[number, number]> = [];
    if (L.doorAt.n) arms.push([mx + 0.5, 0]);
    if (L.doorAt.s) arms.push([mx + 0.5, L.h]);
    if (L.doorAt.w) arms.push([0, my + 0.5]);
    if (L.doorAt.e) arms.push([L.w, my + 0.5]);
    const cx = (mx + 0.5) * T, cy = (my + 0.5) * T;
    const pathPoints: Array<[number, number, number, number]> = []; // x, y, nx, ny (normal)
    for (const [ax, ay] of arms) {
      const ex = ax * T, ey = ay * T;
      const len = Math.hypot(ex - cx, ey - cy);
      const ux = (ex - cx) / len, uy = (ey - cy) / len;
      const nx = -uy, ny = ux;
      const phase = rnd() * Math.PI * 2;
      for (let d = 0; d <= len; d += T * 0.22) {
        const wob = Math.sin((d / T) * 1.4 + phase) * T * 0.42 * Math.min(1, d / (T * 1.5)) * Math.min(1, (len - d) / (T * 1.2));
        pathPoints.push([cx + ux * d + nx * wob, cy + uy * d + ny * wob, nx, ny]);
      }
    }
    // Path bed, cobbles, then edge stones.
    for (const [px, py] of pathPoints) g.fillStyle(shade(pathC, 0.7), 1).fillCircle(px, py, T * 0.62);
    g.fillStyle(shade(pathC, 0.7), 1).fillCircle(cx, cy, T * 1.35);
    for (const [px, py, nx, ny] of pathPoints)
      for (const off of [-0.36, 0, 0.36]) {
        g.fillStyle(shade(pathC, 0.85 + rnd() * 0.35), 1);
        blob(g, px + nx * off * T + (rnd() - 0.5) * 5, py + ny * off * T + (rnd() - 0.5) * 5, T * 0.15, T * 0.12, 6, 0.3);
      }
    for (let a = 0; a < Math.PI * 2; a += 0.33)
      for (const r of [0.35, 0.75, 1.1]) {
        g.fillStyle(shade(pathC, 0.85 + rnd() * 0.35), 1);
        blob(g, cx + Math.cos(a + r) * r * T, cy + Math.sin(a + r) * r * T, T * 0.15, T * 0.12, 6, 0.3);
      }
    let k = 0;
    for (const [px, py, nx, ny] of pathPoints) {
      if (k++ % 2) continue;
      for (const side of [-1, 1]) {
        const sx = px + nx * side * T * 0.66, sy = py + ny * side * T * 0.66;
        if (Math.hypot(sx - cx, sy - cy) < T * 1.4) continue;
        g.fillStyle(0x000000, 0.35).fillCircle(sx + 1, sy + 2, T * 0.1);
        g.fillStyle(shade(pathC, 0.75 + rnd() * 0.2), 1);
        blob(g, sx, sy, T * 0.1, T * 0.085, 6, 0.25);
        g.fillStyle(frost, 0.35).fillCircle(sx - 1.5, sy - 1.5, T * 0.035);
      }
    }
    // 🕸️ Cobwebs: spokes and sagging rings of thread (you walk through them).
    for (const [i, kind] of L.brush) {
      if (kind !== 'web') continue;
      const cx = (i % L.w + 0.5) * T, cy = (Math.floor(i / L.w) + 0.5) * T;
      const spokes = 7, r = T * 0.62;
      g.lineStyle(1, 0xe7ecf7, 0.4);
      for (let k = 0; k < spokes; k++) {
        const a = (k / spokes) * Math.PI * 2 + rnd() * 0.3;
        g.lineBetween(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      for (const rr of [0.25, 0.45, 0.65, 0.85]) {
        g.lineStyle(1, 0xe7ecf7, 0.28);
        g.beginPath();
        for (let k = 0; k <= spokes; k++) {
          const a = (k / spokes) * Math.PI * 2;
          const sag = 0.88 + (k % 2) * 0.12;
          const px = cx + Math.cos(a) * r * rr * sag, py = cy + Math.sin(a) * r * rr * sag;
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.strokePath();
      }
      g.fillStyle(0xe7ecf7, 0.06).fillCircle(cx, cy, r);
    }
    // Lying flat: skeletons, old campfires (ash and charred logs).
    for (const pr of L.props) {
      const px = (pr.at[0] + 0.5) * T, py = (pr.at[1] + 0.5) * T;
      if (pr.kind === 'skeleton') drawSkeleton(g, px, py);
      if (pr.kind === 'oldfire') drawFirePit(g, px, py, false);
    }
    if (o.fire) drawFirePit(g, (o.fire[0] + 0.5) * T, (o.fire[1] + 0.6) * T, true);
    if (L.hall) drawFirePit(g, (L.hall.fire[0] + 0.5) * T, (L.hall.fire[1] + 0.5) * T, true);
    // Pebbles.
    for (let i = 0; i < 26; i++) {
      const px = T + rnd() * (W - 2 * T), py = T + rnd() * (H - 2 * T);
      if (rock(Math.floor(px / T), Math.floor(py / T))) continue;
      g.fillStyle(shade(floorC, 0.6 + rnd() * 0.5), 1).fillCircle(px, py, 1.5 + rnd() * 2.5);
    }
    // Shade on the floor at the foot of rock (it stands up, so it casts a soft shadow).
    for (let y = 1; y < L.h; y++)
      for (let x = 0; x < L.w; x++) {
        if (rock(x, y)) continue;
        if (rock(x, y - 1)) (g.fillStyle(0x000000, 0.3).fillRect(x * T, y * T, T, T * 0.3), g.fillStyle(0x000000, 0.15).fillRect(x * T, y * T + T * 0.3, T, T * 0.2));
        if (rock(x - 1, y)) g.fillStyle(0x000000, 0.22).fillRect(x * T, y * T, T * 0.2, T);
        if (rock(x + 1, y)) g.fillStyle(0x000000, 0.22).fillRect(x * T + T * 0.8, y * T, T * 0.2, T);
      }
    // Doorways: a dark way through, with stone steps going out of the room.
    for (const d of Object.keys(L.doorAt) as LabDir[]) {
      const horiz = d === 'n' || d === 's';
      const x0 = horiz ? (mx - 0.7) * T : d === 'w' ? 0 : W - T;
      const y0 = horiz ? (d === 'n' ? 0 : H - T) : (my - 0.7) * T;
      const w = horiz ? T * 2.4 : T, h = horiz ? T : T * 2.4;
      g.fillStyle(0x020306, 1).fillRect(x0, y0, w, h);
      for (let s = 0; s < 3; s++) {
        const k2 = 0.95 - s * 0.25;
        g.fillStyle(shade(pathC, k2 * 0.7), 1);
        if (d === 'n') g.fillRect(x0 + 4, y0 + T - (s + 1) * T * 0.28, w - 8, T * 0.22);
        else if (d === 's') g.fillRect(x0 + 4, y0 + s * T * 0.28 + 2, w - 8, T * 0.22);
        else if (d === 'w') g.fillRect(x0 + T - (s + 1) * T * 0.28, y0 + 4, T * 0.22, h - 8);
        else g.fillRect(x0 + s * T * 0.28 + 2, y0 + 4, T * 0.22, h - 8);
      }
    }
  });

  // ------------------------------------------------------------------ rock (raised; one picture per row, for depth)
  const lift = T * 0.55;
  const drawRockTile = (g: Phaser.GameObjects.Graphics, x: number, y: number) => {
    const px = x * T, py = y * T;
    const below = rock(x, y + 1);
    // The face (the cliff side you see), unless more rock is in front of it.
    if (!below) {
      g.fillStyle(rockFace, 1);
      blob(g, px + T / 2, py + T * 0.66, T * 0.6, T * 0.36, 10, 0.12);
      g.fillRect(px - 2, py + T * 0.4, T + 4, T * 0.5);
      for (let i = 0; i < 5; i++) g.fillStyle(shade(rockFace, 1.2 + rnd() * 0.35), 1).fillRect(px + 3 + rnd() * (T - 8), py + T * 0.46, 2 + rnd() * 3, T * (0.2 + rnd() * 0.3));
      g.fillStyle(0x000000, 0.35).fillRect(px - 1, py + T * 0.9, T + 2, T * 0.1);
    }
    // The top: lumpy slabs that run into their neighbours (so outcrops read as one mass of rock).
    const topY = py + T / 2 - lift + T * 0.42;
    g.fillStyle(0x070a12, 0.75);
    blob(g, px + T / 2, topY + 6, T * 0.74, T * 0.64, 10, 0.2);
    g.fillStyle(shade(rockTop, 0.78), 1);
    blob(g, px + T / 2, topY + 3, T * 0.72, T * 0.62, 10, 0.2);
    for (let i = 0; i < 3; i++) {
      g.fillStyle(shade(rockTop, 0.9 + rnd() * 0.25), 1);
      blob(g, px + T * (0.2 + rnd() * 0.6), topY + (rnd() - 0.6) * T * 0.4, T * (0.3 + rnd() * 0.2), T * (0.22 + rnd() * 0.15), 7, 0.35);
    }
    // A cap of frost on some of them, and a crack.
    if (rnd() < 0.45) (g.fillStyle(frost, 0.3), blob(g, px + T * (0.3 + rnd() * 0.4), topY - T * 0.12, T * 0.26, T * 0.14, 7, 0.35));
    if (rnd() < 0.5) g.lineStyle(1.5, shade(rockTop, 0.55), 0.9).lineBetween(px + 8 + rnd() * 10, py - lift + T * 0.5, px + 18 + rnd() * 16, py - lift + T * 0.85);
  };
  // Things that stand up, by the row they stand in (drawn with that row's rock, for depth).
  const standing = new Map<number, Array<(g: Phaser.GameObjects.Graphics) => void>>();
  const stand = (row: number, fn: (g: Phaser.GameObjects.Graphics) => void) => (standing.get(row) ?? standing.set(row, []).get(row)!).push(fn);
  for (const [i, kind] of L.brush) if (kind === 'bush') stand(Math.floor(i / L.w), (g) => drawBush(g, (i % L.w + 0.5) * T, (Math.floor(i / L.w) + 0.85) * T));
  for (const pr of L.props) {
    const px = (pr.at[0] + 0.5) * T, py = (pr.at[1] + 0.5) * T;
    if (pr.kind === 'lamp') stand(pr.at[1], (g) => drawLampPost(g, px, py));
    if (pr.kind === 'sign') stand(pr.at[1], (g) => drawSign(g, px, py));
  }
  if (L.hall) {
    const h = L.hall;
    stand(h.counter[0][1], (g) => drawCounter(g, h.counter[0][0] * T, h.counter[0][1] * T, h.counter.length * T));
    stand(h.keeper[1] - 1, (g) => drawShelf(g, (h.counter[0][0] + 0.1) * T, h.keeper[1] * T - T * 0.55, (h.counter.length - 0.2) * T));
    stand(h.benches[0][1], (g) => drawBench(g, h.benches[0][0] * T, h.benches[0][1] * T, h.benches.length * T));
  }
  if (o.merchant) stand(o.merchant[1], (g) => drawStall(g, (o.merchant![0] + 1.05) * T, (o.merchant![1] + 0.3) * T));
  for (let y = 0; y < L.h; y++) {
    let any = false;
    for (let x = 0; x < L.w; x++) if (rock(x, y)) any = true;
    const doorPosts = (y === 0 && L.doorAt.n) || (y === L.h - 1 && L.doorAt.s) || (y === my && (L.doorAt.w || L.doorAt.e));
    if (!any && !doorPosts && !standing.has(y)) continue;
    // Its bottom edge sets the depth: whoever stands north of it is hidden behind it.
    bake(0, y * T - lift - 4 - T * 0.6, W, T + lift + 4 + T * 0.6, AVATAR_DEPTH + (y + 1) * T - 2, (g) => {
      for (let x = 0; x < L.w; x++) if (rock(x, y)) drawRockTile(g, x, y);
      for (const fn of standing.get(y) ?? []) fn(g);
      // Door frames: two stone posts and a lintel shadow; bars if it's locked.
      const post = (px: number, py: number, w: number, h: number) => {
        g.fillStyle(shade(rockFace, 1.25), 1).fillRect(px, py, w, h);
        g.fillStyle(shade(rockTop, 1.15), 1).fillRect(px - 2, py - 6, w + 4, 8);
      };
      const bars = (x0: number, y0: number, w: number, h: number, vertical: boolean) => {
        g.fillStyle(0x6b4f2a, 1);
        for (let i = 0; i < 5; i++) {
          if (vertical) g.fillRect(x0 + 6 + (i * (w - 12)) / 4 - 2, y0, 5, h);
          else g.fillRect(x0, y0 + 6 + (i * (h - 12)) / 4 - 2, w, 5);
        }
        g.fillStyle(0x3b2a14, 1);
        if (vertical) g.fillRect(x0, y0 + h * 0.4, w, 5);
        else g.fillRect(x0 + w * 0.4, y0, 5, h);
      };
      if (y === 0 && L.doorAt.n) {
        post((mx - 0.85) * T, -lift * 0.6, T * 0.3, T * 0.9 + lift * 0.6);
        post((mx + 1.55) * T, -lift * 0.6, T * 0.3, T * 0.9 + lift * 0.6);
        if (o.locked.n) bars((mx - 0.55) * T, 0, T * 2.1, T * 0.95, true);
      }
      if (y === L.h - 1 && L.doorAt.s) {
        post((mx - 0.85) * T, y * T - lift * 0.4, T * 0.3, T * 0.6);
        post((mx + 1.55) * T, y * T - lift * 0.4, T * 0.3, T * 0.6);
        if (o.locked.s) bars((mx - 0.55) * T, y * T, T * 2.1, T * 0.6, true);
      }
      if (y === my && L.doorAt.w) {
        post(T * 0.15, (my - 1.1) * T, T * 0.7, T * 0.35);
        if (o.locked.w) bars(T * 0.1, (my - 0.6) * T, T * 0.8, T * 2.2, false);
      }
      if (y === my && L.doorAt.e) {
        post(W - T * 0.85, (my - 1.1) * T, T * 0.7, T * 0.35);
        if (o.locked.e) bars(W - T * 0.9, (my - 0.6) * T, T * 0.8, T * 2.2, false);
      }
    });
  }

  // ------------------------------------------------------------------ lights
  // Each light: a pool on the floor (squashed: it lies flat, like real light on the ground), a halo
  // round the flame, and the flame. They breathe a little out of step, so it flickers like fire.
  const light = (fx: number, fy: number, floorY: number, size: number, tint: number, flame: number) => {
    const pool = scene.add.image(fx, floorY, 'lab_glow').setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.45).setDepth(-5);
    pool.setScale((T * size) / 128, (T * size * 0.62) / 128);
    const halo = scene.add.image(fx, fy - T * 0.12, 'lab_glow').setTint(0xffd8a8).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.55).setScale((T * 1.2 * flame) / 128).setDepth(AVATAR_DEPTH + floorY + 2);
    const fl = scene.add.image(fx, fy, 'lab_flame').setOrigin(0.5, 0.9).setScale((T / 70) * flame).setDepth(AVATAR_DEPTH + floorY + 1);
    objs.push(pool, halo, fl);
    const d = 220 + rnd() * 240;
    const sx = pool.scaleX, sy = pool.scaleY;
    scene.tweens.add({ targets: pool, alpha: { from: 0.36, to: 0.52 }, scaleX: { from: sx * 0.95, to: sx * 1.05 }, scaleY: { from: sy * 0.95, to: sy * 1.05 }, duration: d * 2.1, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    scene.tweens.add({ targets: halo, alpha: { from: 0.4, to: 0.7 }, duration: d * 0.8, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    scene.tweens.add({ targets: fl, scaleY: { from: (T / 70) * flame * 0.82, to: (T / 70) * flame * 1.15 }, scaleX: { from: (T / 70) * flame * 1.05, to: (T / 70) * flame * 0.92 }, duration: d, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  };
  const lights: Array<() => void> = [];
  // Campfires first (they matter most), then lamps, then the torches by the doors.
  const fires = [...(o.fire ? [o.fire] : []), ...(L.hall ? [L.hall.fire] : [])];
  for (const f of fires) lights.push(() => {
    light((f[0] + 0.5) * T, (f[1] + 0.55) * T, (f[1] + 0.6) * T, 6, 0xff7a1a, 1.8);
    light((f[0] + 0.3) * T, (f[1] + 0.6) * T, (f[1] + 0.6) * T, 0.1, 0xff7a1a, 1.2);
  });
  for (const pr of L.props) if (pr.kind === 'lamp') lights.push(() => light((pr.at[0] + 0.5) * T, (pr.at[1] + 0.5) * T - T * 0.95, (pr.at[1] + 0.5) * T, 4.6, 0xff9a3c, 0.9));
  if (L.doorAt.n) lights.push(() => light((mx - 0.7) * T, T * 0.55, T * 1.15, 4, 0xff8c32, 1));
  if (L.doorAt.n) lights.push(() => light((mx + 1.7) * T, T * 0.55, T * 1.15, 4, 0xff8c32, 1));
  for (const mk of lights.slice(0, o.torches + fires.length)) mk();
  // A cold campfire: a few embers still glow.
  for (const pr of L.props) {
    if (pr.kind !== 'oldfire') continue;
    const e = scene.add.image((pr.at[0] + 0.5) * T, (pr.at[1] + 0.5) * T, 'lab_glow').setTint(0xc92a2a).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.25).setScale((T * 1.2) / 128).setDepth(-4);
    objs.push(e);
    scene.tweens.add({ targets: e, alpha: { from: 0.12, to: 0.32 }, duration: 1300 + rnd() * 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
  // 🛒 The merchant's staff, topped with a bright glowing orb.
  if (o.merchant) {
    const sx = (o.merchant[0] + 0.5) * T + T * 0.42, sy = (o.merchant[1] + 0.7) * T;
    const staff = scene.add.graphics().setDepth(AVATAR_DEPTH + sy + 1);
    staff.fillStyle(0x4a2f1a, 1).fillRect(sx - 2, sy - T * 1.55, 4, T * 1.55);
    staff.fillStyle(0x8d6e3f, 1).fillRect(sx - 1, sy - T * 1.55, 1.5, T * 1.55);
    staff.fillStyle(0xc9a227, 1).fillRect(sx - 4, sy - T * 1.6, 8, 4);
    staff.lineStyle(2, 0xc9a227, 1).strokeCircle(sx, sy - T * 1.72, T * 0.15);
    const oy = sy - T * 1.72;
    const orb = scene.add.image(sx, oy, 'lab_glow').setTint(0x9ef0ff).setBlendMode(Phaser.BlendModes.ADD).setScale((T * 0.5) / 128).setDepth(AVATAR_DEPTH + sy + 2);
    const core = scene.add.circle(sx, oy, T * 0.1, 0xe3fafc).setDepth(AVATAR_DEPTH + sy + 3);
    const aura = scene.add.image(sx, oy, 'lab_glow').setTint(0x3bc9db).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5).setScale((T * 2.4) / 128).setDepth(AVATAR_DEPTH + sy + 2);
    const pool = scene.add.image(sx - T * 0.3, sy + T * 0.1, 'lab_glow').setTint(0x3bc9db).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.3).setScale((T * 4) / 128, (T * 2.4) / 128).setDepth(-5);
    objs.push(staff, orb, core, aura, pool);
    scene.tweens.add({ targets: [orb, core], y: oy - 3, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    scene.tweens.add({ targets: aura, alpha: { from: 0.35, to: 0.65 }, scale: { from: (T * 2.2) / 128, to: (T * 2.8) / 128 }, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    scene.tweens.add({ targets: pool, alpha: { from: 0.22, to: 0.36 }, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  // ------------------------------------------------------------------ roofs (see-through when you're under)
  const roofs: Array<{ x0: number; y0: number; x1: number; y1: number; img: Phaser.GameObjects.RenderTexture; a: number }> = [];
  for (const r of L.roofs) {
    const pad = T * 0.35;
    const x0 = r.x * T - pad, y0 = r.y * T - pad - lift;
    const w = r.w * T + 2 * pad, h = r.h * T + 2 * pad;
    const img = bake(x0, y0, w, h, ROOF_DEPTH, (g) => {
      // A rock ceiling: a thick lumpy slab, darker underneath, frost on the top edge, cracks.
      const cx = x0 + w / 2, cy = y0 + h / 2;
      g.fillStyle(0x000000, 0.35);
      blob(g, cx, cy + T * 0.35, w * 0.5, h * 0.5, 12, 0.12);
      g.fillStyle(rockFace, 1);
      blob(g, cx, cy + T * 0.18, w * 0.49, h * 0.48, 12, 0.12);
      g.fillStyle(rockTop, 1);
      blob(g, cx, cy, w * 0.47, h * 0.45, 12, 0.14);
      for (let i = 0; i < 5; i++) {
        g.fillStyle(shade(rockTop, 1.05 + rnd() * 0.15), 1);
        blob(g, x0 + pad + rnd() * (w - 2 * pad), y0 + pad + rnd() * (h - 2 * pad), T * 0.4, T * 0.3, 7, 0.3);
      }
      for (let i = 0; i < 3; i++) g.lineStyle(1.5, shade(rockTop, 0.65), 0.9).lineBetween(x0 + pad + rnd() * (w - 2 * pad), y0 + pad + rnd() * h * 0.5, x0 + pad + rnd() * (w - 2 * pad), y0 + h * 0.5 + rnd() * h * 0.4);
      g.fillStyle(frost, 0.45);
      blob(g, cx, y0 + pad + T * 0.1, w * 0.38, T * 0.14, 9, 0.3);
    });
    roofs.push({ x0: r.x * T - T * 0.25, y0: r.y * T - T * 0.6, x1: (r.x + r.w) * T + T * 0.25, y1: (r.y + r.h) * T + T * 0.2, img, a: 1 });
  }

  // ------------------------------------------------------------------ the dark edges
  const vig = scene.add.image(W / 2, H / 2, 'lab_vignette').setDisplaySize(W * 1.25, H * 1.35).setDepth(ROOF_DEPTH + 10);
  objs.push(vig);

  return {
    objs,
    update(x, y, dtMs) {
      const k = Math.min(1, dtMs / 120);
      for (const r of roofs) {
        const under = x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
        const want = under ? 0.22 : 1;
        if (Math.abs(r.a - want) < 0.01) continue;
        r.a += (want - r.a) * k;
        r.img.setAlpha(r.a);
      }
    },
    destroy() {
      for (const ob of objs) {
        scene.tweens.killTweensOf(ob);
        ob.destroy();
      }
      objs.length = 0;
    },
  };
}

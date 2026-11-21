// 🗝️ Labirin Purba: a room drawn as a moody cave, in code. Blue-grey flagstones, a winding cobbled
// path with edge stones between the doors, rock cliffs (raised, so they hide whoever stands behind
// them), torches with warm glow, frost and pebbles, a dark vignette, and rock roofs over the
// doorways (and some overhangs) that turn see-through when you walk under them.
//
// Cheap on purpose: everything still is drawn ONCE per room into a few pictures (the floor, one strip
// per row of rock for depth, one per roof), so a frame costs the same as a plain room. Only the
// torch glows move (a few tweens).
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
  /** At most this many torches (fewer on Low memory). */
  torches: number;
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
  const rock = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return true;
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
  for (let y = 0; y < L.h; y++) {
    let any = false;
    for (let x = 0; x < L.w; x++) if (rock(x, y)) any = true;
    const doorPosts = (y === 0 && L.doorAt.n) || (y === L.h - 1 && L.doorAt.s) || (y === my && (L.doorAt.w || L.doorAt.e));
    if (!any && !doorPosts) continue;
    // Its bottom edge sets the depth: whoever stands north of it is hidden behind it.
    bake(0, y * T - lift - 4, W, T + lift + 4, AVATAR_DEPTH + (y + 1) * T - 2, (g) => {
      for (let x = 0; x < L.w; x++) if (rock(x, y)) drawRockTile(g, x, y);
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

  // ------------------------------------------------------------------ torches (warm light pools)
  const spots: Array<[number, number]> = [];
  if (L.doorAt.n) spots.push([(mx - 0.7) * T, T * 0.55], [(mx + 1.7) * T, T * 0.55]);
  if (L.doorAt.s) spots.push([(mx - 0.7) * T, H - T * 0.75]);
  if (L.doorAt.w) spots.push([T * 0.5, (my - 1.2) * T]);
  if (L.doorAt.e) spots.push([W - T * 0.5, (my - 1.2) * T]);
  // Plus one on a rock face somewhere.
  for (let tries = 0; tries < 30 && spots.length < o.torches + 1; tries++) {
    const x = 1 + Math.floor(rnd() * (L.w - 2)), y = 1 + Math.floor(rnd() * (L.h - 3));
    if (rock(x, y) && !rock(x, y + 1)) spots.push([(x + 0.5) * T, (y + 0.7) * T]);
  }
  const torchList = spots.sort(() => rnd() - 0.5).slice(0, o.torches);
  for (const [tx, ty] of torchList) {
    const glow = scene.add.image(tx, ty + T * 0.6, 'lab_glow').setTint(0xff8c32).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.42).setScale((T * 4.2) / 128).setDepth(-5);
    const flame = scene.add.image(tx, ty, 'lab_flame').setOrigin(0.5, 0.9).setScale(T / 70).setDepth(AVATAR_DEPTH + ty + T * 0.6);
    const halo = scene.add.image(tx, ty - T * 0.15, 'lab_glow').setTint(0xffc078).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.6).setScale((T * 1.1) / 128).setDepth(AVATAR_DEPTH + ty + T * 0.61);
    objs.push(glow, flame, halo);
    const d = 240 + rnd() * 220;
    scene.tweens.add({ targets: glow, alpha: { from: 0.34, to: 0.5 }, scale: { from: (T * 4) / 128, to: (T * 4.4) / 128 }, duration: d * 2, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    scene.tweens.add({ targets: flame, scaleY: { from: (T / 70) * 0.85, to: (T / 70) * 1.12 }, duration: d, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
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

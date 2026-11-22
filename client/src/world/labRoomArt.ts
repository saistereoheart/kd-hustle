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
import { LAB_FRAMES, LAB_SHEET, type LabFrame } from './labSheet';

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

/** The room pictures' sharpness (texels per world px): low, shown with hard edges, for the pixel-art look. */
const PIXEL_RES = 0.8;

/** The tavern's bar counter, in tiles wide (from the tileset); Mak Jah stands at its top edge. */
export const BAR_W = 3.4;
/** How far down from her tile Mak Jah stands so her feet are on the far side of the bar (tiles). */
export const KEEPER_DY = 0.4;

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
  if (!tm.exists('lab_vortex')) {
    // A purple swirl (spiral arms round a bright middle): the portal, turned by a tween.
    const c = tm.createCanvas('lab_vortex', 128, 128)!;
    const x = c.context;
    const g = x.createRadialGradient(64, 64, 2, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,240,255,1)');
    g.addColorStop(0.25, 'rgba(200,110,255,0.9)');
    g.addColorStop(0.7, 'rgba(110,30,190,0.6)');
    g.addColorStop(1, 'rgba(40,0,80,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    x.strokeStyle = 'rgba(255,220,255,0.55)';
    for (let arm = 0; arm < 4; arm++) {
      x.lineWidth = 3;
      x.beginPath();
      for (let t = 0; t < 1; t += 0.02) {
        const a = arm * (Math.PI / 2) + t * Math.PI * 2.2;
        const r = 6 + t * 54;
        const px = 64 + Math.cos(a) * r, py = 64 + Math.sin(a) * r;
        if (t === 0) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.stroke();
    }
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
  // 🎮 Pixel-art look: the pictures are drawn at a fixed, low sharpness and shown with hard pixel
  // edges (cheaper than smooth, too). Labels, people and lights stay smooth on top.
  const res = PIXEL_RES;

  // Moody palette: the floor's own colour, pulled towards cold night blue.
  // Dark, warm stone: the floor's own colour pulled towards a deep purple-brown; firelight does the rest.
  const night = 0x2a2232;
  const floorC = shade(mix(hex(o.floor), night, 0.6), 0.62);
  const rockTop = shade(mix(hex(o.wall), 0x6a6478, 0.5), 0.85);
  const rockFace = shade(mix(hex(o.wall), 0x16121e, 0.65), 0.7);
  const frost = 0x9d93b3; // dust and lichen on the rock now, not frost
  const pathC = mix(floorC, 0x9c8f8a, 0.3);

  // ---- which tiles are rock: the room's own rock + the outer walls (minus the doorways)
  const isDoorGap = (x: number, y: number) =>
    (!!L.doorAt.n && y === 0 && Math.abs(x - mx) <= 1) ||
    (!!L.doorAt.s && y === L.h - 1 && Math.abs(x - mx) <= 1) ||
    (!!L.doorAt.w && x === 0 && Math.abs(y - my) <= 1) ||
    (!!L.doorAt.e && x === L.w - 1 && Math.abs(y - my) <= 1);
  // The entrance hall's furniture is solid too, but it isn't rock.
  const hallSolid: Array<[number, number]> = [];
  if (L.hall) {
    const [x0, y0, x1, y1] = L.hall.tavern;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) hallSolid.push([x, y]);
    hallSolid.push(...L.hall.counter, L.hall.fire, ...L.hall.tables, ...L.hall.longTable, ...L.hall.benches);
    for (let dx = -1; dx <= 1; dx++) hallSolid.push([L.hall.portal[0] + dx, L.hall.portal[1]]);
  }
  const furniture = new Set<number>(hallSolid.map(([x, y]) => y * L.w + x));
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

  // ------------------------------------------------------------------ 👁️ terrain that can hide you
  // Only the terrain (rock, walls, ceilings, stones, rubble, the door arch) gets the see-through
  // circle; props (the tavern, lamps, barrels, the portal, stalls, signs) stay as they are.
  type Occ = {
    obj: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Mask & Phaser.GameObjects.Components.AlphaSingle & Phaser.GameObjects.Components.Visible;
    depth: number; x0: number; y0: number; x1: number; y1: number; masked: boolean;
    /** A black copy of it, shown only in the dithered rim round the hole (made when first needed). */
    twin?: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible;
  };
  const occluders: Occ[] = [];
  /** Remember a piece of terrain standing in front of avatars: it gets the see-through circle. */
  function occlude(obj: Occ['obj'] & { depth: number }, box?: { x0: number; y0: number; x1: number; y1: number }) {
    let b = box;
    if (!b) {
      const r = (obj as unknown as Phaser.GameObjects.Image).getBounds();
      b = { x0: r.x, y0: r.y, x1: r.right, y1: r.bottom };
    }
    occluders.push({ obj, depth: obj.depth, ...b, masked: false });
  }
  /**
   * The see-through circle, in chunky pixels like the art: a stepped hole (every cell of a pixel grid
   * inside it), and round it a black rim that dithers out (Bayer pattern) so the edge reads as a
   * dark pixel vignette. WebGL only; without it, covering terrain just fades.
   */
  const webgl = scene.sys.renderer.type === Phaser.WEBGL;
  const XR = T * 1.05, BAND = T * 0.75, CELL = 5;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  let xray: Phaser.GameObjects.Graphics | null = null;
  let rimG: Phaser.GameObjects.Graphics | null = null;
  if (webgl) {
    xray = scene.make.graphics({}, false).fillStyle(0xffffff, 1);
    rimG = scene.make.graphics({}, false).fillStyle(0xffffff, 1);
    const n = Math.ceil((XR + BAND) / CELL);
    for (let j = -n; j <= n; j++)
      for (let i = -n; i <= n; i++) {
        const d = Math.hypot((i + 0.5) * CELL, (j + 0.5) * CELL);
        if (d < XR) xray.fillRect(i * CELL, j * CELL, CELL, CELL);
        else if (d < XR + BAND) {
          const k = 1 - (d - XR) / BAND; // 1 at the hole's edge → 0 outside
          const thr = (BAYER[((j % 4) + 4) % 4 * 4 + ((i % 4) + 4) % 4] + 0.5) / 16;
          if (Math.pow(k, 0.6) > thr) rimG.fillRect(i * CELL, j * CELL, CELL, CELL);
        }
      }
  }
  const mask = xray ? xray.createGeometryMask() : null;
  mask?.setInvertAlpha(true);
  const rimMask = rimG ? rimG.createGeometryMask() : null;
  /** The black copy of a piece of terrain (a sheet image, or a roof made of them). */
  function twinOf(o: Occ): Occ['twin'] {
    const copy = (img: Phaser.GameObjects.Image) =>
      scene.add.image(img.x, img.y, img.texture.key, img.frame.name).setOrigin(img.originX, img.originY).setScale(img.scaleX, img.scaleY).setFlipX(img.flipX).setTintFill(0x000000);
    if (o.obj instanceof Phaser.GameObjects.Image && !(o.obj instanceof Phaser.GameObjects.RenderTexture)) {
      const t = copy(o.obj).setDepth(o.depth + 0.5);
      t.setMask(rimMask!);
      objs.push(t);
      return t;
    }
    if (o.obj instanceof Phaser.GameObjects.Container) {
      const box = scene.add.container(o.obj.x, o.obj.y).setDepth(o.depth + 0.5);
      for (const c of o.obj.list) if (c instanceof Phaser.GameObjects.Image) box.add(copy(c));
      box.setMask(rimMask!);
      objs.push(box);
      return box;
    }
    return undefined; // (drawn-in-code rock rows: just the hole)
  }

  // ------------------------------------------------------------------ 🧱 the tileset (when it's loaded)
  // Rooms are built from the pieces of the painted tileset; whatever it doesn't have (bushes,
  // cobwebs, bones, cold fires) is still drawn in code, and without it everything is.
  const sheet = scene.textures.exists(LAB_SHEET) && scene.textures.get(LAB_SHEET).has('floor_dark_a');
  /** Sheet pixels → world pixels (one floor tile of the sheet covers 2×2 room tiles). */
  const SC = 0.72;
  /** A piece standing on the floor: bottom-middle at (x, by), `w` wide (else its own size × SC). */
  const piece = (frame: LabFrame, x: number, by: number, opt: { w?: number; h?: number; depth?: number; flip?: boolean; alpha?: number; terrain?: boolean } = {}) => {
    const [, , fw, fh] = LAB_FRAMES[frame];
    const s = opt.w ? opt.w / fw : SC;
    // `h`: squash it to this height (rock: about a tile, so it doesn't stand over the floor you walk on).
    const sy = opt.h ? opt.h / fh : s;
    const img = scene.add.image(x, by, LAB_SHEET, frame).setOrigin(0.5, 1).setScale(opt.flip ? -s : s, sy).setDepth(opt.depth ?? AVATAR_DEPTH + by - 1);
    if (opt.alpha !== undefined) img.setAlpha(opt.alpha);
    objs.push(img);
    if (opt.terrain) occlude(img);
    return img;
  };
  /** Where the lights are (for picking warm-lit floor near them). */
  const lightSpots: Array<[number, number]> = [];
  for (const pr of L.props) if (pr.kind === 'lamp') lightSpots.push([(pr.at[0] + 0.5) * T, (pr.at[1] + 0.5) * T]);
  if (o.fire) lightSpots.push([(o.fire[0] + 0.5) * T, (o.fire[1] + 0.5) * T]);
  if (L.hall) lightSpots.push([(L.hall.fire[0] + 0.5) * T, (L.hall.fire[1] + 0.5) * T], [(L.hall.tavern[0] + 2.5) * T, 3.5 * T]);
  if (L.doorAt.n) lightSpots.push([(mx + 0.5) * T, T]);

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

  /** Everything that stands up, from the tileset: door arch, lamps, signs, the hall's furniture, clutter. */
  function buildFromSheet() {
    // The north doorway: a lit stone arch (a gate across it if it's locked).
    if (L.doorAt.n) {
      piece('arch_door_blue', (mx + 0.5) * T, T * 1.05, { w: T * 3.3, depth: AVATAR_DEPTH + T - 1, terrain: true });
      if (o.locked.n) piece('fence', (mx + 0.5) * T, T * 1.05, { w: T * 2.4, depth: AVATAR_DEPTH + T });
    }
    for (const d of ['w', 'e', 's'] as const) {
      if (!L.doorAt[d] || !o.locked[d]) continue;
      const at = L.doorAt[d]!;
      piece('fence', (at[0] + 0.5) * T, (at[1] + 1) * T, { w: T * 2.2, depth: AVATAR_DEPTH + (at[1] + 1) * T });
    }
    // Lamps and signs.
    for (const pr of L.props) {
      const px = (pr.at[0] + 0.5) * T, by = (pr.at[1] + 0.85) * T;
      if (pr.kind === 'lamp') piece('lamp_post', px, by);
      if (pr.kind === 'sign') piece('signpost', px, by);
    }
    // A working campfire (rest chambers).
    if (o.fire) piece('campfire', (o.fire[0] + 0.5) * T, (o.fire[1] + 1.05) * T, { w: T * 1.7 });
    // The merchant's stall beside him.
    if (o.merchant) piece('stall_striped', (o.merchant[0] + 1.75) * T, (o.merchant[1] + 1) * T, { w: T * 2.2 });
    if (L.hall) {
      const h = L.hall;
      const [tx0, ty0, tx1, ty1] = h.tavern;
      // 🌀 The portal in its ring of stones.
      piece('portal', (h.portal[0] + 0.5) * T, (h.portal[1] + 1.35) * T, { w: T * 3.4, depth: AVATAR_DEPTH + (h.portal[1] + 1) * T - 5 });
      // 🍵 The tavern behind, its counter (with stools) in front; Mak Jah stands between them.
      piece('tavern', ((tx0 + tx1 + 1) / 2) * T, (ty1 + 1.05) * T, { w: (tx1 - tx0 + 1.6) * T, depth: AVATAR_DEPTH + (ty0 + 1.1) * T });
      const c0 = h.counter[0], cn = h.counter.length;
      // (Its depth is just under Mak Jah's, who stands at its top edge, so she's behind the counter.)
      piece('bar_counter', (c0[0] + cn / 2) * T, (c0[1] + 1.55) * T, { w: BAR_W * T, depth: AVATAR_DEPTH + (c0[1] - 0.5) * T });
      // Tables, the long table and its bench.
      for (const t of h.tables) piece('table_round', (t[0] + 0.5) * T, (t[1] + 0.95) * T, { w: T * 1.3 });
      // One simple table in front of the people on the bench: low, so you see their top half.
      const by = h.benches[0][1];
      piece('table_mug', (h.longTable[0][0] + h.longTable.length / 2) * T, (by + 1.25) * T, { w: h.longTable.length * T * 0.9, h: T * 0.62, depth: AVATAR_DEPTH + (by + 1.25) * T });
      // The campfire with people round it.
      piece('campfire', (h.fire[0] + 0.5) * T, (h.fire[1] + 1.05) * T, { w: T * 1.7 });
      // Clutter: barrels and crates by the walls, a banner and a wall lantern on the back wall.
      piece('barrel', (tx1 + 0.75) * T, (h.counter[0][1] + 1) * T);
      piece('crate_barrel', T * 1.6, (h.fire[1] + 0.1) * T);
      piece('crate_big', (h.portal[0] + 1.95) * T, 2.45 * T, { w: T * 0.95 });
      piece('barrel', T * 1.4, (h.fire[1] + 2.4) * T);
      piece('banner', (tx0 - 1 + 0.5) * T, T * 1.1, { w: T * 1.1, depth: AVATAR_DEPTH + T });
      piece('wall_lantern', 6.5 * T, T * 1.15, { w: T * 1.2, depth: AVATAR_DEPTH + T });
      return;
    }
    // Elsewhere: clutter against the rock, and now and then a banner or a lantern on the back wall.
    const clutter: LabFrame[] = ['barrel', 'crate_b', 'crate_small_a', 'rubble_a', 'rubble_b', 'pot', 'boulders', 'crate_barrel', 'rubble_wall_a'];
    const taken = new Set<number>([...L.brush.keys(), ...L.props.map((pr) => pr.at[1] * L.w + pr.at[0])]);
    for (let n = 0, tries = 0; n < 3 && tries < 30; tries++) {
      const x = 1 + Math.floor(rnd() * (L.w - 2)), y = 1 + Math.floor(rnd() * (L.h - 2));
      const i = y * L.w + x;
      if (rock(x, y) || taken.has(i) || Math.abs(x - mx) <= 1 || Math.abs(y - my) <= 1) continue;
      if (![[1, 0], [-1, 0], [0, -1]].some(([dx, dy]) => rock(x + dx, y + dy))) continue;
      taken.add(i);
      const f = clutter[Math.floor(rnd() * clutter.length)];
      piece(f, (x + 0.5) * T, (y + 0.9) * T, { w: T * (0.9 + rnd() * 0.3), terrain: f.startsWith('rubble') || f === 'boulders' });
      n++;
    }
    if (rnd() < 0.45) {
      const bx = 2 + Math.floor(rnd() * (L.w - 4));
      if (Math.abs(bx - mx) > 2) piece(rnd() < 0.5 ? 'banner' : 'wall_lantern', (bx + 0.5) * T, T * 1.1, { w: T * 1.1, depth: AVATAR_DEPTH + T });
    }
  }

  // ------------------------------------------------------------------ the entrance hall
  /** The hall's floor extras: the merchant's red rug, the tavern's plank floor and porch. */
  function drawHallFloor(g: Phaser.GameObjects.Graphics, planks = true) {
    const h = L.hall!;
    // A red rug in front of the merchant, with a gold border and fringe.
    const rx = 3.6 * T, ry = 2.55 * T, rw = 3.6 * T, rh = 1.1 * T;
    g.fillStyle(0x000000, 0.35).fillRect(rx + 3, ry + 4, rw, rh);
    g.fillStyle(0x7a1c24, 1).fillRect(rx, ry, rw, rh);
    g.lineStyle(3, 0xc9a227, 0.9).strokeRect(rx + 5, ry + 5, rw - 10, rh - 10);
    g.fillStyle(0x9c2a33, 1).fillRect(rx + 12, ry + 12, rw - 24, rh - 24);
    for (let x = rx + 4; x < rx + rw; x += 6) g.fillStyle(0xc9a227, 0.8).fillRect(x, ry + rh, 2, 5).fillRect(x, ry - 5, 2, 5);
    // The tavern's plank floor and the porch in front of the counter.
    if (!planks) return;
    const [x0, y0, x1] = h.tavern;
    const px = x0 * T - T * 0.3, pw = (x1 - x0 + 1) * T + T * 0.3;
    for (let y = y0 * T; y < (h.counter[0][1] + 1.6) * T; y += 9) {
      g.fillStyle(rnd() < 0.5 ? 0x4a3220 : 0x553a25, 1).fillRect(px, y, pw, 8);
      g.fillStyle(0x2e1f14, 1).fillRect(px, y + 8, pw, 1);
      for (let k = 0; k < 2; k++) g.fillStyle(0x2e1f14, 1).fillRect(px + rnd() * pw, y, 1, 8);
    }
    g.fillStyle(0x000000, 0.35).fillRect(px, (h.counter[0][1] + 1.6) * T, pw, 5);
  }
  /** The tavern: a timber back wall with lit windows and bottle shelves, posts, a shingled roof
   *  with a chimney, a hanging cup sign. Open at the front (the counter stands in front of it). */
  function drawTavern(g: Phaser.GameObjects.Graphics, x0: number, y0: number, w: number) {
    const top = y0 - T * 0.95, wallH = T * 1.9;
    // Back wall: vertical planks.
    for (let x = x0; x < x0 + w; x += 10) {
      g.fillStyle(rnd() < 0.5 ? 0x5c3d26 : 0x67462c, 1).fillRect(x, top + T * 0.55, 10, wallH);
      g.fillStyle(0x2e1f14, 1).fillRect(x + 9, top + T * 0.55, 1, wallH);
    }
    // Windows with warm light and a cross frame.
    for (const wx of [x0 + T * 0.55, x0 + w - T * 1.25]) {
      g.fillStyle(0x2e1f14, 1).fillRect(wx - 3, top + T * 0.9, T * 0.75, T * 0.75);
      g.fillStyle(0xffb347, 1).fillRect(wx, top + T * 0.93, T * 0.69, T * 0.69);
      g.fillStyle(0xffe08a, 1).fillRect(wx + 4, top + T * 0.97, T * 0.3, T * 0.25);
      g.fillStyle(0x2e1f14, 1).fillRect(wx + T * 0.33, top + T * 0.93, 3, T * 0.69).fillRect(wx, top + T * 1.25, T * 0.69, 3);
    }
    // Shelves of bottles between the windows.
    const sx = x0 + T * 1.5, sw = w - T * 3;
    const cols = [0x2b8a3e, 0xc92a2a, 0xf59f00, 0x1971c2, 0x862e9c, 0xe8590c];
    for (const sy of [top + T * 1.05, top + T * 1.55]) {
      g.fillStyle(0x2e1f14, 1).fillRect(sx, sy + T * 0.28, sw, 5);
      for (let k = 0; k < 7; k++) {
        const bx = sx + 6 + (k * (sw - 12)) / 6;
        g.fillStyle(cols[(k + Math.round(sy)) % cols.length], 1).fillRect(bx - 3, sy + T * 0.08, 6, T * 0.2);
        g.fillStyle(0xffffff, 0.45).fillRect(bx - 2, sy + T * 0.1, 1.5, T * 0.12);
      }
    }
    // Corner posts and a beam.
    g.fillStyle(0x3d2a17, 1).fillRect(x0 - 4, top + T * 0.4, 9, wallH + T * 0.2).fillRect(x0 + w - 5, top + T * 0.4, 9, wallH + T * 0.2);
    g.fillStyle(0x4a3220, 1).fillRect(x0 - 6, top + T * 0.45, w + 12, 8);
    // The roof: dark shingles in rows, an overhang, a chimney.
    g.fillStyle(0x3a2a3a, 1).fillRect(x0 + w - T * 1.1, top - T * 0.55, T * 0.42, T * 0.7);
    g.fillStyle(0x221a24, 1).fillRect(x0 + w - T * 1.15, top - T * 0.6, T * 0.52, 6);
    for (let r = 0; r < 4; r++) {
      const ry = top - T * 0.2 + r * T * 0.17, inset = (3 - r) * T * 0.12;
      for (let x = x0 - T * 0.25 + inset; x < x0 + w + T * 0.25 - inset; x += 12) {
        g.fillStyle(r % 2 ? 0x2c2333 : 0x352a3e, 1).fillRect(x, ry, 11, T * 0.17);
        g.fillStyle(0x16111a, 1).fillRect(x, ry + T * 0.17 - 2, 11, 2);
      }
    }
    // A hanging sign with a cup.
    const hx = x0 + w + T * 0.05, hy = top + T * 0.85;
    g.fillStyle(0x2e1f14, 1).fillRect(hx - 2, hy - T * 0.25, 4, T * 0.25);
    g.fillStyle(0x4a3220, 1).fillRoundedRect(hx - T * 0.32, hy, T * 0.64, T * 0.6, 4);
    g.lineStyle(2, 0xc9a227, 1).strokeRoundedRect(hx - T * 0.28, hy + 4, T * 0.56, T * 0.52, 3);
    g.fillStyle(0xf1e3c6, 1).fillRoundedRect(hx - T * 0.13, hy + T * 0.22, T * 0.22, T * 0.2, 3);
    g.lineStyle(2, 0xf1e3c6, 1).strokeCircle(hx + T * 0.12, hy + T * 0.3, 4);
  }
  function drawBarrel(g: Phaser.GameObjects.Graphics, cx: number, by: number) {
    const w = T * 0.62, h = T * 0.8;
    g.fillStyle(0x000000, 0.35).fillEllipse(cx, by, w * 1.1, T * 0.2);
    g.fillStyle(0x6b4423, 1).fillRoundedRect(cx - w / 2, by - h, w, h, 8);
    for (let k = 1; k < 4; k++) g.fillStyle(0x4a2f17, 1).fillRect(cx - w / 2 + (k * w) / 4, by - h + 3, 1.5, h - 6);
    g.fillStyle(0x3a3a3a, 1).fillRect(cx - w / 2, by - h * 0.8, w, 4).fillRect(cx - w / 2, by - h * 0.3, w, 4);
    g.fillStyle(0x8a5a2e, 1).fillEllipse(cx, by - h, w * 0.92, T * 0.2);
    g.fillStyle(0xffffff, 0.12).fillRect(cx - w / 2 + 4, by - h + 6, 3, h - 14);
  }
  function drawCrate(g: Phaser.GameObjects.Graphics, cx: number, by: number) {
    const w = T * 0.62;
    g.fillStyle(0x000000, 0.35).fillEllipse(cx, by, w * 1.1, T * 0.18);
    g.fillStyle(0x7a5530, 1).fillRect(cx - w / 2, by - w, w, w);
    g.lineStyle(3, 0x4a3220, 1).strokeRect(cx - w / 2 + 2, by - w + 2, w - 4, w - 4);
    g.lineBetween(cx - w / 2 + 3, by - 3, cx + w / 2 - 3, by - w + 3);
    g.fillStyle(0x9a7048, 1).fillRect(cx - w / 2, by - w, w, 3);
  }
  function drawStool(g: Phaser.GameObjects.Graphics, cx: number, by: number) {
    g.fillStyle(0x000000, 0.3).fillEllipse(cx, by, T * 0.5, T * 0.14);
    g.fillStyle(0x3d2a17, 1).fillRect(cx - T * 0.16, by - T * 0.4, 4, T * 0.4).fillRect(cx + T * 0.12, by - T * 0.4, 4, T * 0.4);
    g.fillStyle(0x7a5530, 1).fillEllipse(cx, by - T * 0.42, T * 0.42, T * 0.16);
    g.fillStyle(0x9a7048, 1).fillEllipse(cx, by - T * 0.45, T * 0.36, T * 0.1);
  }
  /** A wooden table with mugs on it. */
  function drawTable(g: Phaser.GameObjects.Graphics, x0: number, y0: number, w: number, mugs: number) {
    g.fillStyle(0x000000, 0.3).fillEllipse(x0 + w / 2, y0 + T * 0.92, w * 1.05, T * 0.2);
    g.fillStyle(0x3d2a17, 1).fillRect(x0 + 5, y0 + T * 0.45, 5, T * 0.45).fillRect(x0 + w - 10, y0 + T * 0.45, 5, T * 0.45);
    g.fillStyle(0x6b4a2b, 1).fillRect(x0, y0 + T * 0.18, w, T * 0.32);
    g.fillStyle(0x8a6239, 1).fillRect(x0, y0 + T * 0.18, w, 4);
    for (let x = x0 + 12; x < x0 + w; x += 14) g.fillStyle(0x4a3220, 1).fillRect(x, y0 + T * 0.18, 1, T * 0.32);
    for (let k = 0; k < mugs; k++) {
      const mx2 = x0 + ((k + 0.5) * w) / mugs + (rnd() - 0.5) * 6;
      g.fillStyle(k % 2 ? 0x8a6239 : 0x4a4a55, 1).fillRect(mx2 - 4, y0 + T * 0.05, 8, 11);
      g.fillStyle(0xf1e3c6, 0.9).fillRect(mx2 - 3, y0 + T * 0.05, 6, 3);
      g.lineStyle(1.5, 0x2e1f14, 1).strokeRect(mx2 + 4, y0 + T * 0.1, 3, 5);
    }
  }
  /** A red banner with a gold emblem. */
  function drawBanner(g: Phaser.GameObjects.Graphics, cx: number, y0: number) {
    const w = T * 0.55, h = T * 1.05;
    g.fillStyle(0x2e1f14, 1).fillRect(cx - w / 2 - 4, y0 - 3, w + 8, 4);
    g.fillStyle(0x6e1a22, 1).fillRect(cx - w / 2, y0, w, h);
    g.fillTriangle(cx - w / 2, y0 + h, cx + w / 2, y0 + h, cx, y0 + h + T * 0.2);
    g.fillStyle(0x8e2430, 1).fillRect(cx - w / 2 + 3, y0, 3, h);
    g.lineStyle(2, 0xc9a227, 1);
    g.lineBetween(cx, y0 + h * 0.25, cx, y0 + h * 0.75);
    g.lineBetween(cx - w * 0.25, y0 + h * 0.45, cx + w * 0.25, y0 + h * 0.45);
    g.strokeCircle(cx, y0 + h * 0.45, w * 0.18);
  }
  /** A stone arch over the north doorway. */
  function drawArch(g: Phaser.GameObjects.Graphics, cx: number, baseY: number) {
    const r = T * 1.35;
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI + (k / 10) * Math.PI;
      const bx = cx + Math.cos(a) * r, by = baseY - T * 0.35 + Math.sin(a) * r * 0.75;
      g.fillStyle(shade(rockTop, 0.75 + (k % 2) * 0.15), 1).fillRoundedRect(bx - T * 0.2, by - T * 0.18, T * 0.4, T * 0.36, 4);
      g.lineStyle(1, 0x0c0a14, 0.8).strokeRoundedRect(bx - T * 0.2, by - T * 0.18, T * 0.4, T * 0.36, 4);
    }
  }
  /** The portal's frame: a ring of dark, cracked stones, some floating loose. */
  function drawPortalRim(g: Phaser.GameObjects.Graphics, cx: number, cy: number) {
    const rx = T * 1.05, ry = T * 1.3;
    g.fillStyle(0x0b0710, 1).fillEllipse(cx, cy, rx * 1.75, ry * 1.75);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const bx = cx + Math.cos(a) * rx, by = cy + Math.sin(a) * ry;
      g.fillStyle(shade(0x3a2f48, 0.8 + rnd() * 0.5), 1);
      blob(g, bx, by, T * 0.2, T * 0.17, 6, 0.3);
      g.lineStyle(1.5, 0xd0a2ff, 0.5).lineBetween(bx - 3, by - 2, bx + 3, by + 3);
    }
    for (let k = 0; k < 5; k++) {
      const a = rnd() * Math.PI * 2;
      g.fillStyle(0x2a2236, 1);
      blob(g, cx + Math.cos(a) * rx * 1.4, cy + Math.sin(a) * ry * 1.25, T * 0.09, T * 0.07, 5, 0.3);
    }
  }

  /** Draw with `paint` (world px) into a picture covering [x0, y0, w, h], at `depth`. */
  const bake = (x0: number, y0: number, w: number, h: number, depth: number, paint: (g: Phaser.GameObjects.Graphics) => void, terrain = false) => {
    const g = scene.make.graphics({}, false);
    paint(g);
    g.setScale(res);
    const rt = scene.add.renderTexture(x0, y0, Math.ceil(w * res), Math.ceil(h * res)).setOrigin(0, 0);
    rt.draw(g, -x0 * res, -y0 * res);
    g.destroy();
    rt.setScale(1 / res).setDepth(depth);
    rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    objs.push(rt);
    if (depth > AVATAR_DEPTH && terrain) occlude(rt, { x0, y0, x1: x0 + w, y1: y0 + h });
    return rt;
  };

  // ------------------------------------------------------------------ the floor
  if (sheet) {
    // Cobblestone tiles from the sheet (2×2 room tiles each): warm-lit near the lights, a puddle here
    // and there, moss in the dark.
    const B = T * 2;
    const rt = scene.add.renderTexture(0, 0, Math.ceil(W * res), Math.ceil(H * res)).setOrigin(0, 0).setScale(1 / res).setDepth(-11);
    const tile = scene.make.image({ key: LAB_SHEET, frame: 'floor_dark_a' }, false).setOrigin(0, 0);
    const puddleAt = L.hall ? -1 : Math.floor(rnd() * Math.ceil(L.w / 2) * Math.ceil(L.h / 2));
    let k = 0;
    for (let by = 0; by < H; by += B)
      for (let bx = 0; bx < W; bx += B, k++) {
        const cx = bx + T, cy = by + T;
        const near = Math.min(...lightSpots.map(([lx, ly]) => Math.hypot(lx - cx, ly - cy)), 1e9);
        // Mostly the plain dark cobbles (the lamps' own light warms them), warm-lit right by a fire.
        void near;
        let f: LabFrame = rnd() < 0.1 ? 'floor_moss' : 'floor_dark_a';
        if (k === puddleAt) f = rnd() < 0.5 ? 'floor_puddle_orange' : 'floor_puddle_purple';
        if (L.hall && bx < T * 5 && by >= T * 2 && by < T * 5) f = 'floor_puddle_purple'; // by the portal
        tile.setFrame(f);
        tile.setDisplaySize(B * res + 1, B * res + 1);
        rt.draw(tile, bx * res, by * res);
      }
    tile.destroy();
    rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    objs.push(rt);
  }
  bake(0, 0, W, H, -10, (g) => {
    if (!sheet) g.fillStyle(0x05060b, 1).fillRect(0, 0, W, H);
    else {
      // Only the dark beyond the walls (the tiles are underneath).
      g.fillStyle(0x05060b, 1).fillRect(0, 0, W, T * 0.25).fillRect(0, H - T * 0.2, W, T * 0.2).fillRect(0, 0, T * 0.2, H).fillRect(W - T * 0.2, 0, T * 0.2, H);
    }
    if (!sheet) {
    // Mortar, then irregular flagstones in staggered rows (no grid: sizes and shapes vary).
    g.fillStyle(shade(floorC, 0.5), 1).fillRect(T * 0.5, T * 0.5, W - T, H - T);
    const rowH = T * 0.4;
    for (let ry = T * 0.5, row = 0; ry < H - T * 0.4; ry += rowH, row++) {
      let rx = T * 0.5 - (row % 2 ? rnd() * T * 0.3 : 0);
      while (rx < W - T * 0.4) {
        const sw = T * (0.3 + rnd() * 0.32);
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
    }
    // Puddles: dark water that catches the light.
    for (let i = 0; i < (sheet ? 0 : 3); i++) {
      const px = T * 1.5 + rnd() * (W - 3 * T), py = T * 1.5 + rnd() * (H - 3 * T);
      if (rock(Math.floor(px / T), Math.floor(py / T)) || furniture.has(Math.floor(py / T) * L.w + Math.floor(px / T))) continue;
      const rw = T * (0.5 + rnd() * 0.6), rh = rw * 0.35;
      g.fillStyle(0x0c0a14, 0.55).fillEllipse(px, py, rw * 2, rh * 2);
      g.fillStyle(L.hall && px < W / 3 ? 0x9c36b5 : 0xd9822b, 0.22).fillEllipse(px - rw * 0.2, py - rh * 0.2, rw * 1.1, rh * 0.7);
      g.fillStyle(0xffffff, 0.12).fillEllipse(px - rw * 0.4, py - rh * 0.3, rw * 0.4, rh * 0.25);
    }
    if (L.hall) drawHallFloor(g, !sheet);
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
    if (o.fire && !sheet) drawFirePit(g, (o.fire[0] + 0.5) * T, (o.fire[1] + 0.6) * T, true);
    if (L.hall && !sheet) drawFirePit(g, (L.hall.fire[0] + 0.5) * T, (L.hall.fire[1] + 0.5) * T, true);
    // Pebbles.
    for (let i = 0; i < (sheet ? 0 : 26); i++) {
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
      if (sheet && d === 'n') continue; // the arch from the sheet has its own dark way through
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
  for (const pr of sheet ? [] : L.props) {
    const px = (pr.at[0] + 0.5) * T, py = (pr.at[1] + 0.5) * T;
    if (pr.kind === 'lamp') stand(pr.at[1], (g) => drawLampPost(g, px, py));
    if (pr.kind === 'sign') stand(pr.at[1], (g) => drawSign(g, px, py));
  }
  if (sheet) buildFromSheet();
  else if (L.hall) {
    const h = L.hall;
    const [tx0, ty0, tx1] = h.tavern;
    const tw = (tx1 - tx0 + 1) * T;
    // The tavern: back wall with shelves and windows, roof above (row 1), counter and barrels in
    // front (row 3), stools on the porch (row 4).
    stand(ty0, (g) => drawTavern(g, tx0 * T, ty0 * T, tw));
    stand(h.counter[0][1], (g) => {
      drawCounter(g, h.counter[0][0] * T, h.counter[0][1] * T, h.counter.length * T);
      drawBarrel(g, (tx1 + 0.5) * T, (h.counter[0][1] + 0.9) * T);
      drawBarrel(g, (tx0 - 0.45) * T, (h.counter[0][1] + 0.95) * T);
    });
    for (const s of h.stools) stand(s[1], (g) => drawStool(g, (s[0] + 0.5) * T, (s[1] + 0.75) * T));
    for (const t of h.tables) stand(t[1], (g) => drawTable(g, t[0] * T, t[1] * T, T, 2));
    stand(h.benches[0][1], (g) => drawBench(g, h.benches[0][0] * T, h.benches[0][1] * T, h.benches.length * T));
    stand(h.longTable[0][1], (g) => drawTable(g, h.longTable[0][0] * T, h.longTable[0][1] * T, h.longTable.length * T, 4));
    // The portal's rocky rim (the swirl inside is live, below).
    stand(h.portal[1], (g) => drawPortalRim(g, (h.portal[0] + 0.5) * T, (h.portal[1] + 0.35) * T));
    // Clutter by the walls: barrels and crates, the merchant's crates.
    stand(h.fire[1] - 1, (g) => (drawBarrel(g, T * 1.4, (h.fire[1] - 0.2) * T), drawCrate(g, T * 2.2, (h.fire[1] + 0.2) * T)));
    stand(2, (g) => (drawCrate(g, (h.portal[0] + 2.4) * T, 2.85 * T), drawCrate(g, (h.portal[0] + 2.7) * T, 2.35 * T)));
  } else if (L.brush.size || L.props.length) {
    // Elsewhere: a barrel or a crate or two against the rock.
    for (let k = 0; k < 2; k++) {
      const x = 1 + Math.floor(rnd() * (L.w - 2)), y = 1 + Math.floor(rnd() * (L.h - 2));
      if (!rock(x, y) || rock(x, y + 1) || L.brush.has((y + 1) * L.w + x)) continue;
      stand(y + 1, (g) => (rnd() < 0.5 ? drawBarrel(g, (x + 0.5) * T, (y + 1.3) * T) : drawCrate(g, (x + 0.5) * T, (y + 1.3) * T)));
    }
  }
  // Banners hanging on the back wall (the entrance hall always; elsewhere sometimes).
  const banners: number[] = sheet ? [] : L.hall ? [10] : rnd() < 0.4 ? [2 + Math.floor(rnd() * (L.w - 4))] : [];
  for (const bx of banners) if (Math.abs(bx - mx) > 1) stand(0, (g) => drawBanner(g, (bx + 0.5) * T, T * 0.15));
  // The doorway north: a stone arch.
  if (L.doorAt.n && !sheet) stand(0, (g) => drawArch(g, (mx + 0.5) * T, T * 0.95));
  if (o.merchant && !sheet) stand(o.merchant[1], (g) => drawStall(g, (o.merchant![0] + 1.05) * T, (o.merchant![1] + 0.3) * T));
  for (let y = 0; y < L.h; y++) {
    let any = false;
    for (let x = 0; x < L.w; x++) if (rock(x, y)) any = true;
    const doorPosts = (y === 0 && L.doorAt.n) || (y === L.h - 1 && L.doorAt.s) || (y === my && (L.doorAt.w || L.doorAt.e));
    if (sheet) {
      // Rock from the sheet: a craggy piece per rock tile (two-tile clumps now and then), each a
      // bit wider than its tile so they run together into one wall, and only a little taller than
      // a tile (the back wall: taller, nothing walks behind it).
      const rockH = (row: number) => (row === 0 ? T * 1.7 : T * 1.3);
      for (let x = 0; x < L.w; x++) {
        if (!rock(x, y)) continue;
        const by = (y + 1) * T + 3;
        if (rock(x + 1, y) && rnd() < 0.4) {
          piece((['rock_cluster_a', 'rock_cluster_b', 'rock_wide'] as const)[Math.floor(rnd() * 3)], (x + 1) * T, by, { w: T * 2.2, h: rockH(y), depth: AVATAR_DEPTH + (y + 1) * T - 2, flip: rnd() < 0.5, terrain: true });
          x++;
        } else piece((['rock_cluster_c', 'rock_cluster_d', 'rock_cluster_a', 'rock_small', 'rock_pillar_a'] as const)[Math.floor(rnd() * 5)], (x + 0.5) * T, by, { w: T * 1.2, h: rockH(y), depth: AVATAR_DEPTH + (y + 1) * T - 2, flip: rnd() < 0.5, terrain: true });
      }
      if (!standing.has(y)) continue;
    } else if (!any && !doorPosts && !standing.has(y)) continue;
    // Its bottom edge sets the depth: whoever stands north of it is hidden behind it.
    bake(0, y * T - lift - 4 - T * 0.6, W, T + lift + 4 + T * 0.6, AVATAR_DEPTH + (y + 1) * T - 2, (g) => {
      if (!sheet) for (let x = 0; x < L.w; x++) if (rock(x, y)) drawRockTile(g, x, y);
      for (const fn of standing.get(y) ?? []) fn(g);
      if (sheet) return; // (doors: the arch from the sheet)
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
    }, !sheet && any);
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
  for (const pr of L.props) if (pr.kind === 'lamp') lights.push(() => light((pr.at[0] + 0.5) * T, (pr.at[1] + 0.85) * T - (sheet ? LAB_FRAMES.lamp_post[3] * SC * 0.83 : T * 1.3), (pr.at[1] + 0.85) * T, 4.6, 0xff9a3c, sheet ? 0.5 : 0.9));
  if (L.doorAt.n) lights.push(() => light((mx - 0.7) * T, T * 0.55, T * 1.15, 4, 0xff8c32, 1));
  if (L.doorAt.n) lights.push(() => light((mx + 1.7) * T, T * 0.55, T * 1.15, 4, 0xff8c32, 1));
  for (const mk of lights.slice(0, o.torches + fires.length)) mk();
  if (L.hall) {
    const h = L.hall;
    // The tavern's windows glow warm.
    const [tx0, ty0, tx1] = h.tavern;
    for (const wx of sheet ? [tx0 + 0.6, tx0 + 3.2, tx1 + 0.1] : [tx0 + 0.9, tx1 - 0.4]) {
      const win = scene.add.image(wx * T, (ty0 + (sheet ? 0.75 : 0.15)) * T, 'lab_glow').setTint(0xffa94d).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.55).setScale((T * 1.6) / 128).setDepth(AVATAR_DEPTH + (ty0 + 1) * T);
      objs.push(win);
      scene.tweens.add({ targets: win, alpha: { from: 0.45, to: 0.62 }, duration: 900 + rnd() * 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    const porch = scene.add.image((tx0 + tx1 + 1) * T / 2, (h.counter[0][1] + 0.8) * T, 'lab_glow').setTint(0xff9a3c).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35).setScale((T * 7) / 128, (T * 3.5) / 128).setDepth(-5);
    objs.push(porch);
    // 🌀 The portal: a swirl that turns, a purple glow round it and on the floor.
    const pcx = (h.portal[0] + 0.5) * T, pcy = (h.portal[1] + 0.35) * T;
    // (With the tileset's portal, a smaller, fainter swirl just keeps its middle turning.)
    const swirl = scene.add.image(pcx, pcy + (sheet ? T * 0.25 : 0), 'lab_vortex').setBlendMode(Phaser.BlendModes.ADD).setAlpha(sheet ? 0.45 : 1).setScale((T * (sheet ? 1.3 : 2.3)) / 128, (T * (sheet ? 1.6 : 2.8)) / 128).setDepth(AVATAR_DEPTH + (h.portal[1] + 1) * T - 3);
    const swirl2 = scene.add.image(pcx, pcy + (sheet ? T * 0.25 : 0), 'lab_vortex').setBlendMode(Phaser.BlendModes.ADD).setAlpha(sheet ? 0.3 : 0.7).setScale((T * 1.6) / 128, (T * 2.0) / 128).setDepth(AVATAR_DEPTH + (h.portal[1] + 1) * T - 2);
    const glowP = scene.add.image(pcx, pcy, 'lab_glow').setTint(0xb44cff).setBlendMode(Phaser.BlendModes.ADD).setAlpha(sheet ? 0.4 : 0.7).setScale((T * 5.5) / 128, (T * 6) / 128).setDepth(AVATAR_DEPTH + (h.portal[1] + 1) * T - 4);
    const poolP = scene.add.image(pcx + T * 0.3, pcy + T * 1.6, 'lab_glow').setTint(0x9c36b5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.55).setScale((T * 7) / 128, (T * 3.4) / 128).setDepth(-5);
    objs.push(swirl, swirl2, glowP, poolP);
    scene.tweens.add({ targets: swirl, angle: 360, duration: 6000, repeat: -1 });
    scene.tweens.add({ targets: swirl2, angle: -360, duration: 3800, repeat: -1 });
    scene.tweens.add({ targets: [glowP, poolP], alpha: { from: 0.45, to: 0.75 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
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
  const roofs: Array<{ x0: number; y0: number; x1: number; y1: number; img: { setAlpha(a: number): unknown }; a: number }> = [];
  for (const r of L.roofs) {
    if (sheet) {
      const edge = r.y === 0 || r.x === 0 || r.x + r.w >= L.w || r.y + r.h >= L.h;
      if (edge) continue; // doorways: the arch is the way through
      const box = scene.add.container(0, 0).setDepth(ROOF_DEPTH);
      for (let yy = r.y; yy < r.y + r.h; yy++)
        for (let xx = r.x; xx < r.x + r.w; xx += 2) {
          const f = (['rock_wide', 'boulders', 'rock_cluster_a'] as const)[Math.floor(rnd() * 3)];
          const fw = LAB_FRAMES[f][2];
          box.add(scene.add.image((xx + 1) * T, (yy + 0.6) * T, LAB_SHEET, f).setOrigin(0.5, 1).setScale((T * 2.3) / fw).setFlipX(rnd() < 0.5));
        }
      objs.push(box);
      occlude(box, { x0: r.x * T - T * 0.4, y0: r.y * T - T * 1.2, x1: (r.x + r.w + 1) * T, y1: (r.y + r.h) * T });
      roofs.push({ x0: r.x * T - T * 0.25, y0: r.y * T - T * 0.6, x1: (r.x + r.w) * T + T * 0.25, y1: (r.y + r.h) * T + T * 0.2, img: box, a: 1 });
      continue;
    }
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
    }, true);
    roofs.push({ x0: r.x * T - T * 0.25, y0: r.y * T - T * 0.6, x1: (r.x + r.w) * T + T * 0.25, y1: (r.y + r.h) * T + T * 0.2, img, a: 1 });
  }

  // ------------------------------------------------------------------ the dark edges
  const vig = scene.add.image(W / 2, H / 2, 'lab_vignette').setDisplaySize(W * 1.25, H * 1.35).setDepth(ROOF_DEPTH + 10);
  objs.push(vig);

  return {
    objs,
    update(x, y, dtMs) {
      void dtMs;
      void roofs;
      // 👁️ See-through circle: whatever stands in front of you (rock, a roof, the tavern) gets a round
      // hole cut around you, so you never vanish behind it. Only the few pieces covering you right now
      // are masked (each mask costs a draw), the rest are left alone.
      // Snapped to the pixel grid, so the stepped edge doesn't shimmer as you walk.
      const cx = Math.round(x / CELL) * CELL, cy = Math.round((y - T * 0.55) / CELL) * CELL, R = XR + BAND;
      xray?.setPosition(cx, cy);
      rimG?.setPosition(cx, cy);
      const pd = AVATAR_DEPTH + y;
      for (const o of occluders) {
        const nx = Math.max(o.x0, Math.min(cx, o.x1)), ny = Math.max(o.y0, Math.min(cy, o.y1));
        const hit = o.depth > pd && (nx - cx) ** 2 + (ny - cy) ** 2 < R * R;
        if (hit === o.masked) continue;
        o.masked = hit;
        if (mask) {
          if (hit) o.obj.setMask(mask);
          else o.obj.clearMask();
          if (hit && !o.twin) o.twin = twinOf(o);
          o.twin?.setVisible(hit);
        } else o.obj.setAlpha(hit ? 0.35 : 1); // (no WebGL: just fade it)
      }
    },
    destroy() {
      for (const o of occluders) if (o.masked && mask) o.obj.clearMask();
      occluders.length = 0;
      mask?.destroy();
      rimMask?.destroy();
      xray?.destroy();
      rimG?.destroy();
      for (const ob of objs) {
        scene.tweens.killTweensOf(ob);
        ob.destroy();
      }
      objs.length = 0;
    },
  };
}

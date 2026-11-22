// 🗝️ Labirin Purba's cave floor, drawn in code (not tiled from the sheet): pixel-art cobblestones in
// the tileset's colours and pixel size, one picture per room. It joins seamlessly (no tile edges) and
// carries no light of its own, so the lamps and fires light it evenly. Stones are jittered cells
// (nearest-seed), each shaded from the upper left with dark mortar between; moss specks; a purple
// sheen by the hall's portal or a puddle now and then. Painted once when you walk in (~a few ms).

/** Art pixels per room tile (the sheet's floor tiles come out at about this). */
export const FLOOR_PPT = 16;

type RGB = [number, number, number];
const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const MORTAR = hex('#0e0a13');
const MORTAR2 = hex('#17111d');
/** Stone colours: a few greys with a purple cast, dark → light. */
const STONES: RGB[][] = [
  [hex('#1f1826'), hex('#2c2234'), hex('#3a2d44'), hex('#4b3a57')],
  [hex('#221a2a'), hex('#31263a'), hex('#40324b'), hex('#523f5e')],
  [hex('#1d1722'), hex('#29212f'), hex('#362b3e'), hex('#463850')],
];
const MOSS: RGB[] = [hex('#323a1e'), hex('#434e22'), hex('#5a682b')];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FloorOpts {
  /** A purple glow on the floor (the hall's portal): tiles x0..x1, y0..y1. */
  purple?: { x0: number; y0: number; x1: number; y1: number };
  /** A puddle (tile centre, radius in tiles), catching orange or purple light. */
  puddle?: { x: number; y: number; r: number; color: 'orange' | 'purple' };
  /** Share of stones with moss on them. */
  moss?: number;
}

/** The floor of a room `w`×`h` tiles, as a canvas (FLOOR_PPT art pixels per tile). */
export function paintCaveFloor(w: number, h: number, seed: number, opts: FloorOpts = {}): HTMLCanvasElement {
  const W = w * FLOOR_PPT, H = h * FLOOR_PPT;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const d = img.data;
  const rnd = rng(seed * 9301 + 49297);
  // Seeds: one per cell of a staggered grid, jittered (stones ~7×6 art px).
  const CW = 7, CH = 6;
  const gw = Math.ceil(W / CW) + 2, gh = Math.ceil(H / CH) + 2;
  const sx = new Float32Array(gw * gh), sy = new Float32Array(gw * gh), kind = new Uint8Array(gw * gh), mossy = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      sx[k] = (i - 1 + (j % 2 ? 0.5 : 0) + 0.2 + rnd() * 0.6) * CW;
      sy[k] = (j - 1 + 0.2 + rnd() * 0.6) * CH;
      kind[k] = Math.floor(rnd() * STONES.length);
      mossy[k] = rnd() < (opts.moss ?? 0.08) ? 1 : 0;
    }
  const pp = opts.purple, pu = opts.puddle;
  for (let y = 0; y < H; y++) {
    const cj = Math.floor(y / CH) + 1;
    for (let x = 0; x < W; x++) {
      const ci = Math.floor(x / CW) + 1;
      // Nearest and second-nearest seed.
      let b1 = 1e9, b2 = 1e9, bk = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -2; di <= 2; di++) {
          const j = cj + dj, i = ci + di;
          if (j < 0 || i < 0 || j >= gh || i >= gw) continue;
          const k = j * gw + i;
          const dx = x + 0.5 - sx[k], dy = (y + 0.5 - sy[k]) * 1.15;
          const dd = dx * dx + dy * dy;
          if (dd < b1) (b2 = b1), (b1 = dd), (bk = k);
          else if (dd < b2) b2 = dd;
        }
      const edge = Math.sqrt(b2) - Math.sqrt(b1);
      let col: RGB;
      if (edge < 1.1) col = (x * 7 + y * 3) % 5 ? MORTAR : MORTAR2;
      else {
        const ramp = STONES[kind[bk]];
        const dx = x + 0.5 - sx[bk], dy = y + 0.5 - sy[bk];
        // Lit from the upper left: the top-left of each stone lighter, the bottom-right darker; the
        // rim next to the mortar darker on the shadow side.
        const t = dx + dy;
        let step = t < -3.2 ? 3 : t < -1 ? 2 : t > 3.4 ? 0 : 1;
        if (edge < 2.1 && t > 0) step = Math.max(0, step - 1);
        col = ramp[step];
        // A dither speck now and then, for texture.
        const n = ((x * 73856093) ^ (y * 19349663) ^ seed) >>> 0;
        if (n % 23 === 0) col = ramp[Math.max(0, step - 1)];
        if (mossy[bk] && n % 7 === 0 && edge > 1.6) col = MOSS[n % 3];
      }
      let [r, gg, b] = col;
      // The portal's purple sheen.
      if (pp) {
        const tx = x / FLOOR_PPT, ty = y / FLOOR_PPT;
        const qx = Math.max(0, pp.x0 - tx, tx - pp.x1), qy = Math.max(0, pp.y0 - ty, ty - pp.y1);
        const k = Math.max(0, 1 - Math.hypot(qx, qy) / 1.5);
        if (k > 0) {
          r += (120 - r) * 0.35 * k;
          gg += (50 - gg) * 0.2 * k;
          b += (170 - b) * 0.45 * k;
          const n = ((x * 2654435761) ^ (y * 40503)) >>> 0;
          if (edge >= 1.1 && n % 41 === 0 && k > 0.5) [r, gg, b] = [190, 110, 255];
        }
      }
      // A puddle: darker water with the light's colour on it.
      if (pu) {
        const ex = (x / FLOOR_PPT - pu.x) / pu.r, ey = (y / FLOOR_PPT - pu.y) / (pu.r * 0.45);
        const q = ex * ex + ey * ey;
        if (q < 1) {
          const [lr, lg, lb] = pu.color === 'orange' ? [210, 120, 50] : [150, 70, 210];
          const k = 0.35 + 0.3 * (1 - q);
          r = r * 0.55 + lr * k * 0.45;
          gg = gg * 0.55 + lg * k * 0.45;
          b = b * 0.6 + lb * k * 0.45;
          if (ey < -0.3 && Math.abs(ex) < 0.5 && (x + y) % 3 === 0) (r += 40), (gg += 30), (b += 30);
        }
      }
      const o = (y * W + x) * 4;
      d[o] = r;
      d[o + 1] = gg;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

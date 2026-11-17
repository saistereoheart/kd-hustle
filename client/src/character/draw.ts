// Procedural chibi character renderer (Canvas 2D). Draws ONE frame of a character in a
// 56×72 logical box with the feet at (28, 68). Each body part is a small function so parts
// can be swapped and recoloured from the appearance JSON. Three views are drawn:
// front (walking down), back (walking up) and side (walking left; right = mirrored).
import type { Appearance, CharacterConfig } from '@kh/shared';
import { CAP_VOLUME, HAIR_STYLES, type HairStyle } from './hairStyles';

export type View = 'front' | 'back' | 'side';

export interface Pose {
  view: View;
  bob?: number;
  /** front/back: foot lift 0..1. side: leg swing -1..1 (L = near leg). */
  legL?: number;
  legR?: number;
  /** Arm angle in radians. front/back: raise outward from hanging. side: swing forward. */
  armL?: number;
  armR?: number;
  /** Elbow bend in radians (adds to the forearm angle). */
  bendL?: number;
  bendR?: number;
  tilt?: number;
  eyes?: 'closed' | 'happy';
  mouth?: string;
  tears?: number;
  /** Sitting on the ground (front view): body lowered, legs folded. */
  sit?: boolean;
}

export const FRAME_W = 56;
export const FRAME_H = 72;
const FEET_Y = 68;
const CX = 28;
const INK = '#2b1d16';

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------- colour helpers
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** amt < 0 darkens, > 0 lightens (-1..1). */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = rgb(hex);
  const f = (c: number) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function luminance(hex: string) {
  const [r, g, b] = rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// ---------------------------------------------------------------- shape helpers
function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string, stroke?: string, lw = 1) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}
function fillStroke(ctx: Ctx, fill: string, stroke?: string, lw = 1) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
function line(ctx: Ctx, pts: number[], color: string, lw: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ---------------------------------------------------------------- body metrics
interface M {
  a: Appearance;
  hair: HairStyle;
  /** Wearing a cap/beanie/songkok (not a tudung). */
  hatted: boolean;
  cover: boolean;
  bw: number;
  legLen: number;
  hipY: number;
  shoulderY: number;
  headCY: number;
  rx: number;
  ry: number;
  bodyW: number;
  armLen: number;
  skinLine: string;
  browColor: string;
}

function metrics(a: Appearance, cfg: CharacterConfig): M {
  const hs = cfg.heights.find((h) => h.id === a.height)?.scale ?? 1;
  const bw = cfg.builds.find((b) => b.id === a.build)?.width ?? 1;
  const legLen = 11 * hs;
  const torsoLen = 13 * hs;
  const hipY = FEET_Y - 2 - legLen;
  const shoulderY = hipY - torsoLen;
  const cover = cfg.headwear.find((h) => h.id === a.headwear)?.coversHair ?? false;
  let hair = HAIR_STYLES[a.hair] ?? HAIR_STYLES.crew;
  const hatted = !cover && a.headwear !== 'none';
  if (hatted) {
    // Under a hat the hair is "flattened": nothing pokes through the crown, but fringe,
    // side hair and anything hanging below the hat still shows.
    const flatCap = hair.cap === 'spiky' || hair.cap === 'mohawk' || hair.cap === 'curly' || hair.cap === 'volume' ? 'normal' : hair.cap;
    const extra = hair.extra === 'bun' || hair.extra === 'topknot' || hair.extra === 'quiff' ? undefined : hair.extra;
    hair = { ...hair, cap: flatCap, extra };
  }
  return {
    a,
    hair,
    hatted,
    cover,
    bw,
    legLen,
    hipY,
    shoulderY,
    headCY: shoulderY - 10.5,
    rx: 13,
    ry: 12.5,
    bodyW: 17 * bw,
    armLen: 12 * hs,
    skinLine: shade(a.skin, -0.3),
    browColor: a.browColor ?? a.hairColor,
  };
}

// ---------------------------------------------------------------- legs, shoes, bottoms
const LONG_BOTTOMS = new Set(['jeans', 'slacks', 'joggers']);

function drawShoe(ctx: Ctx, m: M, x: number, y: number, view: View) {
  const c = m.a.shoesColor;
  const dk = shade(c, -0.35);
  const s = m.a.shoes;
  const side = view === 'side';
  const w = side ? 4.6 : 3.6;
  const ox = side ? -1.6 : 0;
  if (s === 'selipar') {
    ellipse(ctx, x + ox, y + 0.6, w, 1.4, shade(c, -0.2));
    ellipse(ctx, x + ox, y - 0.3, w - 1, 1.5, m.a.skin, m.skinLine, 0.6);
    line(ctx, [x + ox - 1.6, y - 0.8, x + ox, y + 0.2, x + ox + 1.6, y - 0.8], c, 1.1);
  } else if (s === 'boots') {
    rrect(ctx, x - 3.2 + (side ? -1 : 0), y - 5, side ? 7.4 : 6.4, 6, 2);
    fillStroke(ctx, c, dk, 0.8);
    line(ctx, [x - 3 + (side ? -1 : 0), y + 0.6, x + 3.2, y + 0.6], dk, 1.2);
  } else if (s === 'loafers') {
    ellipse(ctx, x + ox, y - 0.2, w, 2, shade(c, -0.15), dk, 0.8);
    line(ctx, [x + ox - 1.5, y - 1.2, x + ox + 1.5, y - 1.2], shade(c, 0.3), 0.7);
  } else if (s === 'heels') {
    ellipse(ctx, x + ox - (side ? 1 : 0), y - 0.6, w - 0.6, 1.8, c, dk, 0.8);
    line(ctx, [x + (side ? 2.2 : 0), y - 0.4, x + (side ? 2.2 : 0), y + 1.4], dk, 1.1);
  } else {
    // sneakers
    ellipse(ctx, x + ox, y - 0.6, w, 2.3, c, dk, 0.8);
    line(ctx, [x + ox - w + 0.6, y + 1, x + ox + w - 0.6, y + 1], '#ffffff', 1.2);
  }
}

function drawSittingLegs(ctx: Ctx, m: M) {
  const { a, hipY, bodyW } = m;
  const long = LONG_BOTTOMS.has(a.bottom) || a.bottom === 'sarong';
  const leg = long ? a.bottomColor : a.skin;
  for (const s of [-1, 1]) {
    const kx = CX + s * bodyW * 0.42;
    // thigh out to the knee, shin folded back under
    line(ctx, [CX + s * bodyW * 0.15, hipY, kx, hipY + 2.5], shade(leg, -0.1), 5.6);
    line(ctx, [kx, hipY + 2.5, CX + s * bodyW * 0.12, hipY + 4.5], leg, 5.2);
    if (a.bottom === 'shorts') line(ctx, [CX + s * bodyW * 0.15, hipY, kx - s * 1.2, hipY + 2], a.bottomColor, 6);
    drawShoe(ctx, m, CX + s * bodyW * 0.18, hipY + 5.6, 'front');
  }
  rrect(ctx, CX - bodyW * 0.45, hipY - 2, bodyW * 0.9, 4.5, 1.5);
  fillStroke(ctx, a.bottom === 'skirt' || a.bottom === 'sarong' || LONG_BOTTOMS.has(a.bottom) || a.bottom === 'shorts' ? a.bottomColor : a.skin, shade(a.bottomColor, -0.3), 0.8);
}

function drawLegsFrontBack(ctx: Ctx, m: M, p: Pose) {
  const { a, hipY, bodyW } = m;
  if (p.sit) return drawSittingLegs(ctx, m);
  const spread = bodyW * 0.23;
  const lw = 5.2 * Math.sqrt(m.bw);
  const pants = a.bottomColor;
  const pdk = shade(pants, -0.3);
  const long = LONG_BOTTOMS.has(a.bottom);
  const feet: Array<[number, number]> = [];
  for (const s of [-1, 1]) {
    const lift = Math.max(0, (s < 0 ? p.legL : p.legR) ?? 0);
    const fx = CX + s * spread;
    const fy = FEET_Y - 1.8 - lift * 2.6;
    feet.push([fx, fy]);
    // skin leg underneath
    rrect(ctx, fx - lw / 2, hipY, lw, fy - hipY, 2);
    fillStroke(ctx, a.skin, m.skinLine, 0.7);
    if (long) {
      rrect(ctx, fx - lw / 2 - 0.3, hipY - 1, lw + 0.6, fy - hipY + (a.bottom === 'joggers' ? 0 : 0.5), 2);
      fillStroke(ctx, pants, pdk, 0.8);
      if (a.bottom === 'jeans') line(ctx, [fx + s * 0.8, hipY + 2, fx + s * 0.8, fy - 1], shade(pants, 0.25), 0.6);
      if (a.bottom === 'slacks') line(ctx, [fx, hipY + 2, fx, fy - 1], pdk, 0.6);
      if (a.bottom === 'joggers') {
        rrect(ctx, fx - lw / 2, fy - 2.2, lw, 2.2, 1);
        fillStroke(ctx, pdk);
        line(ctx, [fx + s * (lw / 2 - 0.4), hipY + 1, fx + s * (lw / 2 - 0.4), fy - 2.5], '#ffffff', 0.8);
      }
    } else if (a.bottom === 'shorts') {
      rrect(ctx, fx - lw / 2 - 0.5, hipY - 1, lw + 1, (fy - hipY) * 0.5, 1.5);
      fillStroke(ctx, pants, pdk, 0.8);
    }
  }
  // hips / waistband
  if (long || a.bottom === 'shorts') {
    rrect(ctx, CX - bodyW * 0.45, hipY - 2, bodyW * 0.9, 4.5, 1.5);
    fillStroke(ctx, pants, pdk, 0.8);
  }
  for (const [fx, fy] of feet) drawShoe(ctx, m, fx, fy + 1.2, 'front');
  if (a.bottom === 'skirt') {
    ctx.beginPath();
    ctx.moveTo(CX - bodyW * 0.45, hipY - 2);
    ctx.lineTo(CX + bodyW * 0.45, hipY - 2);
    ctx.lineTo(CX + bodyW * 0.68, hipY + m.legLen * 0.62);
    ctx.quadraticCurveTo(CX, hipY + m.legLen * 0.72, CX - bodyW * 0.68, hipY + m.legLen * 0.62);
    ctx.closePath();
    fillStroke(ctx, pants, pdk, 0.8);
    line(ctx, [CX - 2, hipY + 1, CX - 3.5, hipY + m.legLen * 0.6], pdk, 0.5);
    line(ctx, [CX + 2, hipY + 1, CX + 3.5, hipY + m.legLen * 0.6], pdk, 0.5);
  } else if (a.bottom === 'sarong') {
    const bottom = FEET_Y - 3.5;
    ctx.beginPath();
    ctx.moveTo(CX - bodyW * 0.47, hipY - 2);
    ctx.lineTo(CX + bodyW * 0.47, hipY - 2);
    ctx.lineTo(CX + bodyW * 0.52, bottom);
    ctx.lineTo(CX - bodyW * 0.52, bottom);
    ctx.closePath();
    fillStroke(ctx, pants, pdk, 0.8);
    ctx.save();
    ctx.clip();
    for (let y = hipY + 1; y < bottom; y += 3.2) line(ctx, [CX - 12, y, CX + 12, y], shade(pants, -0.18), 0.7);
    for (let x = CX - 9; x < CX + 10; x += 3.2) line(ctx, [x, hipY, x, bottom], shade(pants, 0.18), 0.5);
    ctx.restore();
    line(ctx, [CX + 1.5, hipY, CX + 2.5, bottom], pdk, 0.7);
  }
}

function drawLegSide(ctx: Ctx, m: M, swing: number, near: boolean) {
  const { a, hipY, legLen } = m;
  const ang = swing * 0.5;
  const fx = CX - Math.sin(ang) * legLen;
  const fy = hipY + Math.cos(ang) * legLen;
  const dim = near ? 0 : -0.18;
  const lw = 5 * Math.sqrt(m.bw);
  line(ctx, [CX, hipY, fx, fy], shade(a.skin, dim), lw);
  if (LONG_BOTTOMS.has(a.bottom)) line(ctx, [CX, hipY - 1, fx, fy - 0.5], shade(a.bottomColor, dim), lw + 0.6);
  else if (a.bottom === 'shorts') line(ctx, [CX, hipY - 1, CX - Math.sin(ang) * legLen * 0.5, hipY + Math.cos(ang) * legLen * 0.5], shade(a.bottomColor, dim), lw + 0.8);
  drawShoe(ctx, m, fx, fy + 0.8, 'side');
}

function drawSkirtSide(ctx: Ctx, m: M) {
  const { a, hipY, bodyW, legLen } = m;
  const pants = a.bottomColor;
  if (a.bottom === 'skirt') {
    ctx.beginPath();
    ctx.moveTo(CX - bodyW * 0.32, hipY - 2);
    ctx.lineTo(CX + bodyW * 0.32, hipY - 2);
    ctx.lineTo(CX + bodyW * 0.5, hipY + legLen * 0.62);
    ctx.lineTo(CX - bodyW * 0.5, hipY + legLen * 0.62);
    ctx.closePath();
    fillStroke(ctx, pants, shade(pants, -0.3), 0.8);
  } else if (a.bottom === 'sarong') {
    ctx.beginPath();
    ctx.moveTo(CX - bodyW * 0.34, hipY - 2);
    ctx.lineTo(CX + bodyW * 0.34, hipY - 2);
    ctx.lineTo(CX + bodyW * 0.38, FEET_Y - 3.5);
    ctx.lineTo(CX - bodyW * 0.42, FEET_Y - 3.5);
    ctx.closePath();
    fillStroke(ctx, pants, shade(pants, -0.3), 0.8);
  }
}

// ---------------------------------------------------------------- torso + tops
function torsoBottom(m: M) {
  if (m.a.top === 'kurung') return m.hipY + m.legLen * 0.55;
  if (m.a.top === 'melayu' || m.a.top === 'blazer') return m.hipY + 2.5;
  return m.hipY + 1;
}

function drawTorso(ctx: Ctx, m: M, view: View) {
  const { a, shoulderY, bodyW } = m;
  const c = a.topColor;
  const dk = shade(c, -0.3);
  const lt = shade(c, 0.35);
  const bottom = torsoBottom(m);
  const side = view === 'side';
  const w = side ? bodyW * 0.8 : bodyW;
  const x0 = CX - w / 2 + (side ? 0.5 : 0);

  // Tank tops show bare shoulders.
  if (a.top === 'tank') {
    rrect(ctx, x0, shoulderY, w, 6, 3);
    fillStroke(ctx, a.skin, m.skinLine, 0.7);
  }
  ctx.beginPath();
  const top = a.top === 'tank' ? shoulderY + 2 : shoulderY;
  ctx.moveTo(x0 + 2, top);
  ctx.lineTo(x0 + w - 2, top);
  ctx.quadraticCurveTo(x0 + w, top, x0 + w, top + 3);
  ctx.lineTo(x0 + w * (side ? 1 : 0.97), bottom - 1);
  ctx.quadraticCurveTo(x0 + w * (side ? 1 : 0.97), bottom, x0 + w * 0.9, bottom);
  ctx.lineTo(x0 + w * 0.1, bottom);
  ctx.quadraticCurveTo(x0 + w * (side ? 0 : 0.03), bottom, x0 + w * (side ? 0 : 0.03), bottom - 1);
  ctx.lineTo(x0, top + 3);
  ctx.quadraticCurveTo(x0, top, x0 + 2, top);
  ctx.closePath();
  fillStroke(ctx, c, dk, 0.9);
  ctx.save();
  ctx.clip();
  const tg = ctx.createLinearGradient(x0, top, x0 + w, bottom);
  tg.addColorStop(0, 'rgba(255,255,255,0.16)');
  tg.addColorStop(0.5, 'rgba(255,255,255,0)');
  tg.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = tg;
  ctx.fillRect(x0 - 1, top - 1, w + 2, bottom - top + 2);
  ctx.restore();

  if (side) {
    if (a.top === 'hoodie') ellipse(ctx, x0 + w - 0.5, shoulderY + 1.5, 3, 2.5, dk);
    if (a.top === 'blazer') line(ctx, [x0 + 1.5, shoulderY + 1, x0 + 3, shoulderY + 8], dk, 0.8);
    if (a.top === 'melayu') drawSampin(ctx, m, x0 - 0.5, w + 1);
    return;
  }
  const back = view === 'back';
  const ny = shoulderY;
  switch (a.top) {
    case 'tshirt':
      if (!back) {
        ctx.beginPath();
        ctx.arc(CX, ny, 3.4, 0, Math.PI);
        fillStroke(ctx, a.skin, dk, 0.8);
      }
      break;
    case 'polo':
      if (!back) {
        ctx.beginPath();
        ctx.moveTo(CX - 4.5, ny - 0.5);
        ctx.lineTo(CX - 0.5, ny + 3.5);
        ctx.lineTo(CX - 0.8, ny - 0.5);
        ctx.moveTo(CX + 4.5, ny - 0.5);
        ctx.lineTo(CX + 0.5, ny + 3.5);
        ctx.lineTo(CX + 0.8, ny - 0.5);
        fillStroke(ctx, lt, dk, 0.6);
        line(ctx, [CX, ny + 3.5, CX, ny + 7], dk, 0.6);
        ellipse(ctx, CX, ny + 5, 0.5, 0.5, '#ffffff');
      } else line(ctx, [CX - 4, ny + 0.5, CX + 4, ny + 0.5], lt, 1.2);
      break;
    case 'hoodie':
      if (!back) {
        ctx.beginPath();
        ctx.moveTo(CX - 5.5, ny - 0.5);
        ctx.quadraticCurveTo(CX, ny + 6, CX + 5.5, ny - 0.5);
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = dk;
        ctx.stroke();
        line(ctx, [CX - 1.5, ny + 2.5, CX - 1.8, ny + 7], '#ffffff', 0.7);
        line(ctx, [CX + 1.5, ny + 2.5, CX + 1.8, ny + 7], '#ffffff', 0.7);
        rrect(ctx, CX - bodyW * 0.3, m.hipY - 5, bodyW * 0.6, 4, 1.5);
        fillStroke(ctx, shade(c, -0.12), dk, 0.6);
      } else {
        ctx.beginPath();
        ctx.ellipse(CX, ny + 3, 6, 4.5, 0, 0, Math.PI * 2);
        fillStroke(ctx, shade(c, -0.12), dk, 0.8);
      }
      break;
    case 'kemeja':
      if (!back) {
        ctx.beginPath();
        ctx.moveTo(CX - 4.5, ny - 0.8);
        ctx.lineTo(CX - 0.3, ny + 3);
        ctx.lineTo(CX - 1, ny - 0.8);
        ctx.moveTo(CX + 4.5, ny - 0.8);
        ctx.lineTo(CX + 0.3, ny + 3);
        ctx.lineTo(CX + 1, ny - 0.8);
        fillStroke(ctx, lt, dk, 0.6);
        line(ctx, [CX, ny + 3, CX, bottom - 1], dk, 0.6);
        for (let y = ny + 5; y < bottom - 1; y += 3) ellipse(ctx, CX + 0.9, y, 0.45, 0.45, dk);
      } else line(ctx, [CX - 4, ny + 0.5, CX + 4, ny + 0.5], lt, 1.2);
      break;
    case 'blazer':
      if (!back) {
        ctx.beginPath();
        ctx.moveTo(CX - 4, ny);
        ctx.lineTo(CX + 4, ny);
        ctx.lineTo(CX, ny + 9);
        ctx.closePath();
        fillStroke(ctx, '#f8f9fa', '#adb5bd', 0.5);
        ctx.beginPath();
        ctx.moveTo(CX - 4.5, ny);
        ctx.lineTo(CX - 1, ny + 9);
        ctx.lineTo(CX - 5.5, ny + 4);
        ctx.moveTo(CX + 4.5, ny);
        ctx.lineTo(CX + 1, ny + 9);
        ctx.lineTo(CX + 5.5, ny + 4);
        fillStroke(ctx, dk);
        line(ctx, [CX, ny + 9, CX, bottom - 1], dk, 0.7);
        ellipse(ctx, CX + 1.2, ny + 11, 0.6, 0.6, lt);
      } else line(ctx, [CX, ny + 4, CX, bottom - 1], dk, 0.6);
      break;
    case 'jersey': {
      line(ctx, [CX - bodyW / 2 + 1, ny + 1.2, CX - 3.5, ny + 1.2], '#ffffff', 1.4);
      line(ctx, [CX + 3.5, ny + 1.2, CX + bodyW / 2 - 1, ny + 1.2], '#ffffff', 1.4);
      if (!back) {
        ctx.beginPath();
        ctx.moveTo(CX - 3, ny);
        ctx.lineTo(CX, ny + 4);
        ctx.lineTo(CX + 3, ny);
        fillStroke(ctx, a.skin, '#ffffff', 0.9);
      }
      ctx.fillStyle = luminance(c) > 0.6 ? '#1f1f24' : '#ffffff';
      ctx.font = `bold ${back ? 7 : 5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('10', back ? CX : CX + 3.5, ny + (back ? 7 : 7.5));
      break;
    }
    case 'kurung':
      if (!back) {
        ctx.beginPath();
        ctx.arc(CX, ny, 3.2, 0, Math.PI);
        fillStroke(ctx, a.skin, dk, 0.7);
        line(ctx, [CX, ny + 3.2, CX, ny + 6], dk, 0.6);
        line(ctx, [CX - bodyW * 0.42, bottom - 1, CX - bodyW * 0.42, bottom - 5], dk, 0.5);
        line(ctx, [CX + bodyW * 0.42, bottom - 1, CX + bodyW * 0.42, bottom - 5], dk, 0.5);
      }
      break;
    case 'melayu':
      rrect(ctx, CX - 3.5, ny - 1, 7, 2.4, 1);
      fillStroke(ctx, dk);
      if (!back) for (let i = 0; i < 3; i++) ellipse(ctx, CX, ny + 3 + i * 2.6, 0.6, 0.6, '#f2c94c');
      drawSampin(ctx, m, CX - bodyW / 2 - 0.5, bodyW + 1);
      break;
    case 'tank':
      if (!back) {
        ctx.beginPath();
        ctx.ellipse(CX, ny + 2, 3.6, 3, 0, 0, Math.PI);
        fillStroke(ctx, a.skin, dk, 0.6);
      }
      break;
  }
}

/** The songket wrap worn over baju melayu. */
function drawSampin(ctx: Ctx, m: M, x: number, w: number) {
  const c = shade(m.a.topColor, -0.42);
  rrect(ctx, x, m.hipY - 3, w, m.legLen * 0.48, 1.5);
  fillStroke(ctx, c, shade(m.a.topColor, -0.6), 0.7);
  for (let y = m.hipY - 1; y < m.hipY + m.legLen * 0.44; y += 2.6) line(ctx, [x + 0.8, y, x + w - 0.8, y], '#d4a73a', 0.5);
}

// ---------------------------------------------------------------- arms
const SLEEVE: Record<string, number> = {
  tshirt: 0.45, polo: 0.45, jersey: 0.45, tank: 0, hoodie: 1, kemeja: 1, blazer: 1, kurung: 1, melayu: 1,
};

function drawArm(ctx: Ctx, m: M, sx: number, sy: number, dirX: number, angle: number, bend: number, dim: number) {
  // angle is measured from "hanging straight down", rotating towards dirX.
  const l1 = m.armLen * 0.5;
  const l2 = m.armLen * 0.5;
  const ex = sx + dirX * Math.sin(angle) * l1;
  const ey = sy + Math.cos(angle) * l1;
  const a2 = angle + bend;
  const hx = ex + dirX * Math.sin(a2) * l2;
  const hy = ey + Math.cos(a2) * l2;
  const skin = shade(m.a.skin, dim);
  const sleeve = SLEEVE[m.a.top] ?? 0.45;
  const top = shade(m.a.topColor, dim);
  line(ctx, [sx, sy, ex, ey, hx, hy], m.skinLine, 4.8);
  line(ctx, [sx, sy, ex, ey, hx, hy], skin, 3.8);
  if (sleeve >= 1) {
    const cx2 = ex + (hx - ex) * 0.85;
    const cy2 = ey + (hy - ey) * 0.85;
    line(ctx, [sx, sy, ex, ey, cx2, cy2], shade(m.a.topColor, dim - 0.3), 5.4);
    line(ctx, [sx, sy, ex, ey, cx2, cy2], top, 4.4);
  } else if (sleeve > 0) {
    const px = sx + (ex - sx) * (sleeve * 2);
    const py = sy + (ey - sy) * (sleeve * 2);
    line(ctx, [sx, sy, px, py], shade(m.a.topColor, dim - 0.3), 5.8);
    line(ctx, [sx, sy, px, py], top, 4.8);
  }
  ellipse(ctx, hx, hy, 2.3, 2.3, skin, m.skinLine, 0.7);
}

// ---------------------------------------------------------------- faces
function faceShape(ctx: Ctx, shape: string, cx: number, cy: number, rx: number, ry: number) {
  ctx.beginPath();
  switch (shape) {
    case 'oval':
      ctx.ellipse(cx, cy, rx * 0.93, ry * 1.06, 0, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.roundRect(cx - rx, cy - ry, rx * 2, ry * 2, 6.5);
      break;
    case 'long':
      ctx.roundRect(cx - rx * 0.88, cy - ry * 1.08, rx * 1.76, ry * 2.16, 8);
      break;
    case 'heart':
      ctx.moveTo(cx, cy + ry * 1.04);
      ctx.bezierCurveTo(cx - rx * 0.6, cy + ry * 0.95, cx - rx * 1.05, cy + ry * 0.2, cx - rx * 1.02, cy - ry * 0.2);
      ctx.bezierCurveTo(cx - rx * 1.0, cy - ry * 1.05, cx + rx * 1.0, cy - ry * 1.05, cx + rx * 1.02, cy - ry * 0.2);
      ctx.bezierCurveTo(cx + rx * 1.05, cy + ry * 0.2, cx + rx * 0.6, cy + ry * 0.95, cx, cy + ry * 1.04);
      break;
    case 'diamond':
      ctx.moveTo(cx, cy - ry * 1.02);
      ctx.quadraticCurveTo(cx + rx * 0.75, cy - ry * 0.85, cx + rx * 1.03, cy + ry * 0.05);
      ctx.quadraticCurveTo(cx + rx * 0.8, cy + ry * 0.85, cx, cy + ry * 1.03);
      ctx.quadraticCurveTo(cx - rx * 0.8, cy + ry * 0.85, cx - rx * 1.03, cy + ry * 0.05);
      ctx.quadraticCurveTo(cx - rx * 0.75, cy - ry * 0.85, cx, cy - ry * 1.02);
      break;
    default:
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  }
  ctx.closePath();
}

function drawEye(ctx: Ctx, style: string, x: number, y: number, color: string, s: number, mode?: 'closed' | 'happy') {
  if (mode === 'closed') {
    ctx.beginPath();
    ctx.arc(x, y - 0.6, 2, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = INK;
    ctx.stroke();
    return;
  }
  if (mode === 'happy' || style === 'happy' || (style === 'wink' && s > 0)) {
    ctx.beginPath();
    ctx.arc(x, y + 1.2, 2.1, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    ctx.stroke();
    return;
  }
  const highlight = (hx: number, hy: number, r: number) => ellipse(ctx, hx, hy, r, r, '#ffffff');
  switch (style) {
    case 'dot':
      ellipse(ctx, x, y, 1.3, 1.5, INK);
      break;
    case 'sleepy':
      ellipse(ctx, x, y + 0.3, 1.9, 2, color);
      ellipse(ctx, x, y + 0.6, 1, 1.1, INK);
      ctx.fillStyle = 'rgba(0,0,0,0)';
      line(ctx, [x - 2.3, y - 0.3, x + 2.3, y - 0.3], INK, 1);
      break;
    case 'wide':
      ellipse(ctx, x, y, 2.6, 2.9, '#ffffff', INK, 0.6);
      ellipse(ctx, x, y + 0.3, 1.6, 1.9, color);
      ellipse(ctx, x, y + 0.4, 0.9, 1.1, INK);
      highlight(x - 0.6, y - 0.6, 0.55);
      break;
    case 'almond':
    case 'cat': {
      ctx.beginPath();
      ctx.moveTo(x - 2.8, y + 0.3);
      ctx.quadraticCurveTo(x, y - 2.8, x + 2.8, y + 0.3);
      ctx.quadraticCurveTo(x, y + 2.2, x - 2.8, y + 0.3);
      fillStroke(ctx, '#ffffff', INK, 0.7);
      ellipse(ctx, x, y + 0.1, 1.4, 1.6, color);
      ellipse(ctx, x, y + 0.2, 0.75, 0.9, INK);
      highlight(x - 0.5, y - 0.5, 0.45);
      if (style === 'cat') line(ctx, [x + s * 2.6, y - 0.1, x + s * 4, y - 1.6], INK, 0.9);
      break;
    }
    case 'sparkle':
      ellipse(ctx, x, y, 2.3, 2.8, color, INK, 0.5);
      ellipse(ctx, x, y + 0.6, 1.3, 1.5, shade(color, -0.45));
      highlight(x - 0.7, y - 0.9, 0.9);
      highlight(x + 0.8, y + 1, 0.45);
      break;
    case 'lashes':
    default:
      ellipse(ctx, x, y, 1.9, 2.4, color);
      ellipse(ctx, x, y + 0.3, 1.1, 1.5, INK);
      highlight(x - 0.6, y - 0.9, 0.6);
      ctx.beginPath();
      ctx.arc(x, y + 0.5, 2.3, Math.PI * 1.12, Math.PI * 1.88);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = INK;
      ctx.stroke();
      if (style === 'lashes') {
        line(ctx, [x + s * 1.6, y - 1.8, x + s * 2.8, y - 2.8], INK, 0.7);
        line(ctx, [x + s * 0.4, y - 2.4, x + s * 1, y - 3.6], INK, 0.7);
      }
  }
}

function drawBrow(ctx: Ctx, style: string, x0: number, x1: number, y: number, s: number, color: string) {
  // x0 = inner end, x1 = outer end
  const pts: Record<string, [number, number, number, number]> = {
    straight: [0, 0, 0, 1.1],
    arched: [0.3, -1.2, 0.4, 1.1],
    thick: [0, -0.3, 0, 2],
    thin: [0, -0.4, 0.2, 0.6],
    angry: [1.1, 0, -0.9, 1.4],
    worried: [-1.1, 0, 0.6, 1.2],
  };
  const [innerDy, midDy, outerDy, lw] = pts[style] ?? pts.straight;
  ctx.beginPath();
  ctx.moveTo(x0, y + innerDy);
  ctx.quadraticCurveTo((x0 + x1) / 2, y + midDy - 0.6, x1, y + outerDy);
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.stroke();
  void s;
}

function drawNose(ctx: Ctx, style: string, x: number, y: number, skin: string) {
  const c = shade(skin, -0.22);
  switch (style) {
    case 'dot':
      ellipse(ctx, x, y, 0.7, 0.6, c);
      break;
    case 'line':
      line(ctx, [x + 0.3, y - 2, x - 0.6, y + 0.6, x + 0.8, y + 0.7], c, 0.8);
      break;
    case 'round':
      ctx.beginPath();
      ctx.arc(x, y, 1.3, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = c;
      ctx.stroke();
      break;
    case 'pointy':
      line(ctx, [x, y - 2, x - 1.1, y + 0.8, x + 0.6, y + 0.8], c, 0.8);
      break;
    case 'wide':
      ellipse(ctx, x, y + 0.2, 2, 0.9, c);
      break;
    default:
      ellipse(ctx, x, y, 1.1, 0.8, c);
  }
}

function drawMouth(ctx: Ctx, style: string, x: number, y: number, small = false) {
  const k = small ? 0.7 : 1;
  const red = '#b23a48';
  switch (style) {
    case 'neutral':
      line(ctx, [x - 2 * k, y, x + 2 * k, y], INK, 0.9);
      break;
    case 'grin':
      ctx.beginPath();
      ctx.moveTo(x - 3 * k, y - 0.6);
      ctx.lineTo(x + 3 * k, y - 0.6);
      ctx.quadraticCurveTo(x, y + 3.8 * k, x - 3 * k, y - 0.6);
      fillStroke(ctx, '#ffffff', INK, 0.8);
      break;
    case 'smirk':
      ctx.beginPath();
      ctx.moveTo(x - 2 * k, y + 0.3);
      ctx.quadraticCurveTo(x + 0.5, y + 1, x + 2.6 * k, y - 1);
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = INK;
      ctx.stroke();
      break;
    case 'open':
      ellipse(ctx, x, y + 0.3, 1.3 * k, 1.7 * k, red, INK, 0.7);
      break;
    case 'cat':
      ctx.beginPath();
      ctx.arc(x - 1.1 * k, y, 1.1 * k, 0, Math.PI);
      ctx.arc(x + 1.1 * k, y, 1.1 * k, 0, Math.PI);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = INK;
      ctx.stroke();
      break;
    case 'tongue':
      ctx.beginPath();
      ctx.arc(x, y - 1, 2.6 * k, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ellipse(ctx, x + 0.8, y + 1.5, 1.1 * k, 1.2 * k, '#ff7f96', INK, 0.5);
      break;
    case 'pout':
      ellipse(ctx, x, y + 0.2, 1.2 * k, 0.9 * k, '#e07a8a', INK, 0.5);
      break;
    case 'laugh':
      ctx.beginPath();
      ctx.moveTo(x - 3.2 * k, y - 1);
      ctx.lineTo(x + 3.2 * k, y - 1);
      ctx.quadraticCurveTo(x, y + 5 * k, x - 3.2 * k, y - 1);
      fillStroke(ctx, red, INK, 0.8);
      ellipse(ctx, x, y + 1.6 * k, 1.4 * k, 0.8 * k, '#ff8a9a');
      break;
    case 'cry':
      ctx.beginPath();
      ctx.arc(x, y + 2.4, 2.4 * k, 1.2 * Math.PI, 1.8 * Math.PI);
      ctx.lineWidth = 1;
      ctx.strokeStyle = INK;
      ctx.stroke();
      break;
    case 'smile':
    default:
      ctx.beginPath();
      ctx.arc(x, y - 1.2, 2.5 * k, 0.18 * Math.PI, 0.82 * Math.PI);
      ctx.lineWidth = 0.95;
      ctx.strokeStyle = INK;
      ctx.lineCap = 'round';
      ctx.stroke();
  }
}

function drawFacialHair(ctx: Ctx, m: M, cx: number, cy: number, view: View) {
  const id = m.a.facialHair;
  if (id === 'none') return;
  const c = m.a.hairColor;
  const side = view === 'side';
  const mx = side ? cx - 8.5 : cx;
  const my = cy + 6.2;
  switch (id) {
    case 'stubble':
      ctx.fillStyle = shade(c, 0.1);
      ctx.globalAlpha = 0.45;
      for (const [dx, dy] of [[-6, 4], [-4, 6.5], [-1.5, 8.5], [1.5, 8.5], [4, 6.5], [6, 4], [-2, 5.5], [2, 5.5], [0, 7]]) {
        if (side && dx > 2) continue;
        ellipse(ctx, (side ? cx - 6 : cx) + dx * (side ? 0.6 : 1), cy + dy, 0.45, 0.45, c);
      }
      ctx.globalAlpha = 1;
      break;
    case 'moustache':
    case 'handlebar':
      ctx.beginPath();
      ctx.moveTo(mx - 3.2, my + 0.6);
      ctx.quadraticCurveTo(mx, my - 1.5, mx + 3.2, my + 0.6);
      ctx.quadraticCurveTo(mx, my + 0.6, mx - 3.2, my + 0.6);
      fillStroke(ctx, c);
      if (id === 'handlebar' && !side) {
        line(ctx, [mx - 3, my + 0.4, mx - 4.6, my - 1.2], c, 1);
        line(ctx, [mx + 3, my + 0.4, mx + 4.6, my - 1.2], c, 1);
      }
      break;
    case 'goatee':
      ellipse(ctx, side ? cx - 7.5 : cx, cy + 10.2, 2, 1.8, c);
      break;
    case 'beard':
    case 'chinstrap': {
      ctx.save();
      faceShape(ctx, side ? 'round' : m.a.face, side ? cx - 0.5 : cx, cy, side ? m.rx * 0.9 : m.rx, m.ry);
      ctx.clip();
      if (id === 'beard') {
        ctx.beginPath();
        ctx.moveTo(cx - 20, cy + 2);
        ctx.lineTo(cx - m.rx + 1.5, cy + 2);
        ctx.quadraticCurveTo(cx - 4, cy + 4, side ? cx - 9 : cx - 3.5, my + 0.5);
        ctx.lineTo(side ? cx - 6 : cx + 3.5, my + 0.5);
        ctx.quadraticCurveTo(cx + 4, cy + 4, cx + m.rx - 1.5, cy + 2);
        ctx.lineTo(cx + 20, cy + 2);
        ctx.lineTo(cx + 20, cy + 20);
        ctx.lineTo(cx - 20, cy + 20);
        ctx.closePath();
        fillStroke(ctx, c);
        if (!side) ellipse(ctx, cx, my + 1.6, 2.2, 1.1, m.a.skin);
      } else {
        ctx.beginPath();
        ctx.ellipse(side ? cx - 0.5 : cx, cy, (side ? m.rx * 0.9 : m.rx) - 0.6, m.ry - 0.6, 0, 0.05 * Math.PI, 0.95 * Math.PI);
        ctx.lineWidth = 2;
        ctx.strokeStyle = c;
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
  }
}

function drawGlasses(ctx: Ctx, id: string, cx: number, ey: number, view: View) {
  if (id === 'none' || view === 'back') return;
  const frame = id === 'aviator' ? '#c9a227' : '#2b2b30';
  const lens = id === 'shades' ? 'rgba(20,20,30,0.85)' : 'rgba(200,230,255,0.25)';
  const lensAt = (x: number) => {
    ctx.beginPath();
    if (id === 'round') ctx.arc(x, ey, 3, 0, Math.PI * 2);
    else if (id === 'square') ctx.roundRect(x - 3.2, ey - 2.5, 6.4, 5, 1);
    else if (id === 'aviator' || id === 'shades') {
      ctx.moveTo(x - 3.3, ey - 2.2);
      ctx.lineTo(x + 3.3, ey - 2.2);
      ctx.quadraticCurveTo(x + 3.4, ey + 3.4, x, ey + 3);
      ctx.quadraticCurveTo(x - 3.4, ey + 3.4, x - 3.3, ey - 2.2);
    } else {
      // cat-eye
      ctx.moveTo(x - 3.4, ey - 2.4);
      ctx.lineTo(x + 3.4, ey - 2.4);
      ctx.quadraticCurveTo(x + 3, ey + 2.8, x, ey + 2.4);
      ctx.quadraticCurveTo(x - 3, ey + 2.8, x - 3.4, ey - 2.4);
    }
    fillStroke(ctx, lens, frame, 0.9);
  };
  if (view === 'side') {
    lensAt(cx - 7.2);
    line(ctx, [cx - 4, ey - 0.8, cx + 3, ey - 0.4], frame, 0.8);
    return;
  }
  lensAt(cx - 5);
  lensAt(cx + 5);
  line(ctx, [cx - 2, ey - 0.8, cx + 2, ey - 0.8], frame, 0.9);
}

// ---------------------------------------------------------------- hair
function hairlinePath(ctx: Ctx, m: M, cx: number, cy: number) {
  const { rx } = m;
  const L = cx - rx - 6;
  const R = cx + rx + 6;
  ctx.moveTo(L, -50);
  switch (m.hair.fringe) {
    case 'straight':
      ctx.lineTo(L, cy + 4);
      ctx.lineTo(cx - rx + 1, cy - 2.5);
      ctx.lineTo(cx + rx - 1, cy - 2.5);
      ctx.lineTo(R, cy + 4);
      break;
    case 'side':
      ctx.lineTo(L, cy + 3);
      ctx.lineTo(cx - rx + 1.5, cy - 1.5);
      ctx.quadraticCurveTo(cx - 2, cy - 2, cx + rx - 1, cy - 7.5);
      ctx.lineTo(R, cy + 2);
      break;
    case 'curtain':
      ctx.lineTo(L, cy + 5);
      ctx.lineTo(cx - rx + 0.5, cy + 2);
      ctx.quadraticCurveTo(cx - 3, cy - 3.5, cx, cy - 9);
      ctx.quadraticCurveTo(cx + 3, cy - 3.5, cx + rx - 0.5, cy + 2);
      ctx.lineTo(R, cy + 5);
      break;
    case 'spiky':
      ctx.lineTo(L, cy + 2);
      for (let i = 0; i <= 6; i++) {
        const x = cx - rx + 1 + (i * (2 * rx - 2)) / 6;
        ctx.lineTo(x, cy - (i % 2 === 0 ? 5.5 : 1.8));
      }
      ctx.lineTo(R, cy + 2);
      break;
    case 'messy':
      ctx.lineTo(L, cy + 3);
      ctx.lineTo(cx - rx + 1, cy - 1);
      for (let i = 1; i <= 5; i++) {
        const x = cx - rx + 1 + (i * (2 * rx - 2)) / 5;
        ctx.quadraticCurveTo(x - (rx - 1) / 5, cy + (i % 2 ? 0.5 : -1.5), x, cy - (i % 2 ? 3.5 : 2.2));
      }
      ctx.lineTo(R, cy + 3);
      break;
    case 'swoop':
      ctx.lineTo(L, cy + 1);
      ctx.lineTo(cx - rx + 2, cy - 4);
      ctx.quadraticCurveTo(cx, cy - 6, cx + rx - 2, cy - 9.5);
      ctx.lineTo(R, cy + 1);
      break;
    default:
      ctx.lineTo(L, cy + 2);
      ctx.quadraticCurveTo(cx, cy - 14, R, cy + 2);
  }
  ctx.lineTo(R, -50);
  ctx.closePath();
}

function capPath(ctx: Ctx, m: M, cx: number, cy: number) {
  const v = CAP_VOLUME[m.hair.cap];
  const rx = m.rx + v;
  const ry = m.ry + v;
  ctx.beginPath();
  switch (m.hair.cap) {
    case 'spiky': {
      const n = 13;
      for (let i = 0; i <= n; i++) {
        const t = Math.PI + (i / n) * Math.PI;
        const r = i % 2 ? 1 : 1.22;
        const x = cx + Math.cos(t) * rx * r;
        const y = cy - 1 + Math.sin(t) * ry * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(cx + rx, cy + 8);
      ctx.lineTo(cx - rx, cy + 8);
      ctx.closePath();
      break;
    }
    case 'curly':
      ctx.ellipse(cx, cy - 1, rx, ry, 0, 0, Math.PI * 2);
      for (let i = 0; i <= 9; i++) {
        const t = Math.PI * 0.95 + (i / 9) * Math.PI * 1.1;
        ctx.moveTo(cx + Math.cos(t) * rx + 3.2, cy - 1 + Math.sin(t) * ry);
        ctx.arc(cx + Math.cos(t) * rx, cy - 1 + Math.sin(t) * ry, 3.2, 0, Math.PI * 2);
      }
      break;
    case 'afro':
      ctx.ellipse(cx, cy - 4, rx, ry - 0.5, 0, 0, Math.PI * 2);
      break;
    default:
      ctx.ellipse(cx, cy - 1, rx, ry, 0, 0, Math.PI * 2);
  }
}

function hairFill(ctx: Ctx, m: M) {
  const c = m.a.hairColor;
  ctx.globalAlpha = m.hair.cap === 'buzz' || m.hair.cap === 'mohawk' ? 0.72 : 1;
  // Soft light from the top-left: lighter crown, darker ends.
  const top = m.headCY - m.ry - 8;
  const grad = ctx.createLinearGradient(CX - 8, top, CX + 8, m.headCY + 14);
  grad.addColorStop(0, shade(c, 0.22));
  grad.addColorStop(0.45, c);
  grad.addColorStop(1, shade(c, -0.25));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = shade(c, -0.35);
  ctx.stroke();
}

function backLengthY(m: M): number {
  switch (m.hair.back) {
    case 1: return m.headCY + 7;
    case 2: return m.headCY + 10;
    case 3: return m.shoulderY + 5;
    case 4: return m.shoulderY + 15;
    case 5: return m.hipY;
    default: return m.headCY;
  }
}

function backHairShape(ctx: Ctx, m: M, cx: number, cy: number, widthScale = 1) {
  const v = CAP_VOLUME[m.hair.cap];
  const narrow = m.hair.extra === 'mullet' ? 0.8 : 1;
  const w = (m.rx + v + 0.5) * narrow * widthScale;
  const bottom = backLengthY(m);
  ctx.beginPath();
  ctx.moveTo(cx - w, cy - 2);
  ctx.ellipse(cx, cy - 1, w, m.ry + v, 0, Math.PI, Math.PI * 2);
  ctx.lineTo(cx + w, bottom - 3);
  if (m.hair.wavy) {
    const n = 4;
    for (let i = n; i >= 0; i--) {
      const x = cx - w + (i * 2 * w) / n;
      ctx.quadraticCurveTo(x + w / n, bottom + 2.5, x, bottom - (i % 2 ? 1 : 0));
    }
  } else {
    ctx.quadraticCurveTo(cx + w, bottom, cx + w - 3, bottom);
    ctx.lineTo(cx - w + 3, bottom);
    ctx.quadraticCurveTo(cx - w, bottom, cx - w, bottom - 3);
  }
  ctx.closePath();
}

function drawHairExtrasBehind(ctx: Ctx, m: M, view: View) {
  const c = m.a.hairColor;
  const dk = shade(c, -0.35);
  const { headCY: cy, rx } = m;
  const tie = '#e63946';
  const ex = m.hair.extra;
  if (ex === 'pigtails' && view !== 'side') {
    for (const s of [-1, 1]) {
      ellipse(ctx, CX + s * (rx + 2.2), cy + 9, 3, 7.5, c, dk, 0.8);
      ellipse(ctx, CX + s * (rx + 1.6), cy + 2.5, 1.6, 1.2, tie);
    }
  }
  if (ex === 'pigtails' && view === 'side') {
    ellipse(ctx, CX + 4, cy + 9, 3, 7.5, c, dk, 0.8);
  }
  if (ex === 'ponytail') {
    if (view === 'front') ellipse(ctx, CX + rx - 1, cy + 5, 2.6, 6, c, dk, 0.8);
    if (view === 'side') {
      ctx.beginPath();
      ctx.moveTo(CX + rx - 3, cy - 4);
      ctx.quadraticCurveTo(CX + rx + 7, cy - 2, CX + rx + 3, cy + 13);
      ctx.quadraticCurveTo(CX + rx + 1, cy + 4, CX + rx - 4, cy + 1);
      ctx.closePath();
      fillStroke(ctx, c, dk, 0.8);
      ellipse(ctx, CX + rx - 1.5, cy - 2.5, 1.4, 1.8, tie);
    }
  }
  if (ex === 'braid' && view === 'side') {
    for (let i = 0; i < 5; i++) ellipse(ctx, CX + rx - 3, cy + 5 + i * 3.4, 2.4, 2, c, dk, 0.7);
  }
}

function drawHairBackLayer(ctx: Ctx, m: M, view: View) {
  // Long hair that hangs BEHIND the body (front and side views).
  if (m.hair.cap === 'none') return;
  drawHairExtrasBehind(ctx, m, view);
  if (m.hair.back >= 1) {
    if (view === 'side') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(CX - 4, -10, 40, 100);
      ctx.clip();
      backHairShape(ctx, m, CX + 1.5, m.headCY, 0.95);
      hairFill(ctx, m);
      ctx.restore();
    } else {
      backHairShape(ctx, m, CX, m.headCY);
      hairFill(ctx, m);
    }
  }
}

function drawHairTopExtras(ctx: Ctx, m: M, cx: number) {
  const c = m.a.hairColor;
  const dk = shade(c, -0.35);
  const top = m.headCY - m.ry - CAP_VOLUME[m.hair.cap];
  if (m.hair.extra === 'bun') ellipse(ctx, cx, top - 2.5, 5.2, 4.6, c, dk, 0.9);
  if (m.hair.extra === 'topknot') ellipse(ctx, cx, top - 1.5, 3.6, 3.2, c, dk, 0.9);
  if (m.hair.extra === 'quiff') {
    ctx.beginPath();
    ctx.ellipse(cx - 3, top + 3.2, 6, 3, -0.35, 0, Math.PI * 2);
    fillStroke(ctx, c, dk, 0.9);
  }
  if (m.hair.cap === 'mohawk') {
    ctx.beginPath();
    ctx.moveTo(cx - 2.6, m.headCY - 3);
    for (let i = 0; i <= 6; i++) {
      const y = m.headCY - 3 - (i / 6) * (m.ry + 3);
      ctx.lineTo(cx + (i % 2 ? -3 : 3) * 1.4, y - (i % 2 ? 2 : 0));
    }
    ctx.lineTo(cx + 2.6, m.headCY - 3);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = dk;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function drawHairHighlight(ctx: Ctx, m: M, cx: number) {
  if (!m.a.highlight || m.hair.cap === 'none' || m.hair.cap === 'buzz') return;
  const cy = m.headCY;
  ctx.save();
  capPath(ctx, m, cx, cy);
  ctx.clip();
  line(ctx, [cx - 6, cy - m.ry + 1, cx - 3, cy - 5], m.a.highlight, 1.8);
  line(ctx, [cx + 2, cy - m.ry - 0.5, cx + 6, cy - 6], m.a.highlight, 1.5);
  ctx.restore();
}

function drawHairFront(ctx: Ctx, m: M) {
  if (m.hair.cap === 'none') return;
  const cy = m.headCY;
  ctx.save();
  ctx.beginPath();
  hairlinePath(ctx, m, CX, cy);
  ctx.clip();
  if (m.hair.cap === 'undercut' || m.hair.cap === 'mohawk') {
    // shaved sides
    ctx.globalAlpha = 0.5;
    ellipse(ctx, CX, cy - 1, m.rx + 0.5, m.ry + 0.5, m.a.hairColor);
    ctx.globalAlpha = 1;
    if (m.hair.cap === 'undercut') {
      ctx.beginPath();
      ctx.rect(CX - 30, -50, 60, cy - 5 + 50);
      ctx.clip();
      capPath(ctx, m, CX, cy);
      hairFill(ctx, m);
    }
  } else {
    capPath(ctx, m, CX, cy);
    hairFill(ctx, m);
    ctx.clip();
    drawHairStrands(ctx, m, CX);
  }
  ctx.restore();
  drawSideLocks(ctx, m);
  drawHairTopExtras(ctx, m, CX);
  drawHairHighlight(ctx, m, CX);
}

/** Strand lines + a shine arc, drawn while clipped to the hair cap. */
function drawHairStrands(ctx: Ctx, m: M, cx: number) {
  const cap = m.hair.cap;
  if (cap === 'none' || cap === 'buzz') return;
  const cy = m.headCY;
  const v = CAP_VOLUME[cap];
  const top = cy - m.ry - v;
  const c = m.a.hairColor;
  if (cap === 'afro' || cap === 'curly') {
    ctx.strokeStyle = shade(c, -0.35);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = (m.rx + v) * (0.35 + (i % 3) * 0.2);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy - 4 + Math.sin(a) * r * 0.8, 1.6, 0, Math.PI * 1.3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = shade(c, -0.38);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.55;
    ctx.lineCap = 'round';
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      ctx.beginPath();
      ctx.moveTo(cx + k * 1.1, top + 1.5);
      ctx.quadraticCurveTo(cx + k * 3.1, cy - 8, cx + k * 4.4, cy - 1.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // shine
  ctx.beginPath();
  ctx.ellipse(cx - 3.5, cy - 6.5, m.rx * 0.55, 2.4, -0.35, Math.PI * 1.08, Math.PI * 1.88);
  ctx.strokeStyle = shade(c, 0.5);
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Hair at the temples that frames the face and covers the top of the ears. */
function drawSideLocks(ctx: Ctx, m: M) {
  const h = m.hair;
  if (h.cap === 'none' || h.cap === 'buzz' || h.cap === 'mohawk' || h.cap === 'undercut') return;
  const cy = m.headCY;
  const rx = m.rx;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    if (h.back >= 2) {
      const bottom = Math.min(backLengthY(m) - 1, cy + 15);
      ctx.moveTo(CX + s * (rx - 2.5), cy - 5);
      ctx.quadraticCurveTo(CX + s * (rx + 2.4), cy - 2, CX + s * (rx + 1.6), bottom);
      ctx.quadraticCurveTo(CX + s * (rx - 0.2), bottom - 1.5, CX + s * (rx - 1.6), cy + 6);
      ctx.quadraticCurveTo(CX + s * (rx - 2.4), cy + 1, CX + s * (rx - 2.5), cy - 5);
    } else {
      ctx.moveTo(CX + s * (rx - 2), cy - 5);
      ctx.quadraticCurveTo(CX + s * (rx + 1.2), cy - 3, CX + s * (rx + 0.6), cy + 2.5);
      ctx.lineTo(CX + s * (rx - 0.9), cy + 1.5);
      ctx.quadraticCurveTo(CX + s * (rx - 1.4), cy - 2, CX + s * (rx - 2), cy - 5);
    }
    ctx.closePath();
    hairFill(ctx, m);
  }
}

function drawHairBackView(ctx: Ctx, m: M) {
  if (m.hair.cap === 'none') return;
  const c = m.a.hairColor;
  const dk = shade(c, -0.35);
  const cy = m.headCY;
  if (m.hair.cap === 'mohawk' || m.hair.cap === 'undercut') {
    ctx.globalAlpha = 0.5;
    ellipse(ctx, CX, cy, m.rx + 0.5, m.ry + 0.5, c);
    ctx.globalAlpha = 1;
  }
  if (m.hair.cap !== 'mohawk') {
    ctx.save();
    if (m.hair.cap === 'undercut') {
      ctx.beginPath();
      ctx.rect(CX - 30, -50, 60, cy - 4 + 50);
      ctx.clip();
    }
    // nape first (no outline), then the cap, then the nape again to hide the cap's inner edge
    const nape = m.hair.cap !== 'undercut' && m.hair.cap !== 'buzz';
    const napeFill = () => {
      rrect(ctx, CX - m.rx + 0.5, cy - 2, 2 * m.rx - 1, 9.5, 4);
      ctx.fillStyle = m.a.hairColor;
      ctx.fill();
    };
    if (nape) napeFill();
    capPath(ctx, m, CX, cy);
    hairFill(ctx, m);
    if (nape) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(CX - m.rx + 2, cy, 2 * m.rx - 4, 10);
      ctx.clip();
      napeFill();
      ctx.restore();
    }
    ctx.restore();
  }
  if (m.hair.back >= 2) {
    backHairShape(ctx, m, CX, cy);
    hairFill(ctx, m);
  }
  const ex = m.hair.extra;
  if (ex === 'ponytail') {
    ctx.beginPath();
    ctx.moveTo(CX - 2.5, cy - 2);
    ctx.quadraticCurveTo(CX - 5, cy + 12, CX, m.shoulderY + 10);
    ctx.quadraticCurveTo(CX + 5, cy + 12, CX + 2.5, cy - 2);
    ctx.closePath();
    fillStroke(ctx, c, dk, 0.8);
    ellipse(ctx, CX, cy - 1, 2, 1.4, '#e63946');
  }
  if (ex === 'braid') {
    for (let y = cy + 6; y < m.hipY - 4; y += 3.4) ellipse(ctx, CX, y, 2.6, 2.1, c, dk, 0.7);
    ellipse(ctx, CX, m.hipY - 3, 1.5, 1.1, '#e63946');
  }
  if (ex === 'pigtails') {
    for (const s of [-1, 1]) ellipse(ctx, CX + s * (m.rx + 1.5), cy + 9, 3, 7.5, c, dk, 0.8);
  }
  drawHairTopExtras(ctx, m, CX);
}

function drawHairSide(ctx: Ctx, m: M) {
  if (m.hair.cap === 'none') return;
  const cy = m.headCY;
  ctx.save();
  // Clip away the face area (front-left of the head) so hair only covers top + back.
  ctx.beginPath();
  const fringeY = m.hair.fringe === 'none' || m.hair.fringe === 'swoop' ? cy - 6 : cy - 2.5;
  ctx.moveTo(-10, -50);
  ctx.lineTo(80, -50);
  ctx.lineTo(80, 100);
  ctx.lineTo(CX + 1.5, 100);
  ctx.lineTo(CX + 1.5, cy + 2);
  ctx.quadraticCurveTo(CX - 3, fringeY, CX - m.rx - 4, fringeY);
  ctx.lineTo(-10, fringeY);
  ctx.closePath();
  ctx.clip();
  if (m.hair.cap === 'undercut' || m.hair.cap === 'mohawk') {
    ctx.globalAlpha = 0.5;
    ellipse(ctx, CX + 0.5, cy - 0.5, m.rx * 0.95, m.ry + 0.3, m.a.hairColor);
    ctx.globalAlpha = 1;
  }
  if (m.hair.cap !== 'mohawk') {
    if (m.hair.cap === 'undercut') {
      ctx.beginPath();
      ctx.rect(-10, -50, 90, cy - 4 + 50);
      ctx.clip();
    }
    capPath(ctx, m, CX + 1, cy);
    hairFill(ctx, m);
  }
  ctx.restore();
  if (m.hair.extra === 'bun' || m.hair.extra === 'topknot') drawHairTopExtras(ctx, m, CX + 3);
  else drawHairTopExtras(ctx, m, CX);
  drawHairHighlight(ctx, m, CX);
}

// ---------------------------------------------------------------- headwear
function drawTudungDrape(ctx: Ctx, m: M, view: View) {
  const c = m.a.headwearColor;
  const dk = shade(c, -0.3);
  const { shoulderY: sy, bodyW, headCY: cy } = m;
  const w = view === 'side' ? bodyW * 0.42 : bodyW * 0.62;
  const cx = view === 'side' ? CX + 1 : CX;
  ctx.beginPath();
  switch (m.a.headwear) {
    case 'tudung_bawal':
      ctx.moveTo(cx - w, sy + 1);
      ctx.quadraticCurveTo(cx - w - 1, sy - 4, cx - m.rx + 1, cy + 4);
      ctx.lineTo(cx + m.rx - 1, cy + 4);
      ctx.quadraticCurveTo(cx + w + 1, sy - 4, cx + w, sy + 1);
      ctx.lineTo(cx, view === 'back' ? m.hipY - 3 : m.hipY - 5);
      break;
    case 'tudung_shawl':
      ctx.moveTo(cx - w, sy + 2);
      ctx.quadraticCurveTo(cx - w - 1, sy - 4, cx - m.rx + 1, cy + 4);
      ctx.lineTo(cx + m.rx - 1, cy + 4);
      ctx.quadraticCurveTo(cx + w + 2, sy - 3, cx + w + 1, sy + 4);
      ctx.lineTo(cx + w - 1, m.hipY + 2);
      ctx.lineTo(cx + w - 6, m.hipY + 1);
      ctx.quadraticCurveTo(cx, sy + 9, cx - w, sy + 2);
      break;
    case 'tudung_sport':
      ctx.moveTo(cx - m.rx + 1, cy + 4);
      ctx.lineTo(cx + m.rx - 1, cy + 4);
      ctx.lineTo(cx + w * 0.7, sy + 2.5);
      ctx.quadraticCurveTo(cx, sy + 4.5, cx - w * 0.7, sy + 2.5);
      break;
    default: // sarung
      ctx.moveTo(cx - w - 0.5, sy + 4);
      ctx.quadraticCurveTo(cx - w - 1, sy - 4, cx - m.rx + 1, cy + 4);
      ctx.lineTo(cx + m.rx - 1, cy + 4);
      ctx.quadraticCurveTo(cx + w + 1, sy - 4, cx + w + 0.5, sy + 4);
      ctx.quadraticCurveTo(cx, sy + 12, cx - w - 0.5, sy + 4);
  }
  ctx.closePath();
  fillStroke(ctx, c, dk, 0.9);
}

function drawTudungHead(ctx: Ctx, m: M, view: View) {
  const c = m.a.headwearColor;
  const dk = shade(c, -0.3);
  const cy = m.headCY;
  const cx = view === 'side' ? CX + 1 : CX;
  ellipse(ctx, cx, cy - 0.5, m.rx + 3, m.ry + 3, c, dk, 0.9);
}

function drawTudungFront(ctx: Ctx, m: M, view: View) {
  // Cloth band over the forehead, framing the face.
  const c = m.a.headwearColor;
  const dk = shade(c, -0.3);
  const cy = m.headCY;
  ctx.save();
  if (view === 'side') {
    ctx.restore();
    // fabric edge around the face opening + a fold at the back
    ctx.beginPath();
    ctx.ellipse(CX - 3.6, cy + 1.6, m.rx * 0.62 + 0.5, m.ry * 0.8 + 0.5, 0, 0, Math.PI * 2);
    ctx.strokeStyle = dk;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    line(ctx, [CX + 5, cy - 8, CX + 8, cy + 2, CX + 6, cy + 11], shade(c, -0.18), 0.8);
    return;
  }
  ctx.beginPath();
  ctx.ellipse(CX, cy - 0.5, m.rx + 3, m.ry + 3, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(CX - 30, -20);
  ctx.lineTo(CX + 30, -20);
  ctx.lineTo(CX + 30, cy - 4);
  ctx.quadraticCurveTo(CX, cy - 7.5, CX - 30, cy - 4);
  ctx.closePath();
  fillStroke(ctx, c);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(CX - m.rx + 0.5, cy - 3);
  ctx.quadraticCurveTo(CX, cy - 7.5, CX + m.rx - 0.5, cy - 3);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = dk;
  ctx.stroke();
  if (m.a.headwear === 'tudung_sarung') {
    // the little awning on a tudung sarung
    ctx.beginPath();
    ctx.ellipse(CX, cy - 5.5, 7.5, 2.3, 0, Math.PI, Math.PI * 2);
    fillStroke(ctx, shade(c, -0.1), dk, 0.7);
  }
  if (m.a.headwear === 'tudung_bawal') ellipse(ctx, CX + m.rx - 1, cy + 8, 0.9, 0.9, '#f2c94c');
}

function drawHat(ctx: Ctx, m: M, view: View) {
  const id = m.a.headwear;
  const c = m.a.headwearColor;
  const dk = shade(c, -0.3);
  const cy = m.headCY;
  // Size the hat to the hair under it so hair never pokes through the crown.
  const vol = m.hair.cap === 'afro' ? 7 : Math.min(3, CAP_VOLUME[m.hair.cap]);
  const hr = m.rx + vol + 0.8;
  const top = cy - m.ry - vol;
  const cx = view === 'side' ? CX + 1 : CX;
  if (id === 'cap' || id === 'cap_back') {
    ctx.beginPath();
    ctx.ellipse(cx, cy - 3, hr, m.ry - 1 + vol * 0.8, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    fillStroke(ctx, c, dk, 0.9);
    ellipse(ctx, cx, top + 0.6, 1.2, 0.8, dk);
    const brimFront = id === 'cap' ? view !== 'back' : view === 'back';
    if (view === 'side') {
      const dir = id === 'cap' ? -1 : 1;
      ctx.beginPath();
      ctx.ellipse(cx + dir * (hr - 0.5), cy - 3, 6.5, 1.7, 0, 0, Math.PI * 2);
      fillStroke(ctx, dk);
    } else if (brimFront) {
      ctx.beginPath();
      ctx.ellipse(cx, cy - 2.6, hr - 0.2, 3.2, 0, 0, Math.PI);
      fillStroke(ctx, dk);
    } else {
      rrect(ctx, cx - 3, cy - 4.5, 6, 2.2, 1);
      fillStroke(ctx, dk);
    }
  } else if (id === 'beanie') {
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, hr, m.ry + 0.5 + vol, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    fillStroke(ctx, c, dk, 0.9);
    for (let k = -2; k <= 2; k++) line(ctx, [cx + k * 3, cy - 4, cx + k * 2.2, top + 2], shade(c, -0.15), 0.6);
    rrect(ctx, cx - hr, cy - 4, 2 * hr, 3.6, 1.5);
    fillStroke(ctx, dk);
    ellipse(ctx, cx, top - 2.5, 2.4, 2.4, shade(c, 0.3), dk, 0.6);
  } else if (id === 'songkok') {
    rrect(ctx, cx - hr + 1.5, top - 1.5, 2 * hr - 3, cy - 3 - (top - 1.5), 1.5);
    fillStroke(ctx, c, dk, 0.9);
    ellipse(ctx, cx, top - 1.3, hr - 1.5, 1.6, shade(c, 0.12), dk, 0.6);
  }
}

// ---------------------------------------------------------------- heads
function drawHeadFront(ctx: Ctx, m: M, p: Pose) {
  const { a, headCY: cy, rx, ry } = m;
  if (!m.cover) {
    rrect(ctx, CX - 3, cy + 7, 6, m.shoulderY - cy - 6, 2);
    fillStroke(ctx, shade(a.skin, -0.1));
    ellipse(ctx, CX, cy + ry - 0.5, 3.4, 2, 'rgba(0,0,0,0.2)');
    for (const s of [-1, 1]) {
      ellipse(ctx, CX + s * rx, cy + 1.5, 2.6, 3, a.skin, m.skinLine, 0.8);
      ctx.beginPath();
      ctx.arc(CX + s * rx, cy + 1.6, 1.2, s < 0 ? Math.PI * 0.6 : -Math.PI * 0.4, s < 0 ? Math.PI * 1.4 : Math.PI * 0.4);
      ctx.strokeStyle = shade(a.skin, -0.25);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
  faceShape(ctx, a.face, CX, cy, rx, ry);
  fillStroke(ctx, a.skin, m.skinLine, 1);
  ctx.save();
  faceShape(ctx, a.face, CX, cy, rx, ry);
  ctx.clip();
  const fg = ctx.createLinearGradient(CX - rx, cy - ry, CX + rx * 0.6, cy + ry);
  fg.addColorStop(0, 'rgba(255,255,255,0.14)');
  fg.addColorStop(0.55, 'rgba(255,255,255,0)');
  fg.addColorStop(1, 'rgba(60,20,0,0.12)');
  ctx.fillStyle = fg;
  ctx.fillRect(CX - rx - 2, cy - ry - 2, rx * 2 + 4, ry * 2 + 4);
  ctx.restore();
  if (a.blush || p.eyes === 'happy') {
    ellipse(ctx, CX - 7.5, cy + 5, 2.6, 1.5, 'rgba(255,105,120,0.35)');
    ellipse(ctx, CX + 7.5, cy + 5, 2.6, 1.5, 'rgba(255,105,120,0.35)');
  }
  if (a.freckles) for (const [x, y] of [[-4.5, 3.6], [-6.2, 4.6], [-3.5, 5.2], [4.5, 3.6], [6.2, 4.6], [3.5, 5.2]])
    ellipse(ctx, CX + x, cy + y, 0.45, 0.45, shade(a.skin, -0.35));
  if (a.beautyMark) ellipse(ctx, CX + 5.5, cy + 7.4, 0.65, 0.65, INK);
  const ey = cy + 1;
  drawEye(ctx, a.eyes, CX - 5, ey, a.eyeColor, -1, p.eyes);
  drawEye(ctx, a.eyes, CX + 5, ey, a.eyeColor, 1, p.eyes);
  drawBrow(ctx, a.brows, CX - 2.6, CX - 7.2, cy - 3.6, -1, m.browColor);
  drawBrow(ctx, a.brows, CX + 2.6, CX + 7.2, cy - 3.6, 1, m.browColor);
  drawNose(ctx, a.nose, CX, cy + 4.3, a.skin);
  drawFacialHair(ctx, m, CX, cy, 'front');
  drawMouth(ctx, p.mouth ?? a.mouth, CX, cy + 7.8);
  if (p.tears) {
    const t = p.tears === 1 ? 0 : 2.5;
    for (const s of [-1, 1]) {
      ellipse(ctx, CX + s * 6, cy + 4.5 + t, 1, 1.5, 'rgba(90,170,255,0.9)');
      ellipse(ctx, CX + s * 6.5, cy + 8 + t, 0.8, 1.2, 'rgba(90,170,255,0.75)');
    }
  }
}

function drawHeadBack(ctx: Ctx, m: M) {
  const { a, headCY: cy, rx, ry } = m;
  if (!m.cover) {
    rrect(ctx, CX - 3, cy + 7, 6, m.shoulderY - cy - 6, 2);
    fillStroke(ctx, shade(a.skin, -0.1));
    ellipse(ctx, CX - rx, cy + 1.5, 2.6, 3, a.skin, m.skinLine, 0.8);
    ellipse(ctx, CX + rx, cy + 1.5, 2.6, 3, a.skin, m.skinLine, 0.8);
  }
  faceShape(ctx, a.face, CX, cy, rx, ry);
  fillStroke(ctx, a.skin, m.skinLine, 1);
}

function drawHeadSide(ctx: Ctx, m: M, p: Pose) {
  const { a, headCY: cy, rx, ry } = m;
  const hx = CX - 0.5;
  if (!m.cover) {
    rrect(ctx, CX - 2, cy + 7, 5, m.shoulderY - cy - 6, 2);
    fillStroke(ctx, shade(a.skin, -0.1));
  }
  // With a tudung only the face shows, as an oval opening at the front.
  const faceRx = m.cover ? rx * 0.62 : rx * 0.9;
  const fx = m.cover ? CX - 3.6 : hx;
  ellipse(ctx, fx, m.cover ? cy + 1.6 : cy, faceRx, m.cover ? ry * 0.8 : ry, a.skin, m.skinLine, 1);
  // nose bump
  ellipse(ctx, fx - faceRx + 0.4, cy + 4, 1.8, 1.5, a.skin, m.skinLine, 0.7);
  ellipse(ctx, fx - faceRx + 1.9, cy + 4, 1.5, 1.8, a.skin);
  if (!m.cover) ellipse(ctx, CX + 3, cy + 1.5, 2.3, 2.8, a.skin, m.skinLine, 0.8);
  if (a.blush || p.eyes === 'happy') ellipse(ctx, CX - 5.5, cy + 5, 2.2, 1.4, 'rgba(255,105,120,0.35)');
  if (a.freckles) for (const [x, y] of [[-6, 3.6], [-4.5, 4.6]]) ellipse(ctx, CX + x, cy + y, 0.45, 0.45, shade(a.skin, -0.35));
  drawEye(ctx, a.eyes === 'wink' ? 'round' : a.eyes, CX - 7, cy + 1, a.eyeColor, -1, p.eyes);
  drawBrow(ctx, a.brows, CX - 5, CX - 9.5, cy - 3.6, -1, m.browColor);
  drawFacialHair(ctx, m, CX, cy, 'side');
  const mouth = p.mouth ?? a.mouth;
  drawMouth(ctx, mouth === 'grin' || mouth === 'laugh' ? 'open' : mouth === 'neutral' ? 'neutral' : 'smile', CX - 8.3, cy + 7.8, true);
}

// ---------------------------------------------------------------- frame
export function drawCharacter(ctx: Ctx, a: Appearance, cfg: CharacterConfig, p: Pose) {
  const m = metrics(a, cfg);
  ctx.save();
  // ground shadow (doesn't bob)
  ellipse(ctx, CX, FEET_Y, (p.sit ? 14 : 12) * m.bw, 3.4, 'rgba(0,0,0,0.22)');
  ctx.translate(0, (p.bob ?? 0) + (p.sit ? m.legLen * 0.62 : 0));
  if (p.tilt) {
    ctx.translate(CX, FEET_Y);
    ctx.rotate(p.tilt);
    ctx.translate(-CX, -FEET_Y);
  }
  const shoulderX = m.bodyW / 2 - 1.2;
  const sy = m.shoulderY + 2.5;
  const isHat = a.headwear !== 'none' && !m.cover;

  if (p.view === 'side') {
    if (!m.cover) drawHairBackLayer(ctx, m, 'side');
    drawArm(ctx, m, CX + 1, sy, -1, (p.armR ?? 0) * -1, -(p.bendR ?? 0), -0.18);
    drawLegSide(ctx, m, p.legR ?? 0, false);
    drawLegSide(ctx, m, p.legL ?? 0, true);
    drawSkirtSide(ctx, m);
    drawTorso(ctx, m, 'side');
    if (m.cover) drawTudungDrape(ctx, m, 'side');
    if (m.cover) drawTudungHead(ctx, m, 'side');
    drawHeadSide(ctx, m, p);
    if (!m.cover) drawHairSide(ctx, m);
    else drawTudungFront(ctx, m, 'side');
    drawGlasses(ctx, a.glasses, CX, m.headCY + 1, 'side');
    if (isHat) drawHat(ctx, m, 'side');
    drawArm(ctx, m, CX + 1, sy, -1, p.armL ?? 0, p.bendL ?? 0, 0);
  } else if (p.view === 'back') {
    drawLegsFrontBack(ctx, m, p);
    drawTorso(ctx, m, 'back');
    drawArm(ctx, m, CX - shoulderX, sy, -1, 0.12 + (p.armL ?? 0), p.bendL ?? 0, 0);
    drawArm(ctx, m, CX + shoulderX, sy, 1, 0.12 + (p.armR ?? 0), p.bendR ?? 0, 0);
    if (m.cover) {
      drawTudungHead(ctx, m, 'back');
      drawTudungDrape(ctx, m, 'back');
    } else {
      drawHeadBack(ctx, m);
      drawHairBackView(ctx, m);
      if (isHat) drawHat(ctx, m, 'back');
    }
  } else {
    if (!m.cover) drawHairBackLayer(ctx, m, 'front');
    drawLegsFrontBack(ctx, m, p);
    drawTorso(ctx, m, 'front');
    if (m.cover) drawTudungDrape(ctx, m, 'front');
    // Arms raised above the shoulder (waving, cheering) are drawn in front of the head.
    const raisedL = (p.armL ?? 0) > 1.4;
    const raisedR = (p.armR ?? 0) > 1.4;
    const armL = () => drawArm(ctx, m, CX - shoulderX, sy, -1, 0.12 + (p.armL ?? 0), p.bendL ?? 0, 0);
    const armR = () => drawArm(ctx, m, CX + shoulderX, sy, 1, 0.12 + (p.armR ?? 0), p.bendR ?? 0, 0);
    if (!raisedL) armL();
    if (!raisedR) armR();
    if (m.cover) drawTudungHead(ctx, m, 'front');
    drawHeadFront(ctx, m, p);
    if (!m.cover) drawHairFront(ctx, m);
    else drawTudungFront(ctx, m, 'front');
    drawGlasses(ctx, a.glasses, CX, m.headCY + 1, 'front');
    if (isHat) drawHat(ctx, m, 'front');
    if (raisedL) armL();
    if (raisedR) armR();
  }
  ctx.restore();
}

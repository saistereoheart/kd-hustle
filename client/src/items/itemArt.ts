import { topVariant } from '@kh/shared';
// Item art, drawn in code. The same shape functions draw inventory/reel icons and the
// cosmetics worn on characters (baked into the character spritesheet).
//
// Coordinate conventions (in character "units", where a head is ~26 units wide):
//   hats:  origin = top-centre of the head, y up is negative
//   faces: origin = between the eyes
//   backs: origin = centre of the shoulders
import { drawFurniturePiece, furniturePiece } from './furnitureArt';
import type { ItemDef } from '@kh/shared';

type Ctx = CanvasRenderingContext2D;
export type View = 'front' | 'back' | 'side';

export interface Paint {
  c1: string;
  c2: string;
  variant: string;
}

/** Hats that sit ON the hair (hair is flattened under them) vs. ones that float above it. */
export const FLATTENING_HATS = new Set(['bucket', 'straw', 'cowboy', 'beret', 'chef', 'tophat', 'graduation', 'viking', 'songkok', 'propeller']);

function shadeHex(hex: string, amt: number): string {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Fill style for a variant: Golden → gold, Rainbow → a rainbow gradient across the bounds. */
function fillFor(ctx: Ctx, paint: Paint, base: string, x0: number, y0: number, x1: number, y1: number): string | CanvasGradient {
  if (paint.variant === 'golden') {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#fff3bf');
    g.addColorStop(0.45, '#fcc419');
    g.addColorStop(1, '#c08a00');
    return g;
  }
  if (paint.variant === 'rainbow') {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa', '#f783ac'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    return g;
  }
  return base;
}

function glints(ctx: Ctx, pts: Array<[number, number]>, size: number) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.25, y - size * 0.25);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + size * 0.25, y + size * 0.25);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size * 0.25, y + size * 0.25);
    ctx.lineTo(x - size, y);
    ctx.lineTo(x - size * 0.25, y - size * 0.25);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function outline(ctx: Ctx, color: string, lw = 0.9) {
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ------------------------------------------------------------------ hats
/** Draws a hat with its base at (0,0) = top-centre of the head; w = head half-width. */
export function drawHat(ctx: Ctx, shape: string, paint: Paint, w = 13) {
  const c1 = paint.c1;
  const c2 = paint.c2;
  const dk = shadeHex(c1, -0.35);
  const F = (base: string, x0: number, y0: number, x1: number, y1: number) => fillFor(ctx, paint, base, x0, y0, x1, y1);
  ctx.save();
  switch (shape) {
    case 'party': {
      ctx.beginPath();
      ctx.moveTo(-7, 3);
      ctx.lineTo(7, 3);
      ctx.lineTo(1, -19);
      ctx.closePath();
      ctx.fillStyle = F(c1, -7, -19, 7, 3);
      ctx.fill();
      outline(ctx, dk);
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = c2;
      ctx.lineWidth = 2;
      for (let y = -14; y < 4; y += 6) {
        ctx.beginPath();
        ctx.moveTo(-9, y + 3);
        ctx.lineTo(9, y - 1);
        ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(1, -19, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = c2;
      ctx.fill();
      break;
    }
    case 'crown': {
      ctx.beginPath();
      ctx.moveTo(-11, 3);
      ctx.lineTo(-11, -9);
      ctx.lineTo(-6, -4);
      ctx.lineTo(-2.5, -13);
      ctx.lineTo(0, -6);
      ctx.lineTo(2.5, -13);
      ctx.lineTo(6, -4);
      ctx.lineTo(11, -9);
      ctx.lineTo(11, 3);
      ctx.closePath();
      ctx.fillStyle = F(c1, -11, -13, 11, 3);
      ctx.fill();
      outline(ctx, dk);
      for (const x of [-6, 0, 6]) {
        ctx.beginPath();
        ctx.arc(x, -0.5, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = c2;
        ctx.fill();
      }
      break;
    }
    case 'durian': {
      ctx.beginPath();
      ctx.ellipse(0, -6, 10, 9, 0, 0, Math.PI * 2);
      ctx.fillStyle = F(c1, -10, -15, 10, 3);
      ctx.fill();
      outline(ctx, dk);
      ctx.fillStyle = shadeHex(c1, -0.2);
      for (let i = 0; i < 11; i++) {
        const a = Math.PI + (i / 10) * Math.PI;
        const x = Math.cos(a) * 10, y = -6 + Math.sin(a) * 9;
        ctx.beginPath();
        ctx.moveTo(x - 1.4, y);
        ctx.lineTo(x * 1.25, -6 + (y + 6) * 1.25);
        ctx.lineTo(x + 1.4, y);
        ctx.fill();
      }
      ctx.fillStyle = F(c2, -12, 0, 12, 4);
      ctx.fillRect(-12, -0.5, 24, 4);
      ctx.strokeStyle = shadeHex(c2, -0.35);
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-12, -0.5, 24, 4);
      break;
    }
    case 'bucket': {
      ctx.beginPath();
      ctx.ellipse(0, 1, w + 4, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = shadeHex(c1, -0.12);
      ctx.fill();
      outline(ctx, dk);
      ctx.beginPath();
      ctx.moveTo(-w + 1, 1);
      ctx.quadraticCurveTo(-w + 2, -11, 0, -11);
      ctx.quadraticCurveTo(w - 2, -11, w - 1, 1);
      ctx.closePath();
      ctx.fillStyle = F(c1, -w, -11, w, 1);
      ctx.fill();
      outline(ctx, dk);
      break;
    }
    case 'straw': {
      ctx.beginPath();
      ctx.ellipse(0, 1, w + 8, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = F(c1, -w - 8, -4, w + 8, 6);
      ctx.fill();
      outline(ctx, dk);
      ctx.beginPath();
      ctx.ellipse(0, -3, w - 2, 8, 0, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = F(c1, -w, -11, w, 0);
      ctx.fill();
      outline(ctx, dk);
      ctx.fillStyle = c2;
      ctx.fillRect(-w + 2, -3.5, 2 * w - 4, 2.5);
      break;
    }
    case 'beret': {
      ctx.beginPath();
      ctx.ellipse(2, -3, w + 2, 6, -0.12, 0, Math.PI * 2);
      ctx.fillStyle = F(c1, -w, -9, w + 4, 3);
      ctx.fill();
      outline(ctx, dk);
      ctx.beginPath();
      ctx.arc(3, -9, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = dk;
      ctx.fill();
      break;
    }
    case 'chef': {
      ctx.fillStyle = F(c1, -11, -22, 11, 3);
      ctx.beginPath();
      for (const [x, y, r] of [[-6, -12, 7], [0, -16, 7.5], [6, -12, 7]] as const) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      outline(ctx, '#ced4da');
      ctx.fillStyle = F(c1, -10, -6, 10, 3);
      ctx.fillRect(-10, -6, 20, 8);
      ctx.strokeStyle = '#ced4da';
      ctx.strokeRect(-10, -6, 20, 8);
      break;
    }
    case 'cowboy': {
      ctx.beginPath();
      ctx.moveTo(-w - 8, -4);
      ctx.quadraticCurveTo(-w - 6, 3, 0, 3);
      ctx.quadraticCurveTo(w + 6, 3, w + 8, -4);
      ctx.quadraticCurveTo(w, 0, 0, 0);
      ctx.quadraticCurveTo(-w, 0, -w - 8, -4);
      ctx.fillStyle = F(shadeHex(c1, -0.1), -w - 8, -4, w + 8, 3);
      ctx.fill();
      outline(ctx, dk);
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(-8, -12);
      ctx.quadraticCurveTo(0, -9, 8, -12);
      ctx.lineTo(9, 0);
      ctx.closePath();
      ctx.fillStyle = F(c1, -9, -12, 9, 0);
      ctx.fill();
      outline(ctx, dk);
      ctx.fillStyle = dk;
      ctx.fillRect(-9, -3, 18, 2.2);
      break;
    }
    case 'bunny':
    case 'cat_ears': {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        if (shape === 'bunny') ctx.ellipse(s * 5, -12, 3.6, 11, s * 0.12, 0, Math.PI * 2);
        else {
          ctx.moveTo(s * 11, 1);
          ctx.lineTo(s * 9, -13);
          ctx.lineTo(s * 2, -2);
          ctx.closePath();
        }
        ctx.fillStyle = F(c1, -11, -23, 11, 1);
        ctx.fill();
        outline(ctx, dk);
        ctx.beginPath();
        if (shape === 'bunny') ctx.ellipse(s * 5, -12, 1.6, 8, s * 0.12, 0, Math.PI * 2);
        else {
          ctx.moveTo(s * 9.5, -1);
          ctx.lineTo(s * 8.6, -9.5);
          ctx.lineTo(s * 4.2, -2);
          ctx.closePath();
        }
        ctx.fillStyle = c2;
        ctx.fill();
      }
      break;
    }
    case 'halo': {
      ctx.beginPath();
      ctx.ellipse(0, -9, 11, 3.6, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,240,180,0.45)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = F(c1, -11, -12, 11, -6) as string;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      break;
    }
    case 'propeller': {
      ctx.beginPath();
      ctx.ellipse(0, -1, w - 1, 9, 0, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = F(c1, -w, -10, w, 0);
      ctx.fill();
      outline(ctx, dk);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = c2;
      ctx.fillRect(-3, -12, 6, 12);
      ctx.restore();
      ctx.fillStyle = '#495057';
      ctx.fillRect(-0.6, -14, 1.2, 4);
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.ellipse(-5, -14, 5, 1.5, -0.1, 0, Math.PI * 2);
      ctx.ellipse(5, -14, 5, 1.5, 0.1, 0, Math.PI * 2);
      ctx.fill();
      outline(ctx, shadeHex(c2, -0.4), 0.6);
      break;
    }
    case 'tophat': {
      ctx.beginPath();
      ctx.ellipse(0, 1, w + 3, 3.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = F(c1, -w - 3, -2, w + 3, 4);
      ctx.fill();
      outline(ctx, '#495057');
      ctx.beginPath();
      ctx.roundRect(-9, -19, 18, 20, 2);
      ctx.fillStyle = F(c1, -9, -19, 9, 1);
      ctx.fill();
      outline(ctx, '#495057');
      ctx.fillStyle = c2;
      ctx.fillRect(-9, -5, 18, 3);
      break;
    }
    case 'graduation': {
      ctx.beginPath();
      ctx.ellipse(0, -1, w - 2, 7, 0, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = F(c1, -w, -8, w, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(16, -8);
      ctx.lineTo(0, -3);
      ctx.lineTo(-16, -8);
      ctx.closePath();
      ctx.fillStyle = F(c1, -16, -13, 16, -3);
      ctx.fill();
      outline(ctx, '#495057');
      ctx.strokeStyle = c2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(10, -6);
      ctx.lineTo(11, 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(11, 3, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = c2;
      ctx.fill();
      break;
    }
    case 'viking': {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 9, -5);
        ctx.quadraticCurveTo(s * 19, -6, s * 18, -18);
        ctx.quadraticCurveTo(s * 14, -9, s * 7, -9);
        ctx.closePath();
        ctx.fillStyle = F(c2, -19, -18, 19, -5);
        ctx.fill();
        outline(ctx, '#adb5bd');
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, w, 12, 0, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = F(c1, -w, -12, w, 0);
      ctx.fill();
      outline(ctx, dk);
      ctx.fillStyle = shadeHex(c1, 0.25);
      ctx.fillRect(-1.2, -12, 2.4, 12);
      break;
    }
    case 'antenna': {
      ctx.beginPath();
      ctx.ellipse(0, 1, w - 0.5, 9, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.strokeStyle = F(c1, -w, -9, w, 1) as string;
      ctx.lineWidth = 2;
      ctx.stroke();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 6, -7);
        ctx.quadraticCurveTo(s * 11, -13, s * 8, -19);
        ctx.strokeStyle = '#495057';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s * 8, -20.5, 3, 0, Math.PI * 2);
        ctx.fillStyle = F(c2, s * 8 - 3, -23, s * 8 + 3, -17);
        ctx.fill();
        outline(ctx, shadeHex(c2, -0.4), 0.7);
      }
      break;
    }
    case 'songkok': {
      ctx.beginPath();
      ctx.roundRect(-w + 1.5, -11, 2 * w - 3, 12, 1.5);
      ctx.fillStyle = F(c1, -w, -11, w, 1);
      ctx.fill();
      outline(ctx, '#000000');
      ctx.beginPath();
      ctx.ellipse(0, -11, w - 1.5, 1.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = shadeHex(c1, 0.15);
      ctx.fill();
      ctx.strokeStyle = c2;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-w + 2, -3);
      ctx.lineTo(w - 2, -3);
      ctx.stroke();
      for (let x = -w + 4; x < w - 3; x += 4) {
        ctx.beginPath();
        ctx.arc(x, -6.5, 0.9, 0, Math.PI * 2);
        ctx.fillStyle = c2;
        ctx.fill();
      }
      break;
    }
    default: {
      ctx.beginPath();
      ctx.ellipse(0, -2, w, 8, 0, Math.PI, Math.PI * 2);
      ctx.fillStyle = F(c1, -w, -10, w, 0);
      ctx.fill();
    }
  }
  if (paint.variant === 'shiny' || paint.variant === 'rainbow') glints(ctx, [[-6, -8], [7, -3]], 2.2);
  ctx.restore();
}

// ------------------------------------------------------------------ face items
/** origin = between the eyes; view 'side' draws one lens at the near eye (x = -7). */
export function drawFace(ctx: Ctx, shape: string, paint: Paint, view: View) {
  if (view === 'back') return;
  const lenses = view === 'side' ? [-7] : [-5, 5];
  const F = (x0: number, y0: number, x1: number, y1: number) => fillFor(ctx, paint, paint.c1, x0, y0, x1, y1);
  ctx.save();
  for (const x of lenses) {
    ctx.beginPath();
    if (shape === 'star_shades') {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 1.9 : 4.2;
        ctx.lineTo(x + Math.cos(a) * r, Math.sin(a) * r + 0.4);
      }
      ctx.closePath();
      ctx.fillStyle = F(x - 4, -4, x + 4, 4);
      ctx.fill();
      outline(ctx, shadeHex(paint.c1, -0.4), 0.7);
    } else if (shape === 'heart_glasses') {
      ctx.moveTo(x, 3);
      ctx.bezierCurveTo(x - 6, -1, x - 3, -5, x, -2);
      ctx.bezierCurveTo(x + 3, -5, x + 6, -1, x, 3);
      ctx.fillStyle = F(x - 4, -4, x + 4, 3);
      ctx.fill();
      outline(ctx, shadeHex(paint.c1, -0.4), 0.7);
    } else if (shape === 'nerd') {
      ctx.arc(x, 0, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,230,255,0.3)';
      ctx.fill();
      ctx.strokeStyle = F(x - 4, -4, x + 4, 4) as string;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (shape === 'diamond_shades') {
      ctx.moveTo(x, -4);
      ctx.lineTo(x + 4.2, 0);
      ctx.lineTo(x, 4);
      ctx.lineTo(x - 4.2, 0);
      ctx.closePath();
      ctx.fillStyle = F(x - 4, -4, x + 4, 4);
      ctx.fill();
      outline(ctx, '#ffffff', 0.7);
      glints(ctx, [[x + 1.5, -1.5]], 1.4);
    } else if (shape === 'monocle') {
      if (x !== lenses[lenses.length - 1]) continue;
      ctx.arc(x, 0, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,230,255,0.3)';
      ctx.fill();
      ctx.strokeStyle = F(x - 4, -4, x + 4, 4) as string;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 2.6, 2.6);
      ctx.quadraticCurveTo(x + 5, 8, x + 3, 12);
      ctx.strokeStyle = paint.c1;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
  if (lenses.length === 2 && shape !== 'monocle') {
    ctx.beginPath();
    ctx.moveTo(-1.5, -0.5);
    ctx.lineTo(1.5, -0.5);
    ctx.strokeStyle = shadeHex(paint.c1, -0.3);
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ back items
/**
 * origin = centre of the shoulders. `layer` 'behind' is drawn before the body (wings/cape
 * peeking out from behind in front view), 'front' after it (straps; full view from the back).
 */
export function drawBack(ctx: Ctx, shape: string, paint: Paint, view: View, layer: 'behind' | 'front', bodyLen = 18) {
  const c1 = paint.c1;
  const c2 = paint.c2;
  const dk = shadeHex(c1, -0.35);
  const F = (base: string, x0: number, y0: number, x1: number, y1: number) => fillFor(ctx, paint, base, x0, y0, x1, y1);
  const fromBack = view === 'back';
  ctx.save();
  if (view === 'side') ctx.translate(4, 0);
  const wing = (s: number, kind: 'bat' | 'angel' | 'phoenix') => {
    const span = view === 'side' ? 10 : 20;
    ctx.beginPath();
    ctx.moveTo(s * 3, 1);
    if (kind === 'bat') {
      ctx.quadraticCurveTo(s * span * 0.6, -12, s * span, -6);
      ctx.lineTo(s * span * 0.85, 2);
      ctx.lineTo(s * span * 0.7, -1);
      ctx.lineTo(s * span * 0.55, 6);
      ctx.lineTo(s * span * 0.4, 2);
      ctx.lineTo(s * 4, 9);
    } else {
      ctx.quadraticCurveTo(s * span * 0.5, -16, s * span, -12);
      ctx.quadraticCurveTo(s * span * 1.05, -2, s * span * 0.75, 4);
      ctx.quadraticCurveTo(s * span * 0.6, 10, s * 4, 10);
    }
    ctx.closePath();
    ctx.fillStyle = kind === 'phoenix' ? F(c1, -span, -16, span, 10) : F(c1, -span, -16, span, 10);
    ctx.fill();
    outline(ctx, kind === 'angel' ? '#ced4da' : dk);
    if (kind !== 'bat') {
      ctx.strokeStyle = kind === 'phoenix' ? c2 : '#dee2e6';
      ctx.lineWidth = 0.7;
      for (let k = 1; k <= 3; k++) {
        ctx.beginPath();
        ctx.moveTo(s * 5, 2 + k);
        ctx.quadraticCurveTo(s * span * 0.45, -6 + k * 3, s * span * (0.75 - k * 0.08), 2 + k * 2);
        ctx.stroke();
      }
    }
  };
  const showBehind = layer === 'behind' && !fromBack;
  const showFront = layer === 'front' && fromBack;
  switch (shape) {
    case 'bat_wings':
    case 'angel_wings':
    case 'phoenix_wings': {
      if (!(showBehind || showFront || (view === 'side' && layer === 'behind'))) break;
      const kind = shape === 'bat_wings' ? 'bat' : shape === 'angel_wings' ? 'angel' : 'phoenix';
      if (view === 'side') wing(1, kind);
      else for (const s of [-1, 1]) wing(s, kind);
      break;
    }
    case 'cape': {
      if (fromBack && layer === 'front') {
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.lineTo(8, 0);
        ctx.lineTo(11, bodyLen + 6);
        ctx.quadraticCurveTo(0, bodyLen + 9, -11, bodyLen + 6);
        ctx.closePath();
        ctx.fillStyle = F(c1, -11, 0, 11, bodyLen + 9);
        ctx.fill();
        outline(ctx, dk);
      } else if (layer === 'behind') {
        ctx.beginPath();
        ctx.moveTo(-9, 0);
        ctx.lineTo(-12, bodyLen + 6);
        ctx.lineTo(12, bodyLen + 6);
        ctx.lineTo(9, 0);
        ctx.closePath();
        ctx.fillStyle = F(shadeHex(c1, -0.2), -12, 0, 12, bodyLen + 6);
        ctx.fill();
      }
      break;
    }
    case 'backpack': {
      if (fromBack && layer === 'front') {
        ctx.beginPath();
        ctx.roundRect(-7, 1, 14, 15, 3);
        ctx.fillStyle = F(c1, -7, 1, 7, 16);
        ctx.fill();
        outline(ctx, dk);
        ctx.beginPath();
        ctx.roundRect(-5, 8, 10, 6, 2);
        ctx.fillStyle = shadeHex(c1, -0.15);
        ctx.fill();
      } else if (layer === 'front' && !fromBack) {
        for (const s of view === 'side' ? [1] : [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(s * 5, 0);
          ctx.lineTo(s * 6, 12);
          ctx.strokeStyle = dk;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        if (view === 'side') {
          ctx.beginPath();
          ctx.roundRect(3, 1, 7, 14, 2);
          ctx.fillStyle = F(c1, 3, 1, 10, 15);
          ctx.fill();
          outline(ctx, dk);
        }
      }
      break;
    }
    case 'jetpack': {
      const tanks = () => {
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.roundRect(s * 5 - 3.5, 0, 7, 15, 3);
          ctx.fillStyle = F(c1, -9, 0, 9, 15);
          ctx.fill();
          outline(ctx, dk);
          ctx.beginPath();
          ctx.moveTo(s * 5 - 2.5, 15);
          ctx.lineTo(s * 5, 22);
          ctx.lineTo(s * 5 + 2.5, 15);
          ctx.closePath();
          ctx.fillStyle = c2;
          ctx.fill();
        }
      };
      if (fromBack && layer === 'front') tanks();
      else if (layer === 'behind' && !fromBack) {
        ctx.save();
        ctx.scale(1.35, 1);
        tanks();
        ctx.restore();
      }
      break;
    }
  }
  if ((paint.variant === 'shiny' || paint.variant === 'rainbow') && (showBehind || showFront)) glints(ctx, [[-10, -4], [10, 2]], 2);
  ctx.restore();
}

// ------------------------------------------------------------------ icons
function drawGeneric(ctx: Ctx, def: ItemDef, paint: Paint) {
  const c = paint.c1;
  const dk = shadeHex(c, -0.35);
  const F = (x0: number, y0: number, x1: number, y1: number) => fillFor(ctx, paint, c, x0, y0, x1, y1);
  ctx.lineJoin = 'round';
  switch (def.shape) {
    case 'cup':
      ctx.beginPath();
      ctx.moveTo(-9, -8);
      ctx.lineTo(9, -8);
      ctx.lineTo(7, 10);
      ctx.lineTo(-7, 10);
      ctx.closePath();
      ctx.fillStyle = F(-9, -8, 9, 10);
      ctx.fill();
      outline(ctx, dk, 1.2);
      ctx.beginPath();
      ctx.arc(10, 0, 4, -Math.PI / 2, Math.PI / 2);
      ctx.strokeStyle = dk;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#f1e3d3';
      ctx.fillRect(-8, -8, 16, 3);
      break;
    case 'duck':
      ctx.beginPath();
      ctx.ellipse(0, 4, 11, 7, 0, 0, Math.PI * 2);
      ctx.ellipse(-4, -6, 6, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = F(-11, -12, 11, 11);
      ctx.fill();
      ctx.fillStyle = '#ff922b';
      ctx.beginPath();
      ctx.ellipse(-11, -5, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#212529';
      ctx.beginPath();
      ctx.arc(-5, -8, 1.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'coin':
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fillStyle = F(-11, -11, 11, 11);
      ctx.fill();
      outline(ctx, '#e67700', 1.5);
      ctx.fillStyle = '#e67700';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('RM', 0, 1);
      break;
    case 'furn': {
      // Airbnb furniture: its top-down art, fitted into the icon box.
      const pc = furniturePiece(def.id);
      const pw = pc?.w ?? 1, ph = pc?.h ?? 1;
      const k = 26 / Math.max(pw, ph);
      ctx.save();
      ctx.translate((-pw * k) / 2, (-ph * k) / 2);
      drawFurniturePiece(ctx, def.id, pw * k, ph * k);
      ctx.restore();
      break;
    }
    case 'chair':
      ctx.fillStyle = F(-9, -12, 9, 12);
      ctx.fillRect(-8, -12, 16, 12);
      ctx.fillRect(-10, 0, 20, 4);
      ctx.fillRect(-9, 4, 3, 9);
      ctx.fillRect(6, 4, 3, 9);
      ctx.strokeStyle = dk;
      ctx.lineWidth = 1;
      ctx.strokeRect(-8, -12, 16, 12);
      break;
    case 'fan':
      ctx.fillStyle = '#495057';
      ctx.fillRect(-1.5, 2, 3, 8);
      ctx.fillRect(-7, 10, 14, 3);
      ctx.beginPath();
      ctx.arc(0, -4, 10, 0, Math.PI * 2);
      ctx.strokeStyle = '#868e96';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = F(-10, -14, 10, 6);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(Math.cos((i * 2 * Math.PI) / 3) * 5, -4 + Math.sin((i * 2 * Math.PI) / 3) * 5, 5, 2.5, (i * 2 * Math.PI) / 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'plant':
      ctx.fillStyle = '#c4703a';
      ctx.beginPath();
      ctx.moveTo(-7, 4);
      ctx.lineTo(7, 4);
      ctx.lineTo(5, 13);
      ctx.lineTo(-5, 13);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = F(-12, -14, 12, 4);
      for (const [x, y, a] of [[-6, -4, -0.6], [6, -4, 0.6], [0, -9, 0], [-3, -12, -0.3], [4, -12, 0.3]] as const) {
        ctx.beginPath();
        ctx.ellipse(x, y, 4, 7, a, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'beanbag':
      ctx.beginPath();
      ctx.moveTo(-12, 10);
      ctx.quadraticCurveTo(-14, -10, 0, -11);
      ctx.quadraticCurveTo(14, -10, 12, 10);
      ctx.closePath();
      ctx.fillStyle = F(-12, -11, 12, 10);
      ctx.fill();
      outline(ctx, dk, 1.2);
      break;
    case 'bottle':
      ctx.fillStyle = '#dee2e6';
      ctx.fillRect(-3, -13, 6, 5);
      ctx.beginPath();
      ctx.roundRect(-7, -8, 14, 20, 4);
      ctx.fillStyle = F(-7, -8, 7, 12);
      ctx.fill();
      outline(ctx, dk, 1.2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-4, -5, 2, 12);
      break;
    case 'potion': {
      // A round flask with a cork, liquid and bubbles.
      ctx.fillStyle = '#c69c6d';
      ctx.fillRect(-3.5, -15, 7, 5);
      ctx.fillStyle = 'rgba(230, 240, 255, 0.55)';
      ctx.fillRect(-4.5, -11, 9, 6);
      ctx.beginPath();
      ctx.arc(0, 4, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(230, 240, 255, 0.35)';
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 4, 10, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = F(-10, -2, 10, 14);
      ctx.fillRect(-11, -1, 22, 16);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(0, 4, 11, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (const [x, y, r] of [[-4, 6, 1.6], [3, 9, 1.2], [1, 2, 1]] as const) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.ellipse(-5, -1, 2, 4, -0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'kopi': {
      // Kopi in a tall glass with a frothy top.
      ctx.beginPath();
      ctx.moveTo(-8, -11);
      ctx.lineTo(8, -11);
      ctx.lineTo(6, 13);
      ctx.lineTo(-6, 13);
      ctx.closePath();
      ctx.fillStyle = 'rgba(230, 240, 255, 0.35)';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-7.5, -6);
      ctx.lineTo(7.5, -6);
      ctx.lineTo(6, 12);
      ctx.lineTo(-6, 12);
      ctx.closePath();
      ctx.fillStyle = F(-7, -6, 7, 12);
      ctx.fill();
      ctx.fillStyle = '#e9d2b0';
      ctx.fillRect(-7.6, -8, 15.2, 3);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-8, -11);
      ctx.lineTo(-6, 13);
      ctx.lineTo(6, 13);
      ctx.lineTo(8, -11);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(-1, -16);
      ctx.quadraticCurveTo(2, -13, -1, -11);
      ctx.moveTo(3, -17);
      ctx.quadraticCurveTo(6, -14, 3, -12);
      ctx.stroke();
      break;
    }
    case 'name': {
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = paint.variant === 'normal' && def.id === 'rainbow_name' ? fillFor(ctx, { ...paint, variant: 'rainbow' }, c, -14, 0, 14, 0) : F(-14, 0, 14, 0);
      ctx.strokeStyle = '#11131f';
      ctx.lineWidth = 3;
      ctx.strokeText('Abc', 0, 1);
      ctx.fillText('Abc', 0, 1);
      break;
    }
    default: {
      // auras: a glowing ring with sparkles
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 13);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.5, paint.variant === 'golden' ? '#fcc419' : paint.variant === 'rainbow' ? '#da77f2' : c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      if (def.shape === 'hearts') {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('♥', 0, 4);
      } else if (def.shape === 'flame') {
        ctx.fillStyle = '#ffd43b';
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.quadraticCurveTo(7, 0, 0, 8);
        ctx.quadraticCurveTo(-7, 0, 0, -9);
        ctx.fill();
      } else if (def.shape === 'naga') {
        ctx.strokeStyle = paint.c2;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let t = 0; t < 1; t += 0.05) ctx.lineTo(Math.cos(t * 9) * 9 * (1 - t), Math.sin(t * 9) * 9 * (1 - t));
        ctx.stroke();
      } else {
        glints(ctx, [[0, 0], [-6, -5], [6, 5]], 2.5);
      }
    }
  }
}

/** A head chef's portrait: whites, a neckerchief in the item colour, a face and a toque.
 *  A cashier instead wears a polo in the item colour with a name tag, and a visor. */
function drawChefPortrait(ctx: Ctx, shape: string, paint: Paint, skin: string, cashier = false) {
  if (cashier) {
    // polo shirt in the item colour, white collar, a gold name tag
    ctx.fillStyle = paint.c1;
    ctx.beginPath();
    ctx.ellipse(0, 15, 14, 8, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-5, 7);
    ctx.lineTo(0, 10);
    ctx.lineTo(5, 7);
    ctx.lineTo(3, 6);
    ctx.lineTo(0, 8);
    ctx.lineTo(-3, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd43b';
    ctx.fillRect(3, 11, 5, 2.4);
  } else {
    // shoulders in chef whites with double buttons
    ctx.fillStyle = '#f8f9fa';
    ctx.beginPath();
    ctx.ellipse(0, 15, 14, 8, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#ced4da';
    for (const [x, y] of [[-3, 11], [3, 11], [-3, 14], [3, 14]]) ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    ctx.fillStyle = paint.c1;
    ctx.beginPath();
    ctx.moveTo(-6, 7);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 12);
    ctx.closePath();
    ctx.fill();
  }
  // face
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(0, 0, 8, 8.6, 0, 0, Math.PI * 2);
  ctx.fill();
  if (shape === 'bun') {
    ctx.fillStyle = '#343a40';
    ctx.beginPath();
    ctx.ellipse(0, -5, 8.4, 4, 0, Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = '#212529';
  ctx.beginPath();
  ctx.arc(-3, -0.5, 1.1, 0, Math.PI * 2);
  ctx.arc(3, -0.5, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#212529';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 2.5, 3, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  if (shape === 'moustache') {
    ctx.fillStyle = '#343a40';
    ctx.beginPath();
    ctx.ellipse(-2.2, 2.6, 2.6, 1.1, -0.3, 0, Math.PI * 2);
    ctx.ellipse(2.2, 2.6, 2.6, 1.1, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === 'beard') {
    ctx.fillStyle = '#495057';
    ctx.beginPath();
    ctx.ellipse(0, 6, 6, 4, 0, 0, Math.PI);
    ctx.fill();
  } else if (shape === 'glasses') {
    ctx.strokeStyle = '#212529';
    ctx.lineWidth = 0.9;
    ctx.strokeRect(-5.4, -2.4, 4.4, 3.4);
    ctx.strokeRect(1, -2.4, 4.4, 3.4);
    ctx.beginPath();
    ctx.moveTo(-1, -1);
    ctx.lineTo(1, -1);
    ctx.stroke();
  }
  if (cashier) {
    // a visor in the item colour
    ctx.fillStyle = paint.c2;
    ctx.beginPath();
    ctx.ellipse(0, -6.5, 9, 2.6, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = paint.c1;
    ctx.beginPath();
    ctx.ellipse(0, -5.6, 10.5, 2.2, 0, 0, Math.PI);
    ctx.fill();
    return;
  }
  // the toque
  ctx.save();
  ctx.translate(0, -4);
  ctx.scale(0.7, 0.7);
  drawHat(ctx, 'chef', { c1: '#ffffff', c2: '#dee2e6', variant: paint.variant });
  ctx.restore();
}

/** Draws an item icon centred in a size×size box (for inventory, reel, index). */
export function drawItemIcon(ctx: Ctx, def: ItemDef, variant: string, size: number, silhouette = false) {
  const paint: Paint = { c1: def.color, c2: def.color2 ?? shadeHex(def.color, -0.3), variant: topVariant(variant) }; // several variants: the art shows the rarest
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / 36, size / 36);
  if (def.type === 'hat') {
    ctx.translate(0, 10);
    ctx.scale(0.95, 0.95);
    drawHat(ctx, def.shape, paint);
  } else if (def.type === 'face') {
    ctx.scale(1.5, 1.5);
    drawFace(ctx, def.shape, paint, 'front');
  } else if (def.type === 'chef' || def.type === 'cashier') {
    drawChefPortrait(ctx, def.shape, def.type === 'cashier' ? { ...paint, c2: shadeHex(def.color, -0.3) } : paint, def.color2 ?? '#c68642', def.type === 'cashier');
  } else if (def.type === 'back') {
    ctx.translate(0, -6);
    ctx.scale(0.7, 0.7);
    drawBack(ctx, def.shape, paint, 'back', 'front');
    drawBack(ctx, def.shape, paint, 'back', 'behind');
    if (['bat_wings', 'angel_wings', 'phoenix_wings'].includes(def.shape)) drawBack(ctx, def.shape, paint, 'front', 'behind');
  } else {
    drawGeneric(ctx, def, paint);
  }
  ctx.restore();
  if (silhouette) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = '#2b2f42';
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }
}

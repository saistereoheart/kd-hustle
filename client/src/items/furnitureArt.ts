// Furniture drawn in code, top-down (front of the piece towards +y), for decorate mode and the
// item icons. One function per category, with a few signature pieces drawn specially.
import type { FurnitureConfig } from '@kh/shared';

type Ctx = CanvasRenderingContext2D;
let catalog: FurnitureConfig | null = null;

/** Set once at startup (from the public config). */
export function setFurnitureCatalog(c: FurnitureConfig) {
  catalog = c;
}
export function furniturePiece(item: string) {
  return catalog?.pieces[item];
}

function shade(hex: string, f: number): string {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.04);
    ctx.stroke();
  }
}
function circle(ctx: Ctx, x: number, y: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Theme colour of a piece (its wood/fabric), or a neutral grey. */
export function pieceColor(item: string): string {
  const p = furniturePiece(item);
  const t = p?.theme ? catalog?.themes[p.theme]?.color : undefined;
  return t ?? '#adb5bd';
}

/** Draws `item` filling (0,0)-(w,h) px. */
export function drawFurniturePiece(ctx: Ctx, item: string, w: number, h: number) {
  const p = furniturePiece(item);
  const col = pieceColor(item);
  const dk = shade(col, -0.35);
  const m = Math.min(w, h);
  ctx.save();
  // soft shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.roundRect(m * 0.06, m * 0.1, w - m * 0.06, h - m * 0.06, m * 0.12);
  ctx.fill();
  const cat = p?.category ?? 'decor';
  if (cat === 'beds') {
    rr(ctx, 1, 1, w - 2, h - 2, m * 0.12, item === 'holo_bed' ? '#1098ad' : dk);
    rr(ctx, w * 0.06, h * 0.06, w * 0.88, h * 0.88, m * 0.1, '#f8f9fa');
    rr(ctx, w * 0.06, h * 0.32, w * 0.88, h * 0.62, m * 0.1, item === 'holo_bed' ? '#66d9e8' : col, dk);
    const pillows = w > h * 0.8 ? 2 : 1;
    for (let i = 0; i < pillows; i++) rr(ctx, w * 0.12 + (i * w * 0.78) / pillows, h * 0.1, (w * 0.7) / pillows, h * 0.16, m * 0.08, '#ffffff', '#dee2e6');
    if (item === 'holo_bed') {
      ctx.strokeStyle = 'rgba(102,217,232,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, w - 4, h - 4);
    }
  } else if (cat === 'sofas') {
    rr(ctx, 1, 1, w - 2, h - 2, m * 0.25, dk);
    rr(ctx, w * 0.08, h * 0.3, w * 0.84, h * 0.62, m * 0.18, col);
    for (let i = 1; i < 3; i++) {
      ctx.strokeStyle = dk;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo((w * i) / 3, h * 0.34);
      ctx.lineTo((w * i) / 3, h * 0.88);
      ctx.stroke();
    }
    if (item === 'velvet_sofa') rr(ctx, w * 0.1, h * 0.05, w * 0.8, h * 0.08, 2, '#ffd43b');
  } else if (cat === 'tables') {
    if (item === 'dining_set') {
      for (const [cx, cy] of [[0.5, 0.12], [0.5, 0.88], [0.12, 0.5], [0.88, 0.5]]) rr(ctx, w * cx - m * 0.12, h * cy - m * 0.12, m * 0.24, m * 0.24, 3, dk);
      rr(ctx, w * 0.22, h * 0.22, w * 0.56, h * 0.56, 4, col, dk);
    } else {
      rr(ctx, 2, h * 0.12, w - 4, h * 0.76, 4, item === 'rgb_desk' ? '#212529' : col, dk);
      if (item === 'rgb_desk' || item === 'pipe_desk') {
        rr(ctx, w * 0.35, h * 0.25, w * 0.3, h * 0.3, 2, '#343a40');
        if (item === 'rgb_desk') {
          const g = ctx.createLinearGradient(0, 0, w, 0);
          for (const [k, c] of [[0, '#ff6b6b'], [0.33, '#ffd43b'], [0.66, '#51cf66'], [1, '#4dabf7']] as const) g.addColorStop(k, c);
          ctx.strokeStyle = g;
          ctx.lineWidth = 2.5;
          ctx.strokeRect(3, h * 0.14, w - 6, h * 0.72);
        }
      } else circle(ctx, w / 2, h / 2, m * 0.18, '#f1f3f5');
    }
  } else if (cat === 'bathroom') {
    if (item === 'toilet') {
      rr(ctx, w * 0.2, 2, w * 0.6, h * 0.3, 3, '#e9ecef', '#adb5bd');
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.6, w * 0.3, h * 0.32, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#f8f9fa';
      ctx.fill();
      ctx.strokeStyle = '#adb5bd';
      ctx.stroke();
      circle(ctx, w / 2, h * 0.62, m * 0.14, '#a5d8ff');
    } else if (item === 'shower') {
      rr(ctx, 2, 2, w - 4, h - 4, 3, '#d0ebff', '#74c0fc');
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) circle(ctx, w * (0.2 + i * 0.2), h * (0.2 + j * 0.2), m * 0.03, '#4dabf7');
    } else {
      rr(ctx, 2, 2, w - 4, h - 4, m * 0.4, '#f8f9fa', '#ced4da');
      rr(ctx, w * 0.1, h * 0.18, w * 0.8, h * 0.64, m * 0.3, '#a5d8ff');
      circle(ctx, w * 0.85, h / 2, m * 0.06, '#fcc419');
    }
  } else if (cat === 'kitchen') {
    if (item === 'coffee_machine') {
      rr(ctx, w * 0.15, h * 0.1, w * 0.7, h * 0.8, 4, '#343a40');
      circle(ctx, w / 2, h * 0.55, m * 0.16, '#8d5a33');
    } else {
      rr(ctx, 1, 1, w - 2, h - 2, 3, '#dee2e6', '#868e96');
      rr(ctx, w * 0.06, h * 0.15, w * 0.3, h * 0.7, 2, '#a5d8ff'); // sink
      for (const k of [0.6, 0.8]) circle(ctx, w * k, h * 0.35, m * 0.12, '#343a40'); // hob
      if (item === 'island_kitchen') rr(ctx, 1, h * 0.75, w - 2, h * 0.2, 2, '#495057');
    }
  } else if (cat === 'appliances') {
    if (item === 'aircond') {
      rr(ctx, 1, h * 0.15, w - 2, h * 0.7, m * 0.15, '#f8f9fa', '#ced4da');
      for (let i = 0; i < 4; i++) rr(ctx, w * 0.1, h * (0.35 + i * 0.1), w * 0.8, 1.5, 0, '#adb5bd');
      circle(ctx, w * 0.9, h * 0.3, 2, '#40c057');
    } else if (item === 'wifi_router') {
      rr(ctx, w * 0.2, h * 0.45, w * 0.6, h * 0.35, 3, '#343a40');
      for (const k of [0.3, 0.7]) rr(ctx, w * k - 1, h * 0.1, 2.5, h * 0.4, 1, '#495057');
      circle(ctx, w * 0.35, h * 0.62, 1.8, '#51cf66');
      circle(ctx, w * 0.5, h * 0.62, 1.8, '#51cf66');
    } else if (item === 'smart_tv') {
      rr(ctx, 1, h * 0.2, w - 2, h * 0.6, 2, '#212529');
      rr(ctx, 3, h * 0.28, w - 6, h * 0.44, 1, '#4dabf7');
    } else if (item === 'washer') {
      rr(ctx, 2, 2, w - 4, h - 4, 4, '#f8f9fa', '#adb5bd');
      circle(ctx, w / 2, h * 0.56, m * 0.28, '#495057');
      circle(ctx, w / 2, h * 0.56, m * 0.2, '#a5d8ff');
    } else if (item === 'smart_lock') {
      rr(ctx, w * 0.3, h * 0.15, w * 0.4, h * 0.7, 3, '#212529');
      circle(ctx, w / 2, h * 0.4, m * 0.08, '#4dabf7');
    } else if (item === 'mini_fan') {
      circle(ctx, w / 2, h / 2, m * 0.42, '#74c0fc');
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(w / 2 + Math.cos((i * 2 * Math.PI) / 3) * m * 0.2, h / 2 + Math.sin((i * 2 * Math.PI) / 3) * m * 0.2, m * 0.18, m * 0.08, (i * 2 * Math.PI) / 3, 0, Math.PI * 2);
        ctx.fillStyle = '#e7f5ff';
        ctx.fill();
      }
    } else rr(ctx, 2, 2, w - 4, h - 4, 3, '#ced4da', '#868e96');
  } else if (cat === 'storage') {
    rr(ctx, 1, 1, w - 2, h - 2, 3, col, dk);
    for (let i = 1; i < Math.round(w / 12); i++) {
      ctx.strokeStyle = dk;
      ctx.beginPath();
      ctx.moveTo((w * i) / Math.round(w / 12), 2);
      ctx.lineTo((w * i) / Math.round(w / 12), h - 2);
      ctx.stroke();
    }
    if (item === 'bamboo_shelf') for (let i = 0; i < 5; i++) circle(ctx, w * (0.15 + i * 0.17), h / 2, m * 0.12, ['#e03131', '#2f9e44', '#fab005', '#1c7ed6', '#ae3ec9'][i]);
  } else if (cat === 'lighting') {
    if (item === 'gold_chandelier') {
      circle(ctx, w / 2, h / 2, m * 0.45, 'rgba(255,224,102,0.35)');
      for (let i = 0; i < 6; i++) circle(ctx, w / 2 + Math.cos(i) * m * 0.3, h / 2 + Math.sin(i) * m * 0.3, m * 0.07, '#fcc419');
      circle(ctx, w / 2, h / 2, m * 0.12, '#f08c00');
    } else {
      circle(ctx, w / 2, h / 2, m * 0.42, item === 'cyber_lamp' ? 'rgba(102,217,232,0.4)' : 'rgba(255,236,153,0.45)');
      circle(ctx, w / 2, h / 2, m * 0.22, item === 'paper_lantern' ? '#fff4e6' : item === 'cyber_lamp' ? '#22b8cf' : col);
      circle(ctx, w / 2, h / 2, m * 0.08, '#fff9db');
    }
  } else if (cat === 'outdoor') {
    rr(ctx, 1, 1, w - 2, h - 2, 4, '#c49a6c', '#8d6e63');
    circle(ctx, w / 2, h / 2, m * 0.22, '#f1f3f5');
    for (const [x, y] of [[0.2, 0.2], [0.8, 0.8]]) circle(ctx, w * x, h * y, m * 0.12, '#2f9e44');
  } else if (cat === 'chairs') {
    if (item === 'bean_bag') {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w * 0.45, h * 0.42, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#7950f2';
      ctx.fill();
    } else {
      rr(ctx, w * 0.15, h * 0.1, w * 0.7, h * 0.22, 3, item === 'plastic_chair' ? '#c92a2a' : dk);
      rr(ctx, w * 0.15, h * 0.3, w * 0.7, h * 0.6, 4, item === 'plastic_chair' ? '#e03131' : col);
    }
  } else {
    // decor
    if (item === 'big_rug') {
      rr(ctx, 1, 1, w - 2, h - 2, 4, '#e64980');
      rr(ctx, w * 0.1, h * 0.1, w * 0.8, h * 0.8, 3, '#f783ac');
      rr(ctx, w * 0.25, h * 0.25, w * 0.5, h * 0.5, 2, '#fcc2d7');
    } else if (item === 'batik_painting' || item === 'neon_sign') {
      rr(ctx, 1, h * 0.2, w - 2, h * 0.6, 2, item === 'neon_sign' ? '#212529' : '#8d6e63');
      if (item === 'neon_sign') {
        ctx.fillStyle = '#f783ac';
        ctx.font = `900 ${Math.round(h * 0.38)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('OPEN', w / 2, h / 2 + 1);
      } else for (let i = 0; i < 3; i++) circle(ctx, w * (0.3 + i * 0.2), h / 2, m * 0.12, ['#e8590c', '#1c7ed6', '#2f9e44'][i]);
    } else {
      // plants, bonsai
      rr(ctx, w * 0.3, h * 0.55, w * 0.4, h * 0.35, 3, '#c4703a');
      circle(ctx, w / 2, h * 0.42, m * 0.32, item === 'bonsai' ? '#5c940d' : '#2f9e44');
      circle(ctx, w * 0.38, h * 0.32, m * 0.16, '#51cf66');
    }
  }
  ctx.restore();
}

/** Draws a piece rotated by `rot` quarter turns into the cell box at (x, y), cell size `c` px. */
export function drawPlaced(ctx: Ctx, item: string, x: number, y: number, rot: number, c: number) {
  const p = furniturePiece(item);
  if (!p) return;
  const [fw, fh] = rot % 2 ? [p.h, p.w] : [p.w, p.h];
  ctx.save();
  ctx.translate((x + fw / 2) * c, (y + fh / 2) * c);
  ctx.rotate((rot * Math.PI) / 2);
  ctx.translate((-p.w * c) / 2, (-p.h * c) / 2);
  drawFurniturePiece(ctx, item, p.w * c, p.h * c);
  ctx.restore();
}

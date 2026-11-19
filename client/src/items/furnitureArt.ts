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
function circle(ctx: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient) {
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
/** Pieces drawn like an existing one (their own theme colour still applies). */
const LOOKS_LIKE: Record<string, string> = {
  inverter_aircond: 'aircond', mesh_wifi: 'wifi_router', oled_tv: 'smart_tv', dryer: 'washer', standing_fan: 'mini_fan',
  rain_shower: 'shower', smart_toilet: 'toilet', teh_station: 'coffee_machine', kampung_mattress: 'basic_bed', day_bed: 'basic_bed',
  neon_loft_bed: 'holo_bed', l_sofa: 'scandi_sofa', bean_sofa: 'scandi_sofa', marble_dining: 'dining_set', kopitiam_table: 'low_table',
  gaming_desk: 'rgb_desk', coffee_table: 'low_table', bookshelf: 'bamboo_shelf', walk_in_closet: 'wardrobe', zaisu: 'rattan_chair',
  office_chair: 'rattan_chair', tatami_rug: 'big_rug', ikebana: 'bonsai',
};

/** Signature pieces with their own drawing. Returns true if it drew `item`. */
function drawSpecial(ctx: Ctx, item: string, w: number, h: number, col: string, dk: string, m: number): boolean {
  switch (item) {
    case 'canopy_bed': {
      rr(ctx, 1, 1, w - 2, h - 2, m * 0.08, '#7f5539');
      rr(ctx, w * 0.08, h * 0.08, w * 0.84, h * 0.84, m * 0.06, '#fff9db');
      rr(ctx, w * 0.1, h * 0.3, w * 0.8, h * 0.6, m * 0.06, '#c92a2a', '#862e2e');
      for (let i = 0; i < 3; i++) rr(ctx, w * (0.14 + i * 0.25), h * 0.1, w * 0.22, h * 0.14, m * 0.05, '#ffffff', '#ffd43b');
      for (const [x, y] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]]) circle(ctx, w * x, h * y, m * 0.06, '#fcc419');
      ctx.strokeStyle = 'rgba(255, 236, 153, 0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
      ctx.setLineDash([]);
      return true;
    }
    case 'jacuzzi': {
      circle(ctx, w / 2, h / 2, m * 0.48, '#e9ecef');
      circle(ctx, w / 2, h / 2, m * 0.4, '#4dabf7');
      for (let i = 0; i < 10; i++) circle(ctx, w / 2 + Math.cos(i * 1.7) * m * 0.25, h / 2 + Math.sin(i * 2.3) * m * 0.22, m * 0.04, 'rgba(255,255,255,0.85)');
      circle(ctx, w / 2, h / 2, m * 0.08, '#fcc419');
      return true;
    }
    case 'vanity_sink': {
      rr(ctx, 1, 1, w - 2, h - 2, 3, col, dk);
      rr(ctx, w * 0.3, h * 0.2, w * 0.4, h * 0.6, m * 0.25, '#f8f9fa', '#adb5bd');
      circle(ctx, w / 2, h * 0.5, m * 0.08, '#a5d8ff');
      rr(ctx, w * 0.47, h * 0.08, w * 0.06, h * 0.18, 1, '#868e96');
      return true;
    }
    case 'fridge': {
      rr(ctx, w * 0.1, 2, w * 0.8, h - 4, 4, '#f1f3f5', '#adb5bd');
      ctx.strokeStyle = '#adb5bd';
      ctx.beginPath();
      ctx.moveTo(w / 2, 4);
      ctx.lineTo(w / 2, h - 4);
      ctx.stroke();
      rr(ctx, w * 0.4, h * 0.3, 2, h * 0.3, 1, '#868e96');
      rr(ctx, w * 0.58, h * 0.3, 2, h * 0.3, 1, '#868e96');
      return true;
    }
    case 'kampung_dapur':
    case 'chef_kitchen': {
      rr(ctx, 1, 1, w - 2, h - 2, 3, item === 'chef_kitchen' ? '#212529' : '#8d6e63', item === 'chef_kitchen' ? '#fcc419' : '#5d4037');
      rr(ctx, w * 0.05, h * 0.18, w * 0.25, h * 0.64, 2, '#a5d8ff');
      const n = item === 'chef_kitchen' ? 4 : 2;
      for (let i = 0; i < n; i++) circle(ctx, w * (0.42 + i * (0.5 / n)), h * 0.5, m * 0.13, '#343a40');
      if (item === 'kampung_dapur') circle(ctx, w * 0.55, h * 0.5, m * 0.2, '#495057');
      return true;
    }
    case 'bar_counter': {
      rr(ctx, 1, h * 0.1, w - 2, h * 0.55, 4, '#343a40', '#868e96');
      for (let i = 0; i < 3; i++) circle(ctx, w * (0.2 + i * 0.3), h * 0.82, m * 0.14, '#c92a2a');
      for (let i = 0; i < 4; i++) rr(ctx, w * (0.12 + i * 0.2), h * 0.18, m * 0.08, m * 0.22, 1, ['#2f9e44', '#e8590c', '#1c7ed6', '#fab005'][i]);
      return true;
    }
    case 'console_set': {
      rr(ctx, w * 0.05, h * 0.25, w * 0.9, h * 0.5, 3, '#212529');
      rr(ctx, w * 0.12, h * 0.35, w * 0.3, h * 0.3, 2, '#495057');
      circle(ctx, w * 0.7, h * 0.5, m * 0.14, '#be4bdb');
      circle(ctx, w * 0.85, h * 0.5, m * 0.08, '#4dabf7');
      return true;
    }
    case 'robot_vacuum': {
      circle(ctx, w / 2, h / 2, m * 0.4, '#343a40');
      circle(ctx, w / 2, h / 2, m * 0.3, '#22b8cf');
      circle(ctx, w / 2, h * 0.32, m * 0.06, '#51cf66');
      return true;
    }
    case 'bbq_pit': {
      rr(ctx, w * 0.05, h * 0.15, w * 0.9, h * 0.7, m * 0.3, '#212529');
      ctx.strokeStyle = '#868e96';
      ctx.lineWidth = 1.5;
      for (let i = 1; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(w * (0.1 + i * 0.13), h * 0.2);
        ctx.lineTo(w * (0.1 + i * 0.13), h * 0.8);
        ctx.stroke();
      }
      for (let i = 0; i < 4; i++) rr(ctx, w * (0.2 + i * 0.17), h * 0.38, w * 0.1, h * 0.24, 2, '#c2410c');
      return true;
    }
    case 'hammock': {
      for (const x of [0.04, 0.96]) circle(ctx, w * x, h / 2, m * 0.08, '#8d6e63');
      ctx.fillStyle = '#e03131';
      ctx.beginPath();
      ctx.moveTo(w * 0.08, h / 2);
      ctx.quadraticCurveTo(w / 2, h * 1.05, w * 0.92, h / 2);
      ctx.quadraticCurveTo(w / 2, -h * 0.05, w * 0.08, h / 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd43b';
      ctx.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(w * (0.08 + i * 0.21), h * 0.2);
        ctx.lineTo(w * (0.08 + i * 0.21), h * 0.8);
        ctx.stroke();
      }
      return true;
    }
    case 'rooftop_lounge': {
      rr(ctx, 1, 1, w - 2, h - 2, 4, '#dee2e6', '#adb5bd');
      for (const [x, y] of [[0.12, 0.12], [0.62, 0.12]]) rr(ctx, w * x, h * y, w * 0.28, h * 0.5, m * 0.08, '#fff9db', '#fcc419');
      circle(ctx, w / 2, h * 0.78, m * 0.14, '#4dabf7');
      circle(ctx, w * 0.85, h * 0.8, m * 0.16, '#2f9e44');
      return true;
    }
    case 'cyber_sofa': {
      rr(ctx, 1, 1, w - 2, h - 2, m * 0.25, '#212529');
      rr(ctx, w * 0.08, h * 0.3, w * 0.84, h * 0.62, m * 0.18, '#343a40');
      ctx.strokeStyle = '#22b8cf';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(2, 2, w - 4, h - 4, m * 0.25);
      ctx.stroke();
      return true;
    }
    case 'pendant_lights':
    case 'pelita_lamp': {
      circle(ctx, w / 2, h / 2, m * 0.44, 'rgba(255,212,59,0.35)');
      if (item === 'pelita_lamp') {
        rr(ctx, w * 0.3, h * 0.45, w * 0.4, h * 0.35, 3, '#b08968');
        ctx.fillStyle = '#ff922b';
        ctx.beginPath();
        ctx.moveTo(w * 0.42, h * 0.46);
        ctx.quadraticCurveTo(w / 2, h * 0.05, w * 0.58, h * 0.46);
        ctx.fill();
      } else for (const x of [0.28, 0.5, 0.72]) {
        circle(ctx, w * x, h * 0.55, m * 0.12, '#343a40');
        circle(ctx, w * x, h * 0.58, m * 0.06, '#fff3bf');
      }
      return true;
    }
    case 'rgb_strip': {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      for (const [k, c] of [[0, '#ff6b6b'], [0.25, '#ffd43b'], [0.5, '#51cf66'], [0.75, '#4dabf7'], [1, '#cc5de8']] as const) g.addColorStop(k, c);
      ctx.fillStyle = 'rgba(190, 75, 219, 0.25)';
      ctx.fillRect(0, h * 0.25, w, h * 0.5);
      ctx.fillStyle = g;
      ctx.fillRect(2, h * 0.44, w - 4, h * 0.12);
      return true;
    }
    case 'wau_kite': {
      ctx.fillStyle = '#e03131';
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.05);
      ctx.quadraticCurveTo(w * 0.98, h * 0.3, w * 0.62, h * 0.55);
      ctx.lineTo(w / 2, h * 0.95);
      ctx.lineTo(w * 0.38, h * 0.55);
      ctx.quadraticCurveTo(w * 0.02, h * 0.3, w / 2, h * 0.05);
      ctx.fill();
      ctx.fillStyle = '#ffd43b';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.78, m * 0.22, Math.PI * 1.1, Math.PI * 1.9, true);
      ctx.fill();
      circle(ctx, w / 2, h * 0.38, m * 0.1, '#1c7ed6');
      return true;
    }
    case 'aquarium': {
      rr(ctx, 1, h * 0.1, w - 2, h * 0.8, 3, '#74c0fc', '#1c7ed6');
      rr(ctx, 3, h * 0.7, w - 6, h * 0.16, 2, '#e9c46a');
      for (const [x, y, c] of [[0.25, 0.4, '#ff922b'], [0.6, 0.3, '#fcc419'], [0.78, 0.55, '#f06595']] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(w * x, h * y, m * 0.12, m * 0.07, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(w * x - m * 0.1, h * y);
        ctx.lineTo(w * x - m * 0.2, h * y - m * 0.07);
        ctx.lineTo(w * x - m * 0.2, h * y + m * 0.07);
        ctx.fill();
      }
      for (const x of [0.12, 0.45]) rr(ctx, w * x, h * 0.45, m * 0.06, h * 0.3, 2, '#2f9e44');
      return true;
    }
    case 'gold_statue': {
      circle(ctx, w / 2, h * 0.58, m * 0.34, '#fcc419');
      circle(ctx, w / 2, h * 0.3, m * 0.24, '#ffd43b');
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#fcc419';
        ctx.beginPath();
        ctx.moveTo(w / 2 + s * m * 0.08, h * 0.14);
        ctx.lineTo(w / 2 + s * m * 0.22, h * 0.02);
        ctx.lineTo(w / 2 + s * m * 0.24, h * 0.2);
        ctx.fill();
      }
      rr(ctx, w * 0.62, h * 0.18, m * 0.12, m * 0.3, 3, '#ffe066');
      circle(ctx, w / 2, h * 0.62, m * 0.1, '#e03131');
      return true;
    }
    case 'hologram': {
      rr(ctx, w * 0.25, h * 0.65, w * 0.5, h * 0.25, 3, '#343a40');
      ctx.fillStyle = 'rgba(102, 217, 232, 0.45)';
      ctx.beginPath();
      ctx.moveTo(w * 0.4, h * 0.68);
      ctx.lineTo(w * 0.1, h * 0.08);
      ctx.lineTo(w * 0.9, h * 0.08);
      ctx.lineTo(w * 0.6, h * 0.68);
      ctx.fill();
      circle(ctx, w / 2, h * 0.3, m * 0.14, 'rgba(197, 246, 250, 0.9)');
      return true;
    }
    case 'throne':
    case 'gaming_chair': {
      const throne = item === 'throne';
      rr(ctx, w * 0.1, h * 0.05, w * 0.8, h * 0.4, m * 0.15, throne ? '#fcc419' : '#212529');
      rr(ctx, w * 0.15, h * 0.32, w * 0.7, h * 0.6, m * 0.12, throne ? '#862e9c' : '#be4bdb');
      if (!throne) rr(ctx, w * 0.42, h * 0.08, w * 0.16, h * 0.34, 2, '#be4bdb');
      else for (const x of [0.25, 0.5, 0.75]) circle(ctx, w * x, h * 0.1, m * 0.06, '#e03131');
      return true;
    }
    case 'shoe_rack': {
      rr(ctx, 1, 1, w - 2, h - 2, 2, '#8d6e63', '#5d4037');
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) rr(ctx, w * (0.12 + j * 0.42), h * (0.12 + i * 0.28), w * 0.34, h * 0.18, 3, ['#e03131', '#1c7ed6', '#f8f9fa'][(i + j) % 3]);
      return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ materials
/** A surface lit from the top-left: lighter there, darker bottom-right. */
function lit(ctx: Ctx, x: number, y: number, w: number, h: number, col: string, k = 0.18): CanvasGradient {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, shade(col, k));
  g.addColorStop(0.55, col);
  g.addColorStop(1, shade(col, -k));
  return g;
}
function fillRR(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
  ctx.fillStyle = fill;
  ctx.fill();
}
/** A thin highlight along the top-left edges and a dark line bottom-right (a bevel). */
function bevel(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, Math.max(0, Math.min(r, w / 2, h / 2)));
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + r, y + 1.5);
  ctx.lineTo(x + w - r, y + 1.5);
  ctx.moveTo(x + 1.5, y + r);
  ctx.lineTo(x + 1.5, y + h - r);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
  ctx.restore();
}
/** Wood: lit grain with fine lines along its length. */
function wood(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, col: string) {
  fillRR(ctx, x, y, w, h, r, lit(ctx, x, y, w, h, col));
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
  ctx.clip();
  ctx.strokeStyle = shade(col, -0.22);
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 0.8;
  const along = w >= h;
  const n = Math.max(3, Math.round((along ? h : w) / 4));
  for (let i = 1; i < n; i++) {
    ctx.beginPath();
    if (along) {
      const yy = y + (h * i) / n;
      ctx.moveTo(x, yy);
      ctx.bezierCurveTo(x + w * 0.3, yy + 1.2, x + w * 0.6, yy - 1.2, x + w, yy + 0.6);
    } else {
      const xx = x + (w * i) / n;
      ctx.moveTo(xx, y);
      ctx.bezierCurveTo(xx + 1.2, y + h * 0.3, xx - 1.2, y + h * 0.6, xx + 0.6, y + h);
    }
    ctx.stroke();
  }
  ctx.restore();
  bevel(ctx, x, y, w, h, r);
}
/** Fabric: soft (a glow in the middle, darker at the edges) with a faint weave. */
function fabric(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, col: string) {
  const g = ctx.createRadialGradient(x + w * 0.4, y + h * 0.35, 1, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, shade(col, 0.2));
  g.addColorStop(0.7, col);
  g.addColorStop(1, shade(col, -0.25));
  fillRR(ctx, x, y, w, h, r, g);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
  ctx.clip();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#000';
  for (let yy = y; yy < y + h; yy += 3) ctx.fillRect(x, yy, w, 1);
  ctx.restore();
}
/** Glossy white (porcelain, appliances). */
function gloss(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, col = '#f8f9fa') {
  fillRR(ctx, x, y, w, h, r, lit(ctx, x, y, w, h, col, 0.12));
  ctx.save();
  ctx.globalAlpha = 0.5;
  fillRR(ctx, x + w * 0.12, y + h * 0.08, w * 0.35, Math.max(1.5, h * 0.08), 2, '#fff');
  ctx.restore();
  bevel(ctx, x, y, w, h, r);
}
/** Stone (counter tops): pale with speckles. */
function stone(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, col: string) {
  fillRR(ctx, x, y, w, h, r, lit(ctx, x, y, w, h, col, 0.1));
  ctx.save();
  for (let i = 0; i < (w * h) / 18; i++) {
    const sx = x + ((i * 37) % 97) / 97 * w, sy = y + ((i * 61) % 89) / 89 * h;
    ctx.fillStyle = i % 3 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.35)';
    ctx.fillRect(sx, sy, 1, 1);
  }
  ctx.restore();
  bevel(ctx, x, y, w, h, r);
}
/** Dark glass (screens, hobs) with a diagonal reflection. */
function glass(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, col = '#1c2230') {
  fillRR(ctx, x, y, w, h, r, lit(ctx, x, y, w, h, col, 0.15));
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.15, y);
  ctx.lineTo(x + w * 0.45, y);
  ctx.lineTo(x + w * 0.2, y + h);
  ctx.lineTo(x - w * 0.1, y + h);
  ctx.fill();
  ctx.restore();
}
function ring(ctx: Ctx, x: number, y: number, r: number, col: string, lw = 1.5) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  ctx.stroke();
}
/** A pillow: a puffy soft square with a crease. */
function pillow(ctx: Ctx, x: number, y: number, w: number, h: number, col = '#ffffff') {
  fabric(ctx, x, y, w, h, Math.min(w, h) * 0.35, col);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, y + h * 0.5);
  ctx.quadraticCurveTo(x + w / 2, y + h * 0.62, x + w * 0.8, y + h * 0.5);
  ctx.stroke();
}
/** A leafy plant seen from above, in a clay pot. */
function plant(ctx: Ctx, cx: number, cy: number, r: number, leaf: string, big = false) {
  circle(ctx, cx + r * 0.1, cy + r * 0.15, r * 0.62, 'rgba(0,0,0,0.25)');
  const pot = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 1, cx, cy, r * 0.62);
  pot.addColorStop(0, '#e08a54');
  pot.addColorStop(1, '#9c4a22');
  circle(ctx, cx, cy, r * 0.58, pot);
  circle(ctx, cx, cy, r * 0.46, '#4a3426');
  const n = big ? 9 : 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const lx = cx + Math.cos(a) * r * 0.45, ly = cy + Math.sin(a) * r * 0.45;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(a);
    const g = ctx.createLinearGradient(-r * 0.4, 0, r * 0.4, 0);
    g.addColorStop(0, shade(leaf, -0.25));
    g.addColorStop(1, shade(leaf, 0.2));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * (big ? 0.55 : 0.42), r * (big ? 0.24 : 0.16), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, 0);
    ctx.lineTo(r * 0.35, 0);
    ctx.stroke();
    ctx.restore();
  }
  circle(ctx, cx, cy, r * 0.18, shade(leaf, 0.15));
}

/**
 * Draws `item` filling (0,0)-(w,h): the piece is drawn on its own canvas first, then stamped down
 * with a soft shadow that follows its real outline (a round lamp casts a round shadow), always
 * falling the same way however the piece is turned.
 */
export function drawFurniturePiece(ctx: Ctx, item: string, w: number, h: number) {
  const t = ctx.getTransform();
  const k = Math.max(1, Math.hypot(t.a, t.b));
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.ceil(w * k));
  off.height = Math.max(1, Math.ceil(h * k));
  const o = off.getContext('2d')!;
  o.scale(k, k);
  drawPieceBody(o, item, w, h);
  const m = Math.min(w, h);
  ctx.save();
  if (!furniturePiece(item)?.floor) {
    ctx.shadowColor = 'rgba(0,0,0,0.38)';
    ctx.shadowBlur = m * 0.14 * k;
    ctx.shadowOffsetX = m * 0.05 * k;
    ctx.shadowOffsetY = m * 0.08 * k;
  }
  ctx.drawImage(off, 0, 0, w, h);
  ctx.restore();
}

function drawPieceBody(ctx: Ctx, item: string, w: number, h: number) {
  const p = furniturePiece(item);
  const col = pieceColor(item);
  const dk = shade(col, -0.35);
  const m = Math.min(w, h);
  ctx.save();
  const cat = p?.category ?? 'decor';
  const base = LOOKS_LIKE[item] ?? item;
  if (drawSpecial(ctx, item, w, h, col, dk, m)) {
    ctx.restore();
    return;
  }
  const s = m * 0.06; // standard inset
  if (cat === 'beds') {
    const holo = base === 'holo_bed';
    const frame = holo ? '#0b7285' : base === 'steel_bunk' ? '#868e96' : shade(col, -0.25);
    if (base === 'steel_bunk') fillRR(ctx, 1, 1, w - 2, h - 2, 3, lit(ctx, 0, 0, w, h, '#adb5bd'));
    else wood(ctx, 1, 1, w - 2, h - 2, m * 0.08, frame);
    // headboard (at the top)
    if (base !== 'tatami_bed' && base !== 'kampung_mattress') wood(ctx, 1, 1, w - 2, h * 0.14, m * 0.06, shade(frame, -0.1));
    // mattress, then the duvet over the lower two thirds with folds
    fillRR(ctx, s * 1.4, h * 0.13, w - s * 2.8, h * 0.82, m * 0.08, lit(ctx, 0, 0, w, h, '#f8f9fa', 0.08));
    const duvet = holo ? '#66d9e8' : base === 'tatami_bed' ? '#e9ecef' : col;
    fabric(ctx, s * 1.2, h * 0.36, w - s * 2.4, h * 0.6, m * 0.08, duvet);
    ctx.strokeStyle = 'rgba(0,0,0,0.13)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(s * 2, h * (0.36 + i * 0.18));
      ctx.quadraticCurveTo(w / 2, h * (0.4 + i * 0.18), w - s * 2, h * (0.35 + i * 0.18));
      ctx.stroke();
    }
    // the turned-down top edge of the duvet
    fillRR(ctx, s * 1.2, h * 0.34, w - s * 2.4, h * 0.06, 2, shade(duvet, 0.25));
    const pillows = w > h * 0.8 ? 2 : 1;
    for (let i = 0; i < pillows; i++) pillow(ctx, s * 2 + (i * (w - s * 4)) / pillows + 1, h * 0.15, (w - s * 4) / pillows - 2, h * 0.16);
    if (holo) {
      ctx.strokeStyle = 'rgba(102,217,232,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, w - 4, h - 4);
    }
    if (base === 'steel_bunk') for (const x of [3, w - 6]) for (const y of [3, h - 6]) circle(ctx, x + 1.5, y + 1.5, 2.5, '#495057');
  } else if (cat === 'sofas') {
    const bean = base === 'bean_sofa';
    if (bean) {
      fabric(ctx, 2, 2, w - 4, h - 4, m * 0.45, col);
    } else {
      // frame, back (top), arms, then the seat cushions with seams
      fabric(ctx, 1, 1, w - 2, h - 2, m * 0.18, shade(col, -0.22));
      fabric(ctx, s, s, w - s * 2, h * 0.32, m * 0.14, shade(col, -0.08)); // backrest
      fabric(ctx, s, s, w * 0.12, h - s * 2, m * 0.12, shade(col, -0.05)); // arms
      fabric(ctx, w - s - w * 0.12, s, w * 0.12, h - s * 2, m * 0.12, shade(col, -0.05));
      const seats = Math.max(1, Math.round(w / h));
      const sx = s + w * 0.12, sw = w - s * 2 - w * 0.24;
      for (let i = 0; i < seats; i++) fabric(ctx, sx + (i * sw) / seats + 1, h * 0.36, sw / seats - 2, h * 0.55, m * 0.1, col);
      pillow(ctx, sx + 2, h * 0.24, Math.min(sw * 0.22, h * 0.32), h * 0.24, shade(col, 0.35));
      if (base === 'velvet_sofa') fillRR(ctx, w * 0.1, h * 0.04, w * 0.8, h * 0.05, 2, '#ffd43b');
      if (base === 'leather_sofa') {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let i = 0; i < 6; i++) circle(ctx, w * (0.2 + i * 0.12), h * 0.18, 1, 'rgba(0,0,0,0.3)');
      }
    }
  } else if (cat === 'tables') {
    const top = base === 'marble_dining' ? '#f1f3f5' : base === 'rgb_desk' || base === 'gaming_desk' ? '#212529' : col;
    const surf = (x: number, y: number, ww: number, hh: number, r: number) =>
      base === 'marble_dining' ? stone(ctx, x, y, ww, hh, r, top) : base === 'rgb_desk' ? glass(ctx, x, y, ww, hh, r, top) : wood(ctx, x, y, ww, hh, r, top);
    if (base === 'dining_set') {
      for (const [cx, cy] of [[0.5, 0.1], [0.5, 0.9], [0.1, 0.5], [0.9, 0.5]]) {
        wood(ctx, w * cx - m * 0.12, h * cy - m * 0.12, m * 0.24, m * 0.24, 3, shade(col, -0.2));
        fabric(ctx, w * cx - m * 0.08, h * cy - m * 0.08, m * 0.16, m * 0.16, 3, '#e9ecef');
      }
      surf(w * 0.2, h * 0.2, w * 0.6, h * 0.6, 4);
      circle(ctx, w / 2, h / 2, m * 0.1, '#ffffff');
      circle(ctx, w / 2, h / 2, m * 0.06, '#ff922b');
    } else if (base === 'pipe_desk' || base === 'rgb_desk') {
      surf(2, h * 0.1, w - 4, h * 0.8, 3);
      glass(ctx, w * 0.35, h * 0.16, w * 0.3, h * 0.12, 2, '#111');
      fillRR(ctx, w * 0.32, h * 0.5, w * 0.36, h * 0.16, 2, '#343a40'); // keyboard
      for (let i = 0; i < 8; i++) ctx.fillRect(w * 0.34 + i * w * 0.04, h * 0.53, w * 0.03, h * 0.04);
      fillRR(ctx, w * 0.74, h * 0.52, w * 0.06, h * 0.12, 3, '#495057'); // mouse
      if (base === 'rgb_desk') {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        for (const [k, c] of [[0, '#ff6b6b'], [0.33, '#ffd43b'], [0.66, '#51cf66'], [1, '#4dabf7']] as const) g.addColorStop(k, c);
        ctx.strokeStyle = g;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(3, h * 0.12, w - 6, h * 0.76);
      }
    } else {
      surf(2, h * 0.12, w - 4, h * 0.76, m * 0.1);
      // something on top: a cup and a magazine
      fillRR(ctx, w * 0.2, h * 0.3, w * 0.22, h * 0.36, 1.5, '#e9ecef');
      fillRR(ctx, w * 0.22, h * 0.34, w * 0.18, h * 0.1, 1, '#4dabf7');
      circle(ctx, w * 0.68, h / 2, m * 0.11, '#ffffff');
      circle(ctx, w * 0.68, h / 2, m * 0.07, '#8d5a33');
    }
  } else if (cat === 'bathroom') {
    if (base === 'toilet') {
      gloss(ctx, w * 0.22, 2, w * 0.56, h * 0.28, 3); // tank
      circle(ctx, w / 2, h * 0.1, m * 0.04, '#adb5bd');
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.62, w * 0.3, h * 0.33, 0, 0, Math.PI * 2);
      ctx.fillStyle = lit(ctx, 0, h * 0.3, w, h * 0.7, '#f8f9fa', 0.12);
      ctx.fill();
      ctx.strokeStyle = '#ced4da';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.64, w * 0.19, h * 0.21, 0, 0, Math.PI * 2);
      const water = ctx.createRadialGradient(w / 2, h * 0.6, 1, w / 2, h * 0.64, m * 0.22);
      water.addColorStop(0, '#d0ebff');
      water.addColorStop(1, '#74c0fc');
      ctx.fillStyle = water;
      ctx.fill();
    } else if (base === 'shower') {
      fillRR(ctx, 2, 2, w - 4, h - 4, 3, lit(ctx, 0, 0, w, h, '#e7f5ff', 0.1));
      ctx.strokeStyle = 'rgba(116,192,252,0.5)';
      ctx.lineWidth = 0.8;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(2, (h * i) / 4);
        ctx.lineTo(w - 2, (h * i) / 4);
        ctx.moveTo((w * i) / 4, 2);
        ctx.lineTo((w * i) / 4, h - 2);
        ctx.stroke();
      }
      circle(ctx, w / 2, h / 2, m * 0.07, '#868e96'); // drain
      gloss(ctx, w * 0.38, 3, w * 0.24, h * 0.12, 3, '#ced4da'); // head
      ctx.strokeStyle = 'rgba(165, 216, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(2, h - 3);
      ctx.lineTo(w - 2, h - 3); // glass screen
      ctx.stroke();
    } else {
      // bathtub
      gloss(ctx, 2, 2, w - 4, h - 4, m * 0.35);
      const g = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.8);
      g.addColorStop(0, '#a5d8ff');
      g.addColorStop(1, '#4dabf7');
      fillRR(ctx, w * 0.1, h * 0.18, w * 0.8, h * 0.64, m * 0.3, g);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      for (let i = 0; i < 5; i++) circle(ctx, w * (0.25 + i * 0.12), h * (0.4 + (i % 2) * 0.15), m * 0.03, 'rgba(255,255,255,0.6)');
      fillRR(ctx, w * 0.86, h * 0.42, w * 0.08, h * 0.16, 2, '#adb5bd'); // taps
    }
  } else if (cat === 'kitchen') {
    if (base === 'coffee_machine') {
      gloss(ctx, w * 0.15, h * 0.08, w * 0.7, h * 0.84, 4, '#343a40');
      glass(ctx, w * 0.25, h * 0.15, w * 0.5, h * 0.2, 2, '#111');
      circle(ctx, w / 2, h * 0.6, m * 0.18, '#ffffff');
      circle(ctx, w / 2, h * 0.6, m * 0.13, '#6f4518');
    } else {
      // a run of counter: stone top, sink with a tap, a hob with rings
      stone(ctx, 1, 1, w - 2, h - 2, 3, '#dee2e6');
      fillRR(ctx, 1, h - 4, w - 2, 3, 1, 'rgba(0,0,0,0.25)'); // the cupboard fronts' edge
      const sink = ctx.createLinearGradient(0, h * 0.18, 0, h * 0.82);
      sink.addColorStop(0, '#868e96');
      sink.addColorStop(1, '#ced4da');
      fillRR(ctx, w * 0.06, h * 0.18, w * 0.3, h * 0.64, 3, sink);
      circle(ctx, w * 0.21, h * 0.5, m * 0.04, '#495057');
      fillRR(ctx, w * 0.19, h * 0.06, w * 0.04, h * 0.16, 1, '#adb5bd'); // tap
      glass(ctx, w * 0.5, h * 0.15, w * 0.44, h * 0.7, 3);
      for (const [kx, ky] of [[0.61, 0.35], [0.83, 0.35], [0.61, 0.65], [0.83, 0.65]]) {
        ring(ctx, w * kx, h * ky, m * 0.11, '#495057', 1.5);
        ring(ctx, w * kx, h * ky, m * 0.06, '#495057', 1);
      }
      if (base === 'island_kitchen') wood(ctx, 1, h * 0.76, w - 2, h * 0.22, 2, '#495057');
    }
  } else if (cat === 'appliances') {
    if (base === 'aircond') {
      gloss(ctx, 1, h * 0.15, w - 2, h * 0.7, m * 0.15);
      for (let i = 0; i < 4; i++) fillRR(ctx, w * 0.1, h * (0.42 + i * 0.09), w * 0.8, 1.2, 0, 'rgba(0,0,0,0.25)');
      circle(ctx, w * 0.9, h * 0.3, 1.8, '#40c057');
    } else if (base === 'wifi_router') {
      gloss(ctx, w * 0.18, h * 0.45, w * 0.64, h * 0.38, 3, '#343a40');
      for (const k of [0.28, 0.72]) fillRR(ctx, w * k - 1, h * 0.08, 2.5, h * 0.42, 1, '#495057');
      for (const k of [0.35, 0.5, 0.65]) circle(ctx, w * k, h * 0.64, 1.6, '#51cf66');
    } else if (base === 'smart_tv') {
      fillRR(ctx, 1, h * 0.2, w - 2, h * 0.62, 2, '#111');
      const scr = ctx.createLinearGradient(0, h * 0.25, w, h * 0.75);
      scr.addColorStop(0, '#1971c2');
      scr.addColorStop(0.5, '#4dabf7');
      scr.addColorStop(1, '#1864ab');
      fillRR(ctx, 3, h * 0.26, w - 6, h * 0.5, 1, scr);
      glass(ctx, 3, h * 0.26, w - 6, h * 0.5, 1, 'rgba(0,0,0,0)');
      fillRR(ctx, w * 0.42, h * 0.82, w * 0.16, h * 0.08, 1, '#343a40'); // stand
    } else if (base === 'washer') {
      gloss(ctx, 2, 2, w - 4, h - 4, 4);
      ring(ctx, w / 2, h * 0.56, m * 0.3, '#adb5bd', 3);
      const drum = ctx.createRadialGradient(w * 0.45, h * 0.5, 1, w / 2, h * 0.56, m * 0.27);
      drum.addColorStop(0, '#d0ebff');
      drum.addColorStop(1, '#495057');
      circle(ctx, w / 2, h * 0.56, m * 0.26, drum);
      fillRR(ctx, w * 0.12, h * 0.1, w * 0.4, h * 0.1, 2, '#ced4da');
      circle(ctx, w * 0.78, h * 0.15, m * 0.06, '#868e96');
    } else if (base === 'smart_lock') {
      gloss(ctx, w * 0.3, h * 0.12, w * 0.4, h * 0.76, 3, '#212529');
      glass(ctx, w * 0.36, h * 0.2, w * 0.28, h * 0.3, 2, '#1864ab');
    } else if (base === 'mini_fan') {
      circle(ctx, w / 2, h / 2, m * 0.44, '#dee2e6');
      ring(ctx, w / 2, h / 2, m * 0.42, '#868e96', 1.5);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(w / 2 + Math.cos((i * 2 * Math.PI) / 3) * m * 0.2, h / 2 + Math.sin((i * 2 * Math.PI) / 3) * m * 0.2, m * 0.18, m * 0.08, (i * 2 * Math.PI) / 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(116, 192, 252, 0.75)';
        ctx.fill();
      }
      circle(ctx, w / 2, h / 2, m * 0.07, '#495057');
    } else gloss(ctx, 2, 2, w - 4, h - 4, 3, '#ced4da');
  } else if (cat === 'storage') {
    wood(ctx, 1, 1, w - 2, h - 2, 3, col);
    const doors = Math.max(2, Math.round(w / (h * 0.9)));
    for (let i = 1; i < doors; i++) fillRR(ctx, (w * i) / doors - 0.5, 2, 1, h - 4, 0, shade(col, -0.35));
    for (let i = 0; i < doors; i++) fillRR(ctx, (w * (i + 0.5)) / doors + (i % 2 ? -4 : 2), h * 0.62, 2, h * 0.18, 1, '#ced4da'); // handles
    if (base === 'bamboo_shelf') for (let i = 0; i < 5; i++) fillRR(ctx, w * (0.08 + i * 0.18), h * 0.2, w * 0.12, h * 0.35, 1, ['#e03131', '#2f9e44', '#fab005', '#1c7ed6', '#ae3ec9'][i]);
  } else if (cat === 'lighting') {
    const warm = base === 'cyber_lamp' ? '102,217,232' : '255,224,140';
    const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, m * 0.55);
    g.addColorStop(0, `rgba(${warm},0.65)`);
    g.addColorStop(1, `rgba(${warm},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (base === 'gold_chandelier') {
      for (let i = 0; i < 6; i++) circle(ctx, w / 2 + Math.cos(i) * m * 0.3, h / 2 + Math.sin(i) * m * 0.3, m * 0.07, '#fcc419');
      circle(ctx, w / 2, h / 2, m * 0.12, '#f08c00');
    } else {
      const shadeCol = base === 'paper_lantern' ? '#fff4e6' : base === 'cyber_lamp' ? '#22b8cf' : col;
      const lamp = ctx.createRadialGradient(w * 0.45, h * 0.45, 1, w / 2, h / 2, m * 0.26);
      lamp.addColorStop(0, '#fffbe6');
      lamp.addColorStop(1, shadeCol);
      circle(ctx, w / 2, h / 2, m * 0.25, lamp);
      ring(ctx, w / 2, h / 2, m * 0.25, shade(shadeCol, -0.3), 1);
    }
  } else if (cat === 'outdoor') {
    wood(ctx, 1, 1, w - 2, h - 2, 4, '#b08968');
    for (let i = 1; i < 6; i++) fillRR(ctx, 2, (h * i) / 6, w - 4, 1, 0, 'rgba(0,0,0,0.2)');
    circle(ctx, w / 2, h / 2, m * 0.22, '#e9ecef');
    ring(ctx, w / 2, h / 2, m * 0.22, '#adb5bd', 1);
    plant(ctx, w * 0.18, h * 0.2, m * 0.16, '#2f9e44');
    plant(ctx, w * 0.82, h * 0.8, m * 0.16, '#40c057');
  } else if (cat === 'chairs') {
    if (base === 'bean_bag') {
      fabric(ctx, w * 0.06, h * 0.08, w * 0.88, h * 0.84, m * 0.42, '#7950f2');
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.55, m * 0.2, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else {
      const plastic = base === 'plastic_chair';
      const c = plastic ? '#e03131' : col;
      if (plastic) {
        gloss(ctx, w * 0.12, h * 0.08, w * 0.76, h * 0.26, 4, shade(c, -0.15));
        gloss(ctx, w * 0.12, h * 0.3, w * 0.76, h * 0.6, 5, c);
      } else {
        wood(ctx, w * 0.12, h * 0.08, w * 0.76, h * 0.26, 3, shade(c, -0.15));
        fabric(ctx, w * 0.14, h * 0.3, w * 0.72, h * 0.6, 5, c);
      }
    }
  } else {
    // decor
    if (base === 'big_rug' || base === 'tatami_rug') {
      const tat = base === 'tatami_rug';
      fabric(ctx, 1, 1, w - 2, h - 2, 3, tat ? '#c9b37e' : '#c2255c');
      ctx.strokeStyle = tat ? '#5c7a3a' : '#ffd8a8';
      ctx.lineWidth = 2;
      ctx.strokeRect(w * 0.07, h * 0.07, w * 0.86, h * 0.86);
      if (tat) for (let i = 1; i < 4; i++) fillRR(ctx, 3, (h * i) / 4, w - 6, 1, 0, 'rgba(0,0,0,0.15)');
      else {
        fabric(ctx, w * 0.25, h * 0.25, w * 0.5, h * 0.5, m * 0.25, '#f06595');
        ctx.strokeStyle = '#fff3bf';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w / 2, h * 0.28);
        ctx.lineTo(w * 0.72, h / 2);
        ctx.lineTo(w / 2, h * 0.72);
        ctx.lineTo(w * 0.28, h / 2);
        ctx.closePath();
        ctx.stroke();
        // fringe
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        for (let x = 4; x < w - 2; x += 3) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 2);
          ctx.moveTo(x, h - 2);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
      }
    } else if (base === 'batik_painting' || base === 'neon_sign') {
      if (base === 'neon_sign') {
        glass(ctx, 1, h * 0.2, w - 2, h * 0.6, 2, '#141414');
        ctx.save();
        ctx.shadowColor = '#f783ac';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#ffdeeb';
        ctx.font = `900 ${Math.round(h * 0.36)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('OPEN', w / 2, h / 2 + 1);
        ctx.restore();
      } else {
        wood(ctx, 1, h * 0.18, w - 2, h * 0.64, 2, '#8d6e63');
        const art = ctx.createLinearGradient(0, 0, w, h);
        art.addColorStop(0, '#e8590c');
        art.addColorStop(0.5, '#fab005');
        art.addColorStop(1, '#1c7ed6');
        fillRR(ctx, 4, h * 0.25, w - 8, h * 0.5, 1, art);
        for (let i = 0; i < 4; i++) ring(ctx, w * (0.2 + i * 0.2), h / 2, m * 0.1, 'rgba(255,255,255,0.7)', 1);
      }
    } else {
      // plants
      plant(ctx, w / 2, h / 2, m * 0.48, base === 'bonsai' ? '#5c940d' : base === 'potted_monstera' ? '#2b8a3e' : '#37b24d', base === 'potted_monstera');
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

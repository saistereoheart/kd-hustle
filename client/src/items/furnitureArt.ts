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
  const base = LOOKS_LIKE[item] ?? item;
  if (drawSpecial(ctx, item, w, h, col, dk, m)) {
    ctx.restore();
    return;
  }
  if (cat === 'beds') {
    rr(ctx, 1, 1, w - 2, h - 2, m * 0.12, base === 'holo_bed' ? '#1098ad' : dk);
    rr(ctx, w * 0.06, h * 0.06, w * 0.88, h * 0.88, m * 0.1, '#f8f9fa');
    rr(ctx, w * 0.06, h * 0.32, w * 0.88, h * 0.62, m * 0.1, base === 'holo_bed' ? '#66d9e8' : col, dk);
    const pillows = w > h * 0.8 ? 2 : 1;
    for (let i = 0; i < pillows; i++) rr(ctx, w * 0.12 + (i * w * 0.78) / pillows, h * 0.1, (w * 0.7) / pillows, h * 0.16, m * 0.08, '#ffffff', '#dee2e6');
    if (base === 'holo_bed') {
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
    if (base === 'velvet_sofa') rr(ctx, w * 0.1, h * 0.05, w * 0.8, h * 0.08, 2, '#ffd43b');
  } else if (cat === 'tables') {
    if (base === 'dining_set') {
      for (const [cx, cy] of [[0.5, 0.12], [0.5, 0.88], [0.12, 0.5], [0.88, 0.5]]) rr(ctx, w * cx - m * 0.12, h * cy - m * 0.12, m * 0.24, m * 0.24, 3, dk);
      rr(ctx, w * 0.22, h * 0.22, w * 0.56, h * 0.56, 4, col, dk);
    } else {
      rr(ctx, 2, h * 0.12, w - 4, h * 0.76, 4, base === 'rgb_desk' ? '#212529' : col, dk);
      if (base === 'rgb_desk' || base === 'pipe_desk') {
        rr(ctx, w * 0.35, h * 0.25, w * 0.3, h * 0.3, 2, '#343a40');
        if (base === 'rgb_desk') {
          const g = ctx.createLinearGradient(0, 0, w, 0);
          for (const [k, c] of [[0, '#ff6b6b'], [0.33, '#ffd43b'], [0.66, '#51cf66'], [1, '#4dabf7']] as const) g.addColorStop(k, c);
          ctx.strokeStyle = g;
          ctx.lineWidth = 2.5;
          ctx.strokeRect(3, h * 0.14, w - 6, h * 0.72);
        }
      } else circle(ctx, w / 2, h / 2, m * 0.18, '#f1f3f5');
    }
  } else if (cat === 'bathroom') {
    if (base === 'toilet') {
      rr(ctx, w * 0.2, 2, w * 0.6, h * 0.3, 3, '#e9ecef', '#adb5bd');
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.6, w * 0.3, h * 0.32, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#f8f9fa';
      ctx.fill();
      ctx.strokeStyle = '#adb5bd';
      ctx.stroke();
      circle(ctx, w / 2, h * 0.62, m * 0.14, '#a5d8ff');
    } else if (base === 'shower') {
      rr(ctx, 2, 2, w - 4, h - 4, 3, '#d0ebff', '#74c0fc');
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) circle(ctx, w * (0.2 + i * 0.2), h * (0.2 + j * 0.2), m * 0.03, '#4dabf7');
    } else {
      rr(ctx, 2, 2, w - 4, h - 4, m * 0.4, '#f8f9fa', '#ced4da');
      rr(ctx, w * 0.1, h * 0.18, w * 0.8, h * 0.64, m * 0.3, '#a5d8ff');
      circle(ctx, w * 0.85, h / 2, m * 0.06, '#fcc419');
    }
  } else if (cat === 'kitchen') {
    if (base === 'coffee_machine') {
      rr(ctx, w * 0.15, h * 0.1, w * 0.7, h * 0.8, 4, '#343a40');
      circle(ctx, w / 2, h * 0.55, m * 0.16, '#8d5a33');
    } else {
      rr(ctx, 1, 1, w - 2, h - 2, 3, '#dee2e6', '#868e96');
      rr(ctx, w * 0.06, h * 0.15, w * 0.3, h * 0.7, 2, '#a5d8ff'); // sink
      for (const k of [0.6, 0.8]) circle(ctx, w * k, h * 0.35, m * 0.12, '#343a40'); // hob
      if (base === 'island_kitchen') rr(ctx, 1, h * 0.75, w - 2, h * 0.2, 2, '#495057');
    }
  } else if (cat === 'appliances') {
    if (base === 'aircond') {
      rr(ctx, 1, h * 0.15, w - 2, h * 0.7, m * 0.15, '#f8f9fa', '#ced4da');
      for (let i = 0; i < 4; i++) rr(ctx, w * 0.1, h * (0.35 + i * 0.1), w * 0.8, 1.5, 0, '#adb5bd');
      circle(ctx, w * 0.9, h * 0.3, 2, '#40c057');
    } else if (base === 'wifi_router') {
      rr(ctx, w * 0.2, h * 0.45, w * 0.6, h * 0.35, 3, '#343a40');
      for (const k of [0.3, 0.7]) rr(ctx, w * k - 1, h * 0.1, 2.5, h * 0.4, 1, '#495057');
      circle(ctx, w * 0.35, h * 0.62, 1.8, '#51cf66');
      circle(ctx, w * 0.5, h * 0.62, 1.8, '#51cf66');
    } else if (base === 'smart_tv') {
      rr(ctx, 1, h * 0.2, w - 2, h * 0.6, 2, '#212529');
      rr(ctx, 3, h * 0.28, w - 6, h * 0.44, 1, '#4dabf7');
    } else if (base === 'washer') {
      rr(ctx, 2, 2, w - 4, h - 4, 4, '#f8f9fa', '#adb5bd');
      circle(ctx, w / 2, h * 0.56, m * 0.28, '#495057');
      circle(ctx, w / 2, h * 0.56, m * 0.2, '#a5d8ff');
    } else if (base === 'smart_lock') {
      rr(ctx, w * 0.3, h * 0.15, w * 0.4, h * 0.7, 3, '#212529');
      circle(ctx, w / 2, h * 0.4, m * 0.08, '#4dabf7');
    } else if (base === 'mini_fan') {
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
    if (base === 'bamboo_shelf') for (let i = 0; i < 5; i++) circle(ctx, w * (0.15 + i * 0.17), h / 2, m * 0.12, ['#e03131', '#2f9e44', '#fab005', '#1c7ed6', '#ae3ec9'][i]);
  } else if (cat === 'lighting') {
    if (base === 'gold_chandelier') {
      circle(ctx, w / 2, h / 2, m * 0.45, 'rgba(255,224,102,0.35)');
      for (let i = 0; i < 6; i++) circle(ctx, w / 2 + Math.cos(i) * m * 0.3, h / 2 + Math.sin(i) * m * 0.3, m * 0.07, '#fcc419');
      circle(ctx, w / 2, h / 2, m * 0.12, '#f08c00');
    } else {
      circle(ctx, w / 2, h / 2, m * 0.42, base === 'cyber_lamp' ? 'rgba(102,217,232,0.4)' : 'rgba(255,236,153,0.45)');
      circle(ctx, w / 2, h / 2, m * 0.22, base === 'paper_lantern' ? '#fff4e6' : base === 'cyber_lamp' ? '#22b8cf' : col);
      circle(ctx, w / 2, h / 2, m * 0.08, '#fff9db');
    }
  } else if (cat === 'outdoor') {
    rr(ctx, 1, 1, w - 2, h - 2, 4, '#c49a6c', '#8d6e63');
    circle(ctx, w / 2, h / 2, m * 0.22, '#f1f3f5');
    for (const [x, y] of [[0.2, 0.2], [0.8, 0.8]]) circle(ctx, w * x, h * y, m * 0.12, '#2f9e44');
  } else if (cat === 'chairs') {
    if (base === 'bean_bag') {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w * 0.45, h * 0.42, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#7950f2';
      ctx.fill();
    } else {
      rr(ctx, w * 0.15, h * 0.1, w * 0.7, h * 0.22, 3, base === 'plastic_chair' ? '#c92a2a' : dk);
      rr(ctx, w * 0.15, h * 0.3, w * 0.7, h * 0.6, 4, base === 'plastic_chair' ? '#e03131' : col);
    }
  } else {
    // decor
    if (base === 'big_rug') {
      rr(ctx, 1, 1, w - 2, h - 2, 4, '#e64980');
      rr(ctx, w * 0.1, h * 0.1, w * 0.8, h * 0.8, 3, '#f783ac');
      rr(ctx, w * 0.25, h * 0.25, w * 0.5, h * 0.5, 2, '#fcc2d7');
    } else if (base === 'batik_painting' || base === 'neon_sign') {
      rr(ctx, 1, h * 0.2, w - 2, h * 0.6, 2, base === 'neon_sign' ? '#212529' : '#8d6e63');
      if (base === 'neon_sign') {
        ctx.fillStyle = '#f783ac';
        ctx.font = `900 ${Math.round(h * 0.38)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('OPEN', w / 2, h / 2 + 1);
      } else for (let i = 0; i < 3; i++) circle(ctx, w * (0.3 + i * 0.2), h / 2, m * 0.12, ['#e8590c', '#1c7ed6', '#2f9e44'][i]);
    } else {
      // plants, bonsai
      rr(ctx, w * 0.3, h * 0.55, w * 0.4, h * 0.35, 3, '#c4703a');
      circle(ctx, w / 2, h * 0.42, m * 0.32, base === 'bonsai' ? '#5c940d' : '#2f9e44');
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

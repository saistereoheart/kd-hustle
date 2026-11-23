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
  void dk;
  switch (item) {
    case 'canopy_bed': {
      // carved dark wood frame, gold posts, cream sheets, a deep red quilt, sheer curtains
      wood(ctx, 1, 1, w - 2, h - 2, m * 0.08, '#6b3f26');
      wood(ctx, 1, 1, w - 2, h * 0.12, m * 0.06, '#4e2c19');
      fillRR(ctx, w * 0.08, h * 0.12, w * 0.84, h * 0.82, m * 0.06, lit(ctx, 0, 0, w, h, '#fff9db', 0.08));
      fabric(ctx, w * 0.08, h * 0.36, w * 0.84, h * 0.58, m * 0.06, '#a61e4d');
      ctx.strokeStyle = 'rgba(255, 212, 59, 0.6)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(w * 0.1, h * (0.36 + i * 0.14));
        ctx.lineTo(w * 0.9, h * (0.36 + i * 0.14));
        ctx.stroke();
      }
      fillRR(ctx, w * 0.08, h * 0.34, w * 0.84, h * 0.05, 2, '#f1f3f5');
      for (let i = 0; i < 3; i++) pillow(ctx, w * (0.12 + i * 0.26), h * 0.14, w * 0.22, h * 0.15, i === 1 ? '#ffd8a8' : '#ffffff');
      for (const [x, y] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]]) {
        const g = ctx.createRadialGradient(w * x - 1, h * y - 1, 0.5, w * x, h * y, m * 0.07);
        g.addColorStop(0, '#fff3bf');
        g.addColorStop(1, '#e8a700');
        circle(ctx, w * x, h * y, m * 0.065, g);
      }
      ctx.fillStyle = 'rgba(255, 244, 230, 0.28)'; // sheer curtains along the sides
      ctx.fillRect(w * 0.02, h * 0.08, w * 0.06, h * 0.84);
      ctx.fillRect(w * 0.92, h * 0.08, w * 0.06, h * 0.84);
      return true;
    }
    case 'jacuzzi': {
      const c = w / 2, r = m * 0.48;
      const rim = ctx.createRadialGradient(c - r * 0.3, c - r * 0.3, 1, c, c, r);
      rim.addColorStop(0, '#ffffff');
      rim.addColorStop(1, '#ced4da');
      circle(ctx, c, h / 2, r, rim);
      const water = ctx.createRadialGradient(c, h / 2, 1, c, h / 2, r * 0.82);
      water.addColorStop(0, '#99e9f2');
      water.addColorStop(1, '#1c7ed6');
      circle(ctx, c, h / 2, r * 0.82, water);
      for (let i = 0; i < 6; i++) ring(ctx, c, h / 2, r * (0.2 + i * 0.1), 'rgba(255,255,255,0.18)', 1);
      for (let i = 0; i < 16; i++) circle(ctx, c + Math.cos(i * 1.7) * r * 0.55, h / 2 + Math.sin(i * 2.3) * r * 0.5, m * (0.015 + (i % 3) * 0.01), 'rgba(255,255,255,0.85)');
      for (let i = 0; i < 6; i++) circle(ctx, c + Math.cos((i * Math.PI) / 3) * r * 0.72, h / 2 + Math.sin((i * Math.PI) / 3) * r * 0.72, m * 0.025, '#adb5bd'); // jets
      return true;
    }
    case 'vanity_sink': {
      wood(ctx, 1, 1, w - 2, h - 2, 3, col);
      stone(ctx, 2, 2, w - 4, h * 0.6, 3, '#f1f3f5');
      const basin = ctx.createRadialGradient(w / 2, h * 0.32, 1, w / 2, h * 0.32, m * 0.3);
      basin.addColorStop(0, '#ffffff');
      basin.addColorStop(1, '#ced4da');
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.34, w * 0.2, h * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = basin;
      ctx.fill();
      circle(ctx, w / 2, h * 0.36, m * 0.035, '#868e96');
      gloss(ctx, w * 0.47, h * 0.05, w * 0.06, h * 0.13, 1, '#adb5bd');
      for (const x of [0.25, 0.75]) fillRR(ctx, w * x - 2, h * 0.78, 4, h * 0.1, 1, '#dee2e6'); // drawer pulls
      return true;
    }
    case 'fridge': {
      gloss(ctx, w * 0.08, 2, w * 0.84, h - 4, 4, '#e9ecef');
      fillRR(ctx, w / 2 - 0.5, 4, 1, h - 8, 0, 'rgba(0,0,0,0.25)');
      for (const x of [0.4, 0.58]) gloss(ctx, w * x, h * 0.3, 2.5, h * 0.35, 1, '#868e96');
      glass(ctx, w * 0.62, h * 0.08, w * 0.22, h * 0.14, 2, '#1864ab'); // the little display
      return true;
    }
    case 'kampung_dapur':
    case 'chef_kitchen': {
      const chef = item === 'chef_kitchen';
      if (chef) stone(ctx, 1, 1, w - 2, h - 2, 3, '#343a40');
      else wood(ctx, 1, 1, w - 2, h - 2, 3, '#8d6e63');
      const sink = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.8);
      sink.addColorStop(0, '#868e96');
      sink.addColorStop(1, '#dee2e6');
      fillRR(ctx, w * 0.05, h * 0.2, w * 0.24, h * 0.6, 2, sink);
      gloss(ctx, w * 0.15, h * 0.06, w * 0.04, h * 0.16, 1, '#adb5bd');
      const n = chef ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const x = w * (0.42 + i * (0.5 / n)), y = h / 2;
        circle(ctx, x, y, m * 0.14, chef ? '#111' : '#495057');
        ring(ctx, x, y, m * 0.1, chef ? '#ff6b6b' : '#868e96', 1.5);
        ring(ctx, x, y, m * 0.05, chef ? '#ff8787' : '#868e96', 1);
      }
      if (!chef) {
        // a clay pot of rendang bubbling on the wood stove
        circle(ctx, w * 0.55, h / 2, m * 0.17, '#7a3e1b');
        circle(ctx, w * 0.55, h / 2, m * 0.12, '#5a2d0f');
      } else fillRR(ctx, w * 0.06, h * 0.86, w * 0.88, h * 0.06, 1, '#fcc419');
      return true;
    }
    case 'bar_counter': {
      wood(ctx, 1, h * 0.08, w - 2, h * 0.56, 4, '#3b2a20');
      stone(ctx, 2, h * 0.08, w - 4, h * 0.14, 3, '#adb5bd');
      for (let i = 0; i < 4; i++) {
        const bx = w * (0.12 + i * 0.2);
        gloss(ctx, bx, h * 0.22, m * 0.09, m * 0.24, 2, ['#2f9e44', '#e8590c', '#1c7ed6', '#fab005'][i]);
      }
      for (let i = 0; i < 3; i++) {
        const sx = w * (0.2 + i * 0.3);
        circle(ctx, sx, h * 0.83, m * 0.14, '#212529');
        const seat = ctx.createRadialGradient(sx - 2, h * 0.81, 1, sx, h * 0.83, m * 0.12);
        seat.addColorStop(0, '#ff8787');
        seat.addColorStop(1, '#c92a2a');
        circle(ctx, sx, h * 0.83, m * 0.11, seat);
      }
      return true;
    }
    case 'console_set': {
      wood(ctx, 1, h * 0.2, w - 2, h * 0.6, 3, '#343a40');
      glass(ctx, w * 0.08, h * 0.3, w * 0.34, h * 0.4, 3, '#212529');
      circle(ctx, w * 0.36, h * 0.36, 1.5, '#4dabf7');
      // a controller
      fillRR(ctx, w * 0.55, h * 0.36, w * 0.3, h * 0.26, h * 0.13, lit(ctx, w * 0.55, h * 0.36, w * 0.3, h * 0.26, '#495057'));
      circle(ctx, w * 0.62, h * 0.49, m * 0.05, '#212529');
      for (const [dx, dy, c] of [[0.76, 0.43, '#ff6b6b'], [0.8, 0.5, '#51cf66'], [0.72, 0.5, '#4dabf7'], [0.76, 0.56, '#ffd43b']] as const) circle(ctx, w * dx, h * dy, 1.5, c);
      return true;
    }
    case 'robot_vacuum': {
      const g = ctx.createRadialGradient(w * 0.42, h * 0.4, 1, w / 2, h / 2, m * 0.42);
      g.addColorStop(0, '#495057');
      g.addColorStop(1, '#16181d');
      circle(ctx, w / 2, h / 2, m * 0.42, g);
      ring(ctx, w / 2, h / 2, m * 0.33, '#22b8cf', 2);
      circle(ctx, w / 2, h * 0.3, m * 0.06, '#51cf66');
      fillRR(ctx, w * 0.35, h * 0.72, w * 0.3, h * 0.06, 2, '#868e96');
      return true;
    }
    case 'bbq_pit': {
      fillRR(ctx, w * 0.04, h * 0.12, w * 0.92, h * 0.76, m * 0.3, lit(ctx, 0, 0, w, h, '#2b2b2b'));
      const coals = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, m * 0.5);
      coals.addColorStop(0, '#ff922b');
      coals.addColorStop(1, '#5c0a0a');
      fillRR(ctx, w * 0.1, h * 0.22, w * 0.8, h * 0.56, m * 0.22, coals);
      ctx.strokeStyle = '#ced4da';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.moveTo(w * (0.12 + i * 0.095), h * 0.2);
        ctx.lineTo(w * (0.12 + i * 0.095), h * 0.8);
        ctx.stroke();
      }
      for (let i = 0; i < 4; i++) fillRR(ctx, w * (0.18 + i * 0.17), h * 0.36, w * 0.11, h * 0.28, 3, lit(ctx, 0, 0, w, h, '#c2410c')); // satay sticks
      return true;
    }
    case 'hammock': {
      for (const x of [0.04, 0.96]) wood(ctx, w * x - m * 0.07, h / 2 - m * 0.07, m * 0.14, m * 0.14, 2, '#6d4c41');
      ctx.strokeStyle = '#a0826d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w * 0.06, h / 2);
      ctx.lineTo(w * 0.18, h * 0.3);
      ctx.moveTo(w * 0.06, h / 2);
      ctx.lineTo(w * 0.18, h * 0.7);
      ctx.moveTo(w * 0.94, h / 2);
      ctx.lineTo(w * 0.82, h * 0.3);
      ctx.moveTo(w * 0.94, h / 2);
      ctx.lineTo(w * 0.82, h * 0.7);
      ctx.stroke();
      fabric(ctx, w * 0.16, h * 0.24, w * 0.68, h * 0.52, m * 0.25, col);
      for (let i = 1; i < 5; i++) fillRR(ctx, w * 0.18, h * (0.24 + i * 0.1), w * 0.64, 1, 0, 'rgba(255,255,255,0.3)');
      return true;
    }
    case 'rooftop_lounge': {
      wood(ctx, 1, 1, w - 2, h - 2, 4, '#c8a27a');
      for (let i = 1; i < 8; i++) fillRR(ctx, 2, (h * i) / 8, w - 4, 1, 0, 'rgba(0,0,0,0.18)');
      fabric(ctx, w * 0.06, h * 0.1, w * 0.38, h * 0.3, m * 0.08, '#f8f9fa'); // loungers
      fabric(ctx, w * 0.56, h * 0.1, w * 0.38, h * 0.3, m * 0.08, '#f8f9fa');
      const pool = ctx.createLinearGradient(0, h * 0.5, 0, h * 0.95);
      pool.addColorStop(0, '#66d9e8');
      pool.addColorStop(1, '#1098ad');
      fillRR(ctx, w * 0.08, h * 0.52, w * 0.84, h * 0.4, 4, pool);
      for (let i = 0; i < 4; i++) ring(ctx, w * (0.25 + i * 0.17), h * 0.72, m * 0.05, 'rgba(255,255,255,0.45)', 1);
      plant(ctx, w * 0.5, h * 0.25, m * 0.12, '#2f9e44');
      return true;
    }
    case 'cyber_sofa': {
      fabric(ctx, 1, 1, w - 2, h - 2, m * 0.2, '#16181d');
      fabric(ctx, w * 0.06, h * 0.08, w * 0.88, h * 0.3, m * 0.12, '#212529');
      const seats = Math.max(2, Math.round(w / h));
      for (let i = 0; i < seats; i++) fabric(ctx, w * 0.08 + (i * w * 0.84) / seats + 1, h * 0.4, (w * 0.84) / seats - 2, h * 0.5, m * 0.1, '#2b2f3a');
      ctx.save();
      ctx.shadowColor = '#22b8cf';
      ctx.shadowBlur = 6;
      ctx.strokeStyle = '#66d9e8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(2, 2, w - 4, h - 4, m * 0.2);
      ctx.stroke();
      ctx.restore();
      return true;
    }
    case 'pendant_lights':
    case 'pelita_lamp': {
      const pelita = item === 'pelita_lamp';
      const n = pelita ? 1 : 3;
      for (let i = 0; i < n; i++) {
        const x = w * (n === 1 ? 0.5 : 0.2 + i * 0.3), y = h / 2;
        const glow = ctx.createRadialGradient(x, y, 1, x, y, m * (pelita ? 0.5 : 0.3));
        glow.addColorStop(0, 'rgba(255, 224, 140, 0.7)');
        glow.addColorStop(1, 'rgba(255, 224, 140, 0)');
        circle(ctx, x, y, m * (pelita ? 0.5 : 0.3), glow);
        if (pelita) {
          circle(ctx, x, y, m * 0.18, lit(ctx, x - m * 0.18, y - m * 0.18, m * 0.36, m * 0.36, '#b08968'));
          circle(ctx, x, y - m * 0.02, m * 0.06, '#ffd43b');
        } else {
          circle(ctx, x, y, m * 0.11, lit(ctx, x - m * 0.11, y - m * 0.11, m * 0.22, m * 0.22, '#343a40'));
          circle(ctx, x, y, m * 0.05, '#fff3bf');
        }
      }
      return true;
    }
    case 'rgb_strip': {
      fillRR(ctx, 1, h * 0.4, w - 2, h * 0.2, 2, '#212529');
      const g = ctx.createLinearGradient(0, 0, w, 0);
      for (const [k, c] of [[0, '#ff6b6b'], [0.25, '#ffd43b'], [0.5, '#51cf66'], [0.75, '#4dabf7'], [1, '#be4bdb']] as const) g.addColorStop(k, c);
      ctx.save();
      ctx.shadowColor = '#be4bdb';
      ctx.shadowBlur = 8;
      fillRR(ctx, 3, h * 0.44, w - 6, h * 0.12, 2, g);
      ctx.restore();
      return true;
    }
    case 'wau_kite': {
      // the moon kite: a crescent tail, wings, painted in kampung colours
      ctx.save();
      const body = ctx.createLinearGradient(0, 0, w, h);
      body.addColorStop(0, '#e03131');
      body.addColorStop(1, '#a61e4d');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.05);
      ctx.quadraticCurveTo(w * 0.98, h * 0.3, w * 0.62, h * 0.55);
      ctx.lineTo(w / 2, h * 0.62);
      ctx.lineTo(w * 0.38, h * 0.55);
      ctx.quadraticCurveTo(w * 0.02, h * 0.3, w / 2, h * 0.05);
      ctx.fill();
      ctx.fillStyle = '#ffd43b';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.78, m * 0.22, Math.PI * 1.1, Math.PI * 1.9, true);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.08);
      ctx.lineTo(w / 2, h * 0.6);
      ctx.stroke();
      circle(ctx, w / 2, h * 0.36, m * 0.09, '#1c7ed6');
      ring(ctx, w / 2, h * 0.36, m * 0.13, '#ffd43b', 1.5);
      ctx.restore();
      return true;
    }
    case 'aquarium': {
      wood(ctx, 1, h * 0.08, w - 2, h * 0.84, 3, '#343a40');
      const water = ctx.createLinearGradient(0, h * 0.12, 0, h * 0.88);
      water.addColorStop(0, '#99e9f2');
      water.addColorStop(1, '#1971c2');
      fillRR(ctx, 4, h * 0.14, w - 8, h * 0.72, 2, water);
      fillRR(ctx, 4, h * 0.72, w - 8, h * 0.14, 2, lit(ctx, 0, h * 0.7, w, h * 0.2, '#e9c46a'));
      for (const x of [0.12, 0.42, 0.85]) {
        ctx.strokeStyle = '#2f9e44';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(w * x, h * 0.84);
        ctx.quadraticCurveTo(w * x + 3, h * 0.6, w * x - 2, h * 0.4);
        ctx.stroke();
      }
      for (const [x, y, c] of [[0.28, 0.4, '#ff922b'], [0.6, 0.32, '#fcc419'], [0.75, 0.55, '#f06595']] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(w * x, h * y, m * 0.11, m * 0.065, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(w * x - m * 0.09, h * y);
        ctx.lineTo(w * x - m * 0.19, h * y - m * 0.07);
        ctx.lineTo(w * x - m * 0.19, h * y + m * 0.07);
        ctx.fill();
        circle(ctx, w * x + m * 0.06, h * y - m * 0.01, 1, '#111');
      }
      for (let i = 0; i < 6; i++) circle(ctx, w * 0.9, h * (0.2 + i * 0.08), 1.2, 'rgba(255,255,255,0.8)');
      glass(ctx, 4, h * 0.14, w - 8, h * 0.72, 2, 'rgba(0,0,0,0)');
      return true;
    }
    case 'gold_statue': {
      // a lucky cat on a plinth
      wood(ctx, w * 0.12, h * 0.6, w * 0.76, h * 0.34, 3, '#3b2a20');
      const gold = (x: number, y: number, r: number) => {
        const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 1, x, y, r);
        g.addColorStop(0, '#fff3bf');
        g.addColorStop(0.5, '#fcc419');
        g.addColorStop(1, '#b08500');
        circle(ctx, x, y, r, g);
      };
      gold(w / 2, h * 0.55, m * 0.3);
      gold(w / 2, h * 0.3, m * 0.22);
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#e8a700';
        ctx.beginPath();
        ctx.moveTo(w / 2 + s * m * 0.08, h * 0.14);
        ctx.lineTo(w / 2 + s * m * 0.2, h * 0.04);
        ctx.lineTo(w / 2 + s * m * 0.22, h * 0.2);
        ctx.fill();
      }
      gold(w * 0.7, h * 0.22, m * 0.08); // the waving paw
      circle(ctx, w / 2, h * 0.56, m * 0.08, '#e03131');
      return true;
    }
    case 'hologram': {
      wood(ctx, w * 0.25, h * 0.68, w * 0.5, h * 0.24, 3, '#343a40');
      const beam = ctx.createLinearGradient(0, h * 0.68, 0, h * 0.05);
      beam.addColorStop(0, 'rgba(102, 217, 232, 0.65)');
      beam.addColorStop(1, 'rgba(102, 217, 232, 0.05)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(w * 0.4, h * 0.7);
      ctx.lineTo(w * 0.08, h * 0.06);
      ctx.lineTo(w * 0.92, h * 0.06);
      ctx.lineTo(w * 0.6, h * 0.7);
      ctx.fill();
      ring(ctx, w / 2, h * 0.3, m * 0.16, 'rgba(197, 246, 250, 0.9)', 1.5);
      circle(ctx, w / 2, h * 0.3, m * 0.08, 'rgba(197, 246, 250, 0.8)');
      for (let i = 0; i < 4; i++) fillRR(ctx, w * 0.2, h * (0.12 + i * 0.12), w * 0.6, 0.8, 0, 'rgba(197, 246, 250, 0.35)');
      return true;
    }
    case 'throne':
    case 'gaming_chair': {
      const throne = item === 'throne';
      if (throne) {
        wood(ctx, w * 0.06, h * 0.02, w * 0.88, h * 0.44, m * 0.15, '#e8a700');
        for (const x of [0.25, 0.5, 0.75]) circle(ctx, w * x, h * 0.1, m * 0.06, '#e03131');
        fabric(ctx, w * 0.14, h * 0.3, w * 0.72, h * 0.62, m * 0.12, '#862e9c');
        for (const x of [0.06, 0.82]) wood(ctx, w * x, h * 0.3, w * 0.12, h * 0.6, 3, '#d49a00');
      } else {
        fabric(ctx, w * 0.12, h * 0.02, w * 0.76, h * 0.44, m * 0.15, '#212529');
        fillRR(ctx, w * 0.42, h * 0.06, w * 0.16, h * 0.36, 2, '#be4bdb');
        fabric(ctx, w * 0.16, h * 0.34, w * 0.68, h * 0.58, m * 0.12, '#343a40');
        for (const x of [0.08, 0.84]) fillRR(ctx, w * x, h * 0.4, w * 0.08, h * 0.4, 3, '#be4bdb');
      }
      return true;
    }
    case 'shoe_rack': {
      wood(ctx, 1, 1, w - 2, h - 2, 2, '#8d6e63');
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 2; j++) {
          const c = ['#e03131', '#1c7ed6', '#f8f9fa'][(i + j) % 3];
          fillRR(ctx, w * (0.1 + j * 0.44), h * (0.1 + i * 0.29), w * 0.36, h * 0.2, h * 0.1, lit(ctx, 0, 0, w, h, c));
          fillRR(ctx, w * (0.1 + j * 0.44), h * (0.1 + i * 0.29) + h * 0.14, w * 0.36, h * 0.04, 1, 'rgba(255,255,255,0.8)'); // soles
        }
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

// ------------------------------------------------------------------ height (the 3D look)
/** How tall pieces stand, as a share of a cell (1 m): their top is lifted by this much and the
 *  front face shows below it. Rugs lie flat; wall pieces stick out a little. */
const HEIGHT_BY_CAT: Record<string, number> = {
  beds: 0.24, sofas: 0.32, tables: 0.28, storage: 0.62, kitchen: 0.38, bathroom: 0.24, appliances: 0.28,
  lighting: 0.14, outdoor: 0.16, chairs: 0.3, decor: 0.26,
};
const HEIGHT_OF: Record<string, number> = {
  fridge: 0.8, wardrobe: 0.75, walk_in_closet: 0.75, bookshelf: 0.7, bamboo_shelf: 0.6, shoe_rack: 0.36, canopy_bed: 0.34,
  shower: 0.05, rain_shower: 0.05, bathtub: 0.28, jacuzzi: 0.2, washer: 0.48, dryer: 0.48, robot_vacuum: 0.06,
  coffee_machine: 0.32, teh_station: 0.32, mini_fan: 0.3, standing_fan: 0.5, floor_lamp: 0.55, edison_lamp: 0.45,
  aquarium: 0.45, gold_statue: 0.5, hologram: 0.1, bbq_pit: 0.28, hammock: 0.1, rooftop_lounge: 0.06, bean_bag: 0.2, bean_sofa: 0.22,
};
export function pieceHeight(item: string): number {
  const p = furniturePiece(item);
  if (!p || p.floor) return 0;
  if (p.wall) return 0.12;
  return HEIGHT_OF[item] ?? HEIGHT_BY_CAT[p.category] ?? 0.22;
}

/** A darker copy of a piece (its sides), same outline. */
function sides(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const x = c.getContext('2d')!;
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = 'rgba(20, 14, 10, 0.45)';
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * Stamps a piece's drawing (`body`, the top seen from above) onto the floor box (x, y, w, h) as
 * a solid thing `d` px tall: a soft shadow on the floor, darker sides rising from it, and the top
 * lifted by `d`. The height always points up the screen, however the piece is turned.
 */
function stamp(ctx: Ctx, body: HTMLCanvasElement, x: number, y: number, w: number, h: number, d: number, k: number, floor: boolean) {
  const m = Math.min(w, h);
  if (floor || d < 1) {
    ctx.drawImage(body, x, y, w, h);
    return;
  }
  const dark = sides(body);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = m * 0.14 * k;
  ctx.shadowOffsetX = m * 0.05 * k;
  ctx.shadowOffsetY = m * 0.06 * k;
  ctx.drawImage(dark, x, y, w, h);
  ctx.restore();
  for (let i = 1; i < d; i++) ctx.drawImage(dark, x, y - i, w, h);
  // A thin lit rim where the top meets the sides.
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.drawImage(body, x, y - d + 1, w, h);
  ctx.restore();
  ctx.drawImage(body, x, y - d, w, h);
}

function scaleOf(ctx: Ctx): number {
  const t = ctx.getTransform();
  return Math.max(1, Math.hypot(t.a, t.b));
}

/**
 * Draws `item` in the box (0,0)-(w,h), standing up: its top in the upper part, the front face
 * below it, a shadow that follows its real outline. (Item icons and the shop use this.)
 */
export function drawFurniturePiece(ctx: Ctx, item: string, w: number, h: number, variant = 'normal') {
  const k = scaleOf(ctx);
  const floor = !!furniturePiece(item)?.floor;
  const d = floor ? 0 : Math.round(pieceHeight(item) * Math.min(w, h) * 0.45);
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.ceil(w * k));
  off.height = Math.max(1, Math.ceil((h - d) * k));
  const o = off.getContext('2d')!;
  o.scale(k, k);
  drawPieceBody(o, item, w, h - d);
  variantFinish(o, variant, w, h - d);
  stamp(ctx, off, 0, d, w, h - d, d, k, floor);
}

/**
 * ✨ A variant's finish over a piece already drawn (only where it's drawn): Shiny = a sheen and glints,
 * Golden = gold all over, Rainbow = rainbow colours and glints. Normal: nothing.
 */
function variantFinish(o: Ctx, variant: string, w: number, h: number) {
  if (!variant || variant === 'normal') return;
  const top = variant.split(',').includes('rainbow') ? 'rainbow' : variant.split(',').includes('golden') ? 'golden' : variant.split(',').includes('shiny') ? 'shiny' : '';
  if (!top) return;
  o.save();
  o.globalCompositeOperation = 'source-atop';
  if (top === 'golden') {
    const g = o.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,243,191,0.75)');
    g.addColorStop(0.5, 'rgba(252,196,25,0.62)');
    g.addColorStop(1, 'rgba(192,138,0,0.7)');
    o.fillStyle = g;
    o.fillRect(0, 0, w, h);
  } else if (top === 'rainbow') {
    const g = o.createLinearGradient(0, 0, w, h);
    ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa', '#f783ac'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    o.globalAlpha = 0.5;
    o.fillStyle = g;
    o.fillRect(0, 0, w, h);
  } else {
    // Shiny: a diagonal sheen.
    const g = o.createLinearGradient(0, 0, w, h);
    g.addColorStop(0.2, 'rgba(255,255,255,0)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.8, 'rgba(255,255,255,0)');
    o.fillStyle = g;
    o.fillRect(0, 0, w, h);
  }
  o.restore();
  if (top === 'shiny' || top === 'rainbow' || top === 'golden') {
    // Glints (on top, a little outside is fine).
    o.save();
    o.fillStyle = '#ffffff';
    const r = Math.max(1.2, Math.min(w, h) * 0.09);
    for (const [fx, fy] of [[0.22, 0.25], [0.78, 0.4], [0.5, 0.78]]) {
      const x = w * fx, y = h * fy;
      o.beginPath();
      o.moveTo(x, y - r);
      o.lineTo(x + r * 0.25, y - r * 0.25);
      o.lineTo(x + r, y);
      o.lineTo(x + r * 0.25, y + r * 0.25);
      o.lineTo(x, y + r);
      o.lineTo(x - r * 0.25, y + r * 0.25);
      o.lineTo(x - r, y);
      o.lineTo(x - r * 0.25, y - r * 0.25);
      o.closePath();
      o.fill();
    }
    o.restore();
  }
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

/** Draws a piece rotated by `rot` quarter turns into the cell box at (x, y), cell size `c` px,
 *  standing up out of the floor (see stamp). */
export function drawPlaced(ctx: Ctx, item: string, x: number, y: number, rot: number, c: number, variant = 'normal') {
  const p = furniturePiece(item);
  if (!p) return;
  const [fw, fh] = rot % 2 ? [p.h, p.w] : [p.w, p.h];
  const W = fw * c, H = fh * c;
  const k = scaleOf(ctx);
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.ceil(W * k));
  off.height = Math.max(1, Math.ceil(H * k));
  const o = off.getContext('2d')!;
  o.scale(k, k);
  o.translate(W / 2, H / 2);
  o.rotate((rot * Math.PI) / 2);
  o.translate((-p.w * c) / 2, (-p.h * c) / 2);
  drawPieceBody(o, item, p.w * c, p.h * c);
  variantFinish(o, variant, p.w * c, p.h * c);
  stamp(ctx, off, x * c, y * c, W, H, Math.round(pieceHeight(item) * c * 0.7), k, !!p.floor);
}

// Food drawn in code for the cooking screen: stainless-steel trays of nasi lemak sides and
// add-ons (glossy sambal, peanuts with their skins, ikan bilis, timun, egg halves, ayam goreng,
// paru, sambal kerang, telur mata, rendang), and the same food served on a plate.
// Everything is seeded per item so it doesn't flicker when redrawn every frame.
type Ctx = CanvasRenderingContext2D;

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
const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
  ctx.fill();
}

/** A blob with a wobbly edge (sauces, gravies). */
function blob(ctx: Ctx, x: number, y: number, rx: number, ry: number, r: () => number, fill: string | CanvasGradient) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.85 + r() * 0.25;
    const px = x + Math.cos(a) * rx * k, py = y + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.quadraticCurveTo(x + Math.cos(a - Math.PI / n) * rx * 1.05, y + Math.sin(a - Math.PI / n) * ry * 1.05, px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/** A stainless gastronorm tray seen from above: bright rim, darker brushed inside. */
export function drawTray(ctx: Ctx, x: number, y: number, w: number, h: number) {
  const rim = ctx.createLinearGradient(x, y, x + w, y + h);
  rim.addColorStop(0, '#f1f3f5');
  rim.addColorStop(0.45, '#adb5bd');
  rim.addColorStop(0.55, '#dee2e6');
  rim.addColorStop(1, '#868e96');
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 3, w, h, 7);
  ctx.fill();
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 7);
  ctx.fill();
  const inner = ctx.createLinearGradient(x, y, x, y + h);
  inner.addColorStop(0, '#6c757d');
  inner.addColorStop(1, '#9aa2a9');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 4, w - 8, h - 8, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 4 + ((h - 8) * i) / 5);
    ctx.lineTo(x + w - 6, y + 4 + ((h - 8) * i) / 5);
    ctx.stroke();
  }
}

/**
 * One food, filling a box (x, y, w, h). `amount`: 1 = a full tray, ~0.35 = a serving on a plate.
 */
export function drawFood(ctx: Ctx, id: string, x: number, y: number, w: number, h: number, amount = 1) {
  const r = rng(hash(id) ^ Math.round(amount * 1000));
  const cx = x + w / 2, cy = y + h / 2;
  const n = (k: number) => Math.max(1, Math.round(k * amount));
  const rx = (w / 2) * Math.min(1, 0.55 + amount * 0.45), ry = (h / 2) * Math.min(1, 0.55 + amount * 0.45);
  const spot = () => [cx + (r() - 0.5) * rx * 1.6, cy + (r() - 0.5) * ry * 1.5] as const;
  ctx.save();
  switch (id) {
    case 'sambal': {
      // thick, glossy, dark red chilli paste with onion bits and oil sheen
      const g = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.3, 1, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, '#c92a2a');
      g.addColorStop(0.6, '#a61e1e');
      g.addColorStop(1, '#6b1010');
      blob(ctx, cx, cy, rx * 0.95, ry * 0.92, r, g);
      ctx.fillStyle = 'rgba(232, 89, 12, 0.55)';
      for (let i = 0; i < n(10); i++) {
        const [px, py] = spot();
        ellipse(ctx, px, py, 1.6 + r() * 1.6, 1 + r(), r() * 3, 'rgba(232, 89, 12, 0.6)');
      }
      for (let i = 0; i < n(7); i++) {
        const [px, py] = spot();
        ellipse(ctx, px, py, 1.2 + r() * 1.5, 0.8 + r() * 0.8, r() * 3, '#5c0d0d');
      }
      ellipse(ctx, cx - rx * 0.35, cy - ry * 0.35, rx * 0.28, ry * 0.12, -0.4, 'rgba(255,255,255,0.35)');
      break;
    }
    case 'ikan_bilis': {
      // a heap of crispy fried anchovies: thin golden bodies, darker heads
      for (let i = 0; i < n(26); i++) {
        const [px, py] = spot();
        const a = r() * Math.PI;
        const len = Math.min(w, h) * (0.16 + r() * 0.06);
        ctx.strokeStyle = r() < 0.5 ? '#c08a3e' : '#a8732f';
        ctx.lineWidth = Math.max(1.4, len * 0.22);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(a) * len / 2, py - Math.sin(a) * len / 2);
        ctx.lineTo(px + Math.cos(a) * len / 2, py + Math.sin(a) * len / 2);
        ctx.stroke();
        ellipse(ctx, px + Math.cos(a) * len / 2, py + Math.sin(a) * len / 2, len * 0.14, len * 0.12, a, '#5c3d1e');
        ellipse(ctx, px - Math.cos(a) * len * 0.1, py - Math.sin(a) * len * 0.1 - 0.6, len * 0.25, 0.6, a, 'rgba(255,236,190,0.6)');
      }
      break;
    }
    case 'kacang': {
      // roasted peanuts: split halves (pale), some still in their red-brown skins
      for (let i = 0; i < n(18); i++) {
        const [px, py] = spot();
        const a = r() * Math.PI;
        const s = Math.min(w, h) * (0.085 + r() * 0.03);
        const skin = r() < 0.4;
        ellipse(ctx, px + 0.8, py + 1, s * 1.35, s, a, 'rgba(0,0,0,0.25)');
        ellipse(ctx, px, py, s * 1.35, s, a, skin ? '#8b3a2a' : '#e2b672');
        if (!skin) {
          ellipse(ctx, px - s * 0.2, py - s * 0.2, s * 0.7, s * 0.45, a, '#f3d39b');
          ctx.strokeStyle = 'rgba(120, 70, 30, 0.5)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(px - Math.cos(a) * s * 1.1, py - Math.sin(a) * s * 1.1);
          ctx.lineTo(px + Math.cos(a) * s * 1.1, py + Math.sin(a) * s * 1.1);
          ctx.stroke();
        } else ellipse(ctx, px - s * 0.3, py - s * 0.35, s * 0.5, s * 0.25, a, 'rgba(255,190,160,0.45)');
      }
      break;
    }
    case 'timun': {
      // cucumber slices: dark green rind, pale flesh, a ring of seeds
      const k = n(6);
      for (let i = 0; i < k; i++) {
        const [px, py] = amount < 1 ? [cx + (i - (k - 1) / 2) * Math.min(w, h) * 0.2, cy + (i % 2) * 3] : spot();
        const s = Math.min(w, h) * (amount < 1 ? 0.2 : 0.17);
        ellipse(ctx, px + 1, py + 1.5, s, s * 0.92, 0, 'rgba(0,0,0,0.25)');
        ellipse(ctx, px, py, s, s * 0.92, 0, '#2b8a3e');
        ellipse(ctx, px, py, s * 0.86, s * 0.78, 0, '#d8f5a2');
        ellipse(ctx, px, py, s * 0.5, s * 0.45, 0, '#c0eb75');
        for (let j = 0; j < 6; j++) {
          const a = (j / 6) * Math.PI * 2;
          ellipse(ctx, px + Math.cos(a) * s * 0.35, py + Math.sin(a) * s * 0.32, s * 0.08, s * 0.05, a, '#f4fce3');
        }
      }
      break;
    }
    case 'telur_rebus': {
      // hard-boiled egg halves: white, a firm yellow yolk
      const k = Math.max(1, Math.round(4 * amount));
      for (let i = 0; i < k; i++) {
        const [px, py] = amount < 1 ? [cx, cy] : spot();
        const s = Math.min(w, h) * 0.24;
        ellipse(ctx, px + 1, py + 2, s * 1.2, s, r() * 0.6, 'rgba(0,0,0,0.25)');
        ellipse(ctx, px, py, s * 1.2, s, 0.2, '#fdfdfb');
        ellipse(ctx, px + s * 0.08, py, s * 0.55, s * 0.5, 0, '#f2b51d');
        ellipse(ctx, px - s * 0.1, py - s * 0.12, s * 0.22, s * 0.14, 0, '#ffd965');
      }
      break;
    }
    case 'ayam_goreng': {
      // fried chicken pieces: craggy golden-brown crust, a drumstick bone
      const k = Math.max(1, Math.round(3 * amount));
      for (let i = 0; i < k; i++) {
        const [px, py] = amount < 1 ? [cx, cy] : spot();
        const s = Math.min(w, h) * 0.3;
        ctx.strokeStyle = '#f1e6d2';
        ctx.lineWidth = s * 0.28;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px + s * 0.5, py + s * 0.1);
        ctx.lineTo(px + s * 1.15, py - s * 0.35);
        ctx.stroke();
        const g = ctx.createRadialGradient(px - s * 0.3, py - s * 0.3, 1, px, py, s);
        g.addColorStop(0, '#e8a33d');
        g.addColorStop(0.7, '#b8661c');
        g.addColorStop(1, '#7a3d0c');
        blob(ctx, px, py, s * 0.95, s * 0.75, r, g);
        for (let j = 0; j < 8; j++) ellipse(ctx, px + (r() - 0.5) * s * 1.3, py + (r() - 0.5) * s, s * 0.12, s * 0.08, r() * 3, r() < 0.5 ? '#f0b44e' : '#8a4510');
      }
      break;
    }
    case 'paru': {
      // fried beef lung: flat, dark, crispy slices with a lighter fried edge
      const k = Math.max(1, Math.round(5 * amount));
      for (let i = 0; i < k; i++) {
        const [px, py] = amount < 1 ? [cx + (i - (k - 1) / 2) * w * 0.12, cy + (i % 2) * 2] : spot();
        const s = Math.min(w, h) * 0.2;
        const a = r() * Math.PI;
        ellipse(ctx, px + 1, py + 1.5, s * 1.3, s * 0.8, a, 'rgba(0,0,0,0.3)');
        ellipse(ctx, px, py, s * 1.3, s * 0.8, a, '#a8521e');
        ellipse(ctx, px, py, s * 1.1, s * 0.62, a, '#6e2a12');
        for (let j = 0; j < 4; j++) ellipse(ctx, px + (r() - 0.5) * s * 1.4, py + (r() - 0.5) * s * 0.8, s * 0.12, s * 0.09, 0, '#4a1a08');
      }
      break;
    }
    case 'sambal_kerang': {
      // cockles in red sambal: the sauce, then little ridged shells and plump orange meat
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, '#d9480f');
      g.addColorStop(1, '#8a1c1c');
      blob(ctx, cx, cy, rx * 0.95, ry * 0.9, r, g);
      for (let i = 0; i < n(9); i++) {
        const [px, py] = spot();
        const s = Math.min(w, h) * 0.1;
        ellipse(ctx, px, py, s * 1.1, s * 0.9, r() * 3, '#d8c9b4');
        ctx.strokeStyle = 'rgba(110, 90, 70, 0.7)';
        ctx.lineWidth = 0.7;
        for (let j = -1; j <= 1; j++) {
          ctx.beginPath();
          ctx.moveTo(px + j * s * 0.4, py - s * 0.7);
          ctx.lineTo(px + j * s * 0.5, py + s * 0.7);
          ctx.stroke();
        }
        ellipse(ctx, px + s * 0.3, py - s * 0.1, s * 0.45, s * 0.35, 0, '#e8590c');
      }
      ellipse(ctx, cx - rx * 0.3, cy - ry * 0.35, rx * 0.25, ry * 0.1, -0.4, 'rgba(255,255,255,0.3)');
      break;
    }
    case 'telur_mata': {
      // fried egg sunny side up: lacy crisp edge, glossy yolk
      const k = Math.max(1, Math.round(2 * amount));
      for (let i = 0; i < k; i++) {
        const [px, py] = amount < 1 ? [cx, cy] : spot();
        const s = Math.min(w, h) * (amount < 1 ? 0.42 : 0.3);
        blob(ctx, px, py, s * 1.15, s, r, '#c77a2a');
        blob(ctx, px, py, s * 1.05, s * 0.9, r, '#fffdf5');
        ellipse(ctx, px + s * 0.12, py - s * 0.05, s * 0.42, s * 0.38, 0, '#f59f00');
        ellipse(ctx, px, py - s * 0.15, s * 0.16, s * 0.1, -0.3, 'rgba(255,255,255,0.7)');
      }
      break;
    }
    case 'rendang': {
      // dark caramelised beef chunks in thick brown gravy with kerisik
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, '#8a5a2b');
      g.addColorStop(1, '#4a2a10');
      blob(ctx, cx, cy, rx * 0.95, ry * 0.9, r, g);
      for (let i = 0; i < n(8); i++) {
        const [px, py] = spot();
        const s = Math.min(w, h) * 0.13;
        blob(ctx, px, py, s * 1.1, s * 0.85, r, '#5a2d0f');
        ellipse(ctx, px - s * 0.3, py - s * 0.3, s * 0.35, s * 0.2, 0, 'rgba(200, 130, 60, 0.6)');
      }
      for (let i = 0; i < n(14); i++) {
        const [px, py] = spot();
        ellipse(ctx, px, py, 0.9, 0.7, 0, 'rgba(240, 200, 140, 0.7)');
      }
      break;
    }
    case 'dhal': {
      // yellow lentil curry with a few lentils, chilli oil and curry leaves
      const g = ctx.createRadialGradient(cx - rx * 0.2, cy - ry * 0.2, 1, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, '#ffd43b');
      g.addColorStop(1, '#d9a10a');
      blob(ctx, cx, cy, rx * 0.95, ry * 0.9, r, g);
      for (let i = 0; i < n(16); i++) {
        const [px, py] = spot();
        ellipse(ctx, px, py, 1.4, 1, r() * 3, 'rgba(230, 160, 20, 0.9)');
      }
      for (let i = 0; i < n(5); i++) {
        const [px, py] = spot();
        ellipse(ctx, px, py, 2.4, 1.1, r() * 3, '#2b8a3e');
      }
      for (let i = 0; i < n(6); i++) {
        const [px, py] = spot();
        ellipse(ctx, px, py, 2 + r() * 2, 1.2, 0, 'rgba(232, 89, 12, 0.55)');
      }
      break;
    }
    case 'kari_ayam': {
      // chicken curry: orange-red gravy, chicken pieces, potato, an oil sheen
      const g = ctx.createRadialGradient(cx - rx * 0.2, cy - ry * 0.2, 1, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, '#f08c00');
      g.addColorStop(1, '#a83c0c');
      blob(ctx, cx, cy, rx * 0.95, ry * 0.9, r, g);
      for (let i = 0; i < n(5); i++) {
        const [px, py] = spot();
        const s = Math.min(w, h) * 0.13;
        blob(ctx, px, py, s * 1.1, s * 0.85, r, '#c2731f');
        ellipse(ctx, px - s * 0.3, py - s * 0.3, s * 0.35, s * 0.2, 0, 'rgba(255, 210, 140, 0.6)');
      }
      for (let i = 0; i < n(3); i++) {
        const [px, py] = spot();
        ellipse(ctx, px, py, Math.min(w, h) * 0.09, Math.min(w, h) * 0.07, 0, '#f2c14e');
      }
      ellipse(ctx, cx - rx * 0.35, cy - ry * 0.35, rx * 0.25, ry * 0.1, -0.4, 'rgba(255,255,255,0.3)');
      break;
    }
    case 'kari_ikan': {
      // fish head curry style: reddish gravy, a fish piece, okra and tomato
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, '#e8590c');
      g.addColorStop(1, '#922b0e');
      blob(ctx, cx, cy, rx * 0.95, ry * 0.9, r, g);
      const s = Math.min(w, h) * 0.22;
      ellipse(ctx, cx - s * 0.2, cy, s * 1.3, s * 0.6, -0.2, '#e9d8c4');
      ellipse(ctx, cx - s * 0.2, cy - s * 0.15, s * 1.1, s * 0.3, -0.2, '#cdb59b');
      ctx.fillStyle = '#d4c0a8';
      ctx.beginPath();
      ctx.moveTo(cx + s * 1.0, cy - s * 0.2);
      ctx.lineTo(cx + s * 1.5, cy - s * 0.55);
      ctx.lineTo(cx + s * 1.45, cy + s * 0.3);
      ctx.fill();
      for (let i = 0; i < n(4); i++) {
        const [px, py] = spot();
        ellipse(ctx, px, py, 3, 2, r() * 3, '#5c940d');
        ellipse(ctx, px, py, 1, 1, 0, '#c0eb75');
      }
      for (let i = 0; i < n(3); i++) {
        const [px, py] = spot();
        ellipse(ctx, px, py, 2.4, 2, 0, '#c92a2a');
      }
      break;
    }
    case 'teh': {
      // a jug of strong brewed tea, with a teabag hanging on its string
      const g = ctx.createRadialGradient(cx - rx * 0.2, cy - ry * 0.2, 1, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, '#9c4a14');
      g.addColorStop(1, '#4a1e06');
      ellipse(ctx, cx, cy, rx * 0.92, ry * 0.86, 0, g as unknown as string);
      ellipse(ctx, cx - rx * 0.3, cy - ry * 0.35, rx * 0.3, ry * 0.12, -0.3, 'rgba(255,255,255,0.25)');
      const bx = cx + rx * 0.25, by = cy + ry * 0.05, bw = Math.min(w, h) * 0.26;
      ctx.fillStyle = '#e9dcc0';
      ctx.beginPath();
      ctx.roundRect(bx - bw / 2, by - bw * 0.55, bw, bw * 1.1, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(120, 70, 30, 0.45)';
      ctx.fillRect(bx - bw / 2 + 2, by, bw - 4, bw * 0.5);
      ctx.strokeStyle = '#f1f3f5';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, by - bw * 0.55);
      ctx.lineTo(bx + rx * 0.5, y + 2);
      ctx.stroke();
      ctx.fillStyle = '#e03131';
      ctx.fillRect(bx + rx * 0.5 - 3, y, 7, 5);
      break;
    }
    case 'susu_pekat': {
      // sweetened condensed milk: thick, glossy, creamy-yellow ribbons folding over
      ellipse(ctx, cx, cy, rx * 0.9, ry * 0.85, 0, '#f3e3b5');
      ctx.strokeStyle = '#fff4d6';
      ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.09);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const yy = cy - ry * 0.5 + i * ry * 0.33;
        ctx.moveTo(cx - rx * 0.6, yy);
        ctx.quadraticCurveTo(cx, yy + ry * 0.25 * (i % 2 ? -1 : 1), cx + rx * 0.6, yy);
      }
      ctx.stroke();
      ellipse(ctx, cx - rx * 0.3, cy - ry * 0.4, rx * 0.25, ry * 0.1, -0.3, 'rgba(255,255,255,0.6)');
      break;
    }
    case 'susu_cair': {
      // evaporated milk: thin, pale and smooth, a little splash
      ellipse(ctx, cx, cy, rx * 0.92, ry * 0.86, 0, '#fbf7ee');
      ellipse(ctx, cx, cy, rx * 0.7, ry * 0.62, 0, '#f4ecdb');
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + r();
        ellipse(ctx, cx + Math.cos(a) * rx * 0.55, cy + Math.sin(a) * ry * 0.5, 2.2, 1.6, 0, '#ffffff');
      }
      ellipse(ctx, cx - rx * 0.3, cy - ry * 0.35, rx * 0.22, ry * 0.08, -0.3, 'rgba(255,255,255,0.8)');
      break;
    }
    case 'panas': {
      // hot water: a steel kettle spout over steaming water
      ellipse(ctx, cx, cy, rx * 0.92, ry * 0.86, 0, 'rgba(170, 210, 235, 0.85)');
      ellipse(ctx, cx - rx * 0.3, cy - ry * 0.3, rx * 0.3, ry * 0.1, -0.3, 'rgba(255,255,255,0.6)');
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const sx = cx - rx * 0.4 + k * rx * 0.4;
        ctx.beginPath();
        ctx.moveTo(sx, cy + ry * 0.3);
        ctx.bezierCurveTo(sx + 6, cy, sx - 6, cy - ry * 0.3, sx, cy - ry * 0.7);
        ctx.stroke();
      }
      break;
    }
    case 'ais': {
      // ice cubes: translucent, bluish edges, bright highlights
      const k = Math.max(2, Math.round(7 * amount));
      for (let i = 0; i < k; i++) {
        const [px, py] = amount < 1 ? [cx + (i - (k - 1) / 2) * Math.min(w, h) * 0.22, cy + ((i % 2) - 0.5) * 4] : spot();
        const s = Math.min(w, h) * 0.17;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(r() * 0.8 - 0.4);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(-s / 2 + 2, -s / 2 + 3, s, s);
        ctx.fillStyle = 'rgba(208, 235, 255, 0.92)';
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.strokeStyle = 'rgba(116, 192, 252, 0.9)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(-s / 2, -s / 2, s, s);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(-s / 2 + 2, -s / 2 + 2, s * 0.35, s * 0.18);
        ctx.restore();
      }
      break;
    }
    default:
      ellipse(ctx, cx, cy, rx * 0.7, ry * 0.7, 0, '#adb5bd');
  }
  ctx.restore();
}

/** Steamed coconut rice: a white mound with grain texture and a pandan leaf. */
export function drawRice(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, seed = 7) {
  const r = rng(seed);
  ellipse(ctx, cx + 2, cy + ry * 0.35, rx, ry * 0.55, 0, 'rgba(0,0,0,0.2)');
  const g = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.5, 2, cx, cy, Math.max(rx, ry));
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#e9e4d8');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0);
  ctx.ellipse(cx, cy, rx, ry * 0.4, 0, 0, Math.PI);
  ctx.fill();
  for (let i = 0; i < 70; i++) {
    const a = Math.PI + r() * Math.PI;
    const d = Math.sqrt(r());
    ellipse(ctx, cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d + r() * ry * 0.3, 1.6, 0.7, r() * 3, r() < 0.5 ? '#f8f9fa' : '#dcd6c8');
  }
}

/** A banana leaf on a white plate (seen from above). */
export function drawPlate(ctx: Ctx, cx: number, cy: number, rx: number, ry: number) {
  ellipse(ctx, cx + 3, cy + 5, rx, ry, 0, 'rgba(0,0,0,0.3)');
  ellipse(ctx, cx, cy, rx, ry, 0, '#f8f9fa');
  ellipse(ctx, cx, cy, rx * 0.93, ry * 0.9, 0, '#e9ecef');
  const g = ctx.createLinearGradient(cx - rx, cy, cx + rx, cy);
  g.addColorStop(0, '#2b8a3e');
  g.addColorStop(0.5, '#40c057');
  g.addColorStop(1, '#2f9e44');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.86, ry * 0.8, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.86, cy + ry * 0.05);
  ctx.lineTo(cx + rx * 0.86, cy - ry * 0.08);
  ctx.stroke();
  for (let i = -6; i <= 6; i++) {
    const x0 = cx + (i / 7) * rx * 0.8;
    ctx.beginPath();
    ctx.moveTo(x0, cy);
    ctx.lineTo(x0 + rx * 0.08, cy - ry * 0.7 * Math.cos((i / 7) * 1.2));
    ctx.moveTo(x0, cy);
    ctx.lineTo(x0 + rx * 0.08, cy + ry * 0.7 * Math.cos((i / 7) * 1.2));
    ctx.stroke();
  }
}

/** A small canvas of one food in its steel tray (for the ingredient buttons). */
export function trayCanvas(id: string, w: number, h: number): HTMLCanvasElement {
  const dpr = Math.min(3, devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  drawTray(ctx, 1, 1, w - 4, h - 5);
  drawFood(ctx, id, 6, 6, w - 14, h - 15, 1);
  return c;
}

// ------------------------------------------------------------------ teh tarik & roti canai scenes

/** An oiled stainless counter top (roti canai is stretched and folded on one). */
export function drawCounter(ctx: Ctx, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#ced4da');
  g.addColorStop(0.5, '#e9ecef');
  g.addColorStop(1, '#adb5bd');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < h; i += 6) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(w, i + 3);
    ctx.stroke();
  }
  // oil sheen
  ellipse(ctx, w * 0.5, h * 0.5, w * 0.36, h * 0.34, 0.2, 'rgba(255, 236, 153, 0.18)');
}

/** A stretched, translucent roti dough sheet (`spread` 0 = a ball, 1 = paper thin). */
export function drawDough(ctx: Ctx, cx: number, cy: number, size: number, spread: number, seed = 3) {
  const r = rng(seed);
  const rad = size * (0.25 + spread * 0.75);
  ellipse(ctx, cx + 4, cy + 6, rad, rad * 0.86, 0, 'rgba(0,0,0,0.28)');
  const g = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, 2, cx, cy, rad);
  g.addColorStop(0, `rgba(255, 246, 220, ${0.98 - spread * 0.25})`);
  g.addColorStop(1, `rgba(232, 200, 140, ${0.98 - spread * 0.3})`);
  ctx.fillStyle = g;
  ctx.strokeStyle = 'rgba(170, 120, 60, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 - spread * 0.12 + r() * spread * 0.18;
    const px = cx + Math.cos(a) * rad * k, py = cy + Math.sin(a) * rad * 0.86 * k;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (spread > 0.3) {
    // thin spots and little tears where it's stretched
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2, d = rad * (0.3 + r() * 0.6);
      ellipse(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.86, rad * 0.06, rad * 0.04, a, 'rgba(255,255,255,0.35)');
    }
  }
  ellipse(ctx, cx - rad * 0.3, cy - rad * 0.3, rad * 0.3, rad * 0.12, -0.5, 'rgba(255,255,255,0.3)');
}

/** A roti canai on a griddle or plate: layered, flaky, golden spots (`brown` 0..1+). */
export function drawRoti(ctx: Ctx, cx: number, cy: number, rad: number, brown: number, seed = 9) {
  const r = rng(seed);
  const t = Math.max(0, Math.min(1.6, brown));
  const base = t <= 1 ? mix([250, 236, 200], [226, 170, 88], t) : mix([226, 170, 88], [90, 50, 20], (t - 1) / 0.6);
  ellipse(ctx, cx, cy, rad, rad * 0.9, 0, base);
  ctx.strokeStyle = 'rgba(160, 100, 40, 0.45)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(cx + (r() - 0.5) * 4, cy + (r() - 0.5) * 4, rad * (0.3 + i * 0.17), rad * (0.27 + i * 0.15), r(), 0.4, Math.PI * 1.7);
    ctx.stroke();
  }
  // crispy golden-brown spots appear as it cooks
  const spots = Math.round(28 * Math.min(1, t));
  for (let i = 0; i < spots; i++) {
    const a = r() * Math.PI * 2, d = rad * Math.sqrt(r()) * 0.9;
    ellipse(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, 2 + r() * 3, 1.4 + r() * 2, a, t > 1.15 ? '#3b2010' : 'rgba(176, 102, 30, 0.75)');
  }
}

/** A flat iron griddle (tawa), seen from above. */
export function drawGriddle(ctx: Ctx, cx: number, cy: number, rad: number) {
  ellipse(ctx, cx + 4, cy + 6, rad, rad * 0.9, 0, 'rgba(0,0,0,0.35)');
  const g = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, 2, cx, cy, rad);
  g.addColorStop(0, '#495057');
  g.addColorStop(1, '#212529');
  ellipse(ctx, cx, cy, rad, rad * 0.9, 0, g as unknown as string);
  ctx.strokeStyle = '#868e96';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rad, rad * 0.9, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** A clear glass mug of teh tarik (`fill` 0..1 tea level, `foam` 0..1 froth on top, `col` tea colour). */
export function drawGlass(ctx: Ctx, x: number, y: number, w: number, h: number, fill: number, foam: number, col: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(x + w / 2 + 3, y + h + 4, w * 0.55, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // handle
  ctx.strokeStyle = 'rgba(230, 240, 250, 0.75)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(x + w + 2, y + h * 0.45, h * 0.2, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  const tea = h * Math.max(0, Math.min(1, fill));
  const foamH = h * 0.4 * Math.max(0, Math.min(1, foam));
  ctx.fillStyle = col;
  ctx.fillRect(x + 4, y + h - tea, w - 8, tea);
  if (foamH > 1) {
    const top = y + h - tea - foamH;
    const g = ctx.createLinearGradient(0, top, 0, top + foamH);
    g.addColorStop(0, '#fff8ec');
    g.addColorStop(1, '#e8c79a');
    ctx.fillStyle = g;
    ctx.fillRect(x + 4, top, w - 8, foamH);
    const r = rng(5);
    for (let i = 0; i < 14; i++) ellipse(ctx, x + 6 + r() * (w - 12), top + r() * Math.min(10, foamH), 1.5 + r() * 2, 1.2 + r() * 1.5, 0, 'rgba(255,255,255,0.8)');
  }
  // glass body: rim, sides, shine
  ctx.strokeStyle = 'rgba(220, 235, 245, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 3, y + h);
  ctx.lineTo(x + w - 3, y + h);
  ctx.lineTo(x + w, y);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x + 7, y + 6, 6, h - 12);
}

/** A stainless pulling mug (side view), tilted by `tilt` radians around its base. */
export function drawSteelMug(ctx: Ctx, x: number, y: number, w: number, h: number, tilt = 0) {
  ctx.save();
  ctx.translate(x + w / 2, y + h);
  ctx.rotate(tilt);
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, '#868e96');
  g.addColorStop(0.35, '#f1f3f5');
  g.addColorStop(0.6, '#ced4da');
  g.addColorStop(1, '#6c757d');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h);
  ctx.lineTo(-w / 2 + 3, 0);
  ctx.lineTo(w / 2 - 3, 0);
  ctx.lineTo(w / 2, -h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#495057';
  ctx.fillRect(-w / 2, -h, w, 4);
  ctx.strokeStyle = '#adb5bd';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(w / 2 + 2, -h * 0.55, h * 0.18, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.restore();
}

/** A small bowl of curry beside the roti (seen from above). */
export function drawBowl(ctx: Ctx, id: string, cx: number, cy: number, rad: number) {
  ellipse(ctx, cx + 2, cy + 3, rad, rad * 0.85, 0, 'rgba(0,0,0,0.28)');
  ellipse(ctx, cx, cy, rad, rad * 0.85, 0, '#f1f3f5');
  ellipse(ctx, cx, cy, rad * 0.82, rad * 0.68, 0, '#ced4da');
  drawFood(ctx, id, cx - rad * 0.8, cy - rad * 0.66, rad * 1.6, rad * 1.32, 0.7);
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
}

/** A round icon for a dish or ingredient (stock display): the food on a little white plate. */
export function foodIcon(id: string, size: number): HTMLCanvasElement {
  const dpr = Math.min(3, devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const m = size / 2;
  if (id === 'teh_tarik') {
    drawGlass(ctx, size * 0.24, size * 0.14, size * 0.44, size * 0.66, 0.62, 0.7, '#b5651d');
    return c;
  }
  ellipse(ctx, m + 1, m + 2, m * 0.92, m * 0.8, 0, 'rgba(0,0,0,0.3)');
  ellipse(ctx, m, m, m * 0.92, m * 0.8, 0, '#f8f9fa');
  ellipse(ctx, m, m, m * 0.74, m * 0.62, 0, '#e9ecef');
  if (id === 'nasi_lemak') {
    ellipse(ctx, m, m, m * 0.7, m * 0.58, 0, '#2f9e44');
    drawRice(ctx, m - m * 0.15, m + m * 0.1, m * 0.36, m * 0.36);
    drawFood(ctx, 'sambal', m + m * 0.05, m - m * 0.45, m * 0.55, m * 0.42, 0.35);
    drawFood(ctx, 'telur_rebus', m + m * 0.1, m + m * 0.0, m * 0.55, m * 0.5, 0.35);
  } else if (id === 'roti_canai') {
    drawRoti(ctx, m, m, m * 0.62, 0.95);
  } else drawFood(ctx, id, m - m * 0.68, m - m * 0.56, m * 1.36, m * 1.12, 0.6);
  return c;
}

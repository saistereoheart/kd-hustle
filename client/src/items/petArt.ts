// 🐾 Teman art, drawn in code: chibi Malaysian creatures (big heads, round bodies) and pet gear.
// Drawn centred on (0, 0) in a box about 36 units wide (feet near y = +14), facing right; the
// caller scales and flips. `t` (ms) makes them breathe and blink.
type Ctx = CanvasRenderingContext2D;

function ell(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}
function poly(ctx: Ctx, pts: number[], fill: string) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
function stroke(ctx: Ctx, pts: number[], color: string, w: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}
/** Soft round body with light from the top-left. */
function blob(ctx: Ctx, x: number, y: number, rx: number, ry: number, col: string, light = '#ffffff') {
  const g = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.4, 0.5, x, y, Math.max(rx, ry) * 1.1);
  g.addColorStop(0, mix(col, light, 0.35));
  g.addColorStop(1, col);
  ell(ctx, x, y, rx, ry, g);
}
function mix(a: string, b: string, k: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (!a.startsWith('#') || !b.startsWith('#')) return a;
  const x = p(a), y = p(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',')})`;
}
/** Big shiny eyes (they blink now and then). */
function eye(ctx: Ctx, x: number, y: number, r: number, t: number, col = '#1b1b1b') {
  const blink = (t % 3800) < 140;
  if (blink) return stroke(ctx, [x - r, y, x + r, y], col, r * 0.5);
  ell(ctx, x, y, r, r * 1.15, '#fff');
  ell(ctx, x + r * 0.2, y + r * 0.1, r * 0.68, r * 0.78, col);
  ell(ctx, x + r * 0.45, y - r * 0.3, r * 0.26, r * 0.26, '#fff');
}
function legs(ctx: Ctx, xs: number[], y: number, h: number, col: string, w = 2.6) {
  for (const x of xs) stroke(ctx, [x, y, x, y + h], col, w);
}
function shadow(ctx: Ctx) {
  ell(ctx, 0, 14.5, 12, 2.6, 'rgba(0,0,0,0.25)');
}

export function drawPet(ctx: Ctx, shape: string, t = 0, c1?: string, c2?: string, noShadow = false) {
  const breathe = Math.sin(t / 420) * 0.4;
  ctx.save();
  if (!noShadow) shadow(ctx);
  ctx.translate(0, breathe);
  switch (shape) {
    case 'kucing': {
      const o = c1 ?? '#f08c00', w = c2 ?? '#fff4e6';
      stroke(ctx, [-9, 6, -15, 2, -14, -6], o, 3.2); // tail
      legs(ctx, [-5, -1, 4, 8], 9, 5, o, 3);
      blob(ctx, 0, 6, 10, 7, o);
      ell(ctx, 1, 8, 6, 4, w);
      blob(ctx, 4, -5, 9, 8, o);
      poly(ctx, [-3, -10, -1, -17, 3, -11], o); // ears
      poly(ctx, [6, -11, 10, -17, 12, -9], o);
      poly(ctx, [-1.5, -11, -0.8, -15, 1.5, -11.5], '#ffa8a8');
      poly(ctx, [7.5, -11, 10, -15, 11, -10], '#ffa8a8');
      for (const y of [-9, -6]) stroke(ctx, [0, y, 3, y + 0.5], mix(o, '#000000', 0.35), 0.9); // stripes
      ell(ctx, 6, -1.5, 3.4, 2.6, w); // muzzle
      ell(ctx, 7.4, -2.4, 0.9, 0.7, '#e64980');
      eye(ctx, 2, -5, 1.9, t);
      eye(ctx, 9, -5, 1.6, t + 90);
      break;
    }
    case 'ayam': {
      const r = c1 ?? '#e03131', y = c2 ?? '#ffd43b';
      for (const [a, c] of [[-0.6, '#2b8a3e'], [-0.2, '#1c7ed6'], [0.25, '#212529']] as const) {
        ctx.save();
        ctx.translate(-8, -2);
        ctx.rotate(a - 0.9);
        ell(ctx, 0, -7, 2.6, 8, c);
        ctx.restore();
      }
      legs(ctx, [-2, 3], 8, 6, '#f59f00', 1.8);
      blob(ctx, 0, 3, 9, 8, '#fff9db');
      ell(ctx, -1, 4, 6, 4.5, mix('#fff9db', '#e8a700', 0.25)); // wing
      blob(ctx, 5, -7, 6, 6, '#fff9db');
      for (const [x, s] of [[3, 2.2], [5.5, 2.6], [8, 2.1]] as const) ell(ctx, x, -13, s, s * 1.1, r); // comb
      poly(ctx, [10, -7, 15, -5.5, 10, -4.5], y); // beak
      ell(ctx, 9.5, -2.5, 1.5, 2.3, r); // wattle
      eye(ctx, 7, -8, 1.6, t);
      break;
    }
    case 'kancil': {
      const b = c1 ?? '#a0522d', l = c2 ?? '#ffe8cc';
      legs(ctx, [-6, -2.5, 3, 6.5], 6, 8, mix(b, '#000000', 0.2), 1.6);
      blob(ctx, 0, 3, 10, 6, b);
      ell(ctx, 0, 6, 7, 2.6, l);
      stroke(ctx, [5, 0, 8, -6], b, 4.5); // neck
      blob(ctx, 9, -8, 5.5, 5, b);
      ell(ctx, 13, -6.5, 2.6, 2, l);
      ell(ctx, 6, -13, 1.6, 3.4, b, -0.4); // ears
      ell(ctx, 10, -13.5, 1.6, 3.4, b, 0.3);
      ell(ctx, 14.5, -7, 0.8, 0.6, '#1b1b1b');
      eye(ctx, 9, -9, 2, t);
      break;
    }
    case 'penyu': {
      const g = c1 ?? '#2b8a3e', l = c2 ?? '#d8f5a2';
      ell(ctx, -9, 8, 3.4, 2, '#82c91e', 0.3); // flippers
      ell(ctx, 8, 9, 3.4, 2, '#82c91e', -0.3);
      blob(ctx, 13, 1, 4.5, 4, '#94d82d'); // head
      const sh = ctx.createRadialGradient(-3, -4, 1, 0, 2, 13);
      sh.addColorStop(0, mix(g, '#ffffff', 0.35));
      sh.addColorStop(1, g);
      ctx.beginPath();
      ctx.ellipse(0, 4, 12, 9.5, 0, Math.PI, 0);
      ctx.lineTo(12, 7);
      ctx.lineTo(-12, 7);
      ctx.closePath();
      ctx.fillStyle = sh;
      ctx.fill();
      ctx.strokeStyle = l;
      ctx.lineWidth = 0.9;
      for (const [x, y] of [[-6, 0], [0, -2.5], [6, 0], [-3, 4], [3, 4]]) {
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          ctx.lineTo(x + Math.cos(a) * 2.6, y + Math.sin(a) * 2.2);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ell(ctx, 0, 7.5, 12, 2, mix(g, '#000000', 0.25));
      eye(ctx, 14.5, -0.5, 1.4, t);
      break;
    }
    case 'musang': {
      const g = c1 ?? '#495057', w = c2 ?? '#f1f3f5';
      stroke(ctx, [-9, 4, -15, 0, -16, -6], g, 3.4);
      for (const y of [-1, -4]) stroke(ctx, [-15.5, y, -14, y], w, 1.8); // tail rings
      legs(ctx, [-5, -1, 4, 7], 7, 6, mix(g, '#000000', 0.3), 2.2);
      blob(ctx, 0, 4, 11, 5.5, g);
      blob(ctx, 10, -3, 6.5, 5.5, g);
      ell(ctx, 13, -2, 3.6, 2.4, w); // mask
      ell(ctx, 10.5, -4.2, 3.6, 1.6, '#1b1b1b');
      poly(ctx, [6, -7, 7.5, -12, 9.5, -7.5], g);
      ell(ctx, 16, -2, 0.9, 0.7, '#1b1b1b');
      eye(ctx, 11.5, -4.5, 1.4, t, '#fab005');
      break;
    }
    case 'enggang': {
      const b = c1 ?? '#212529', y = c2 ?? '#fab005';
      poly(ctx, [-8, 2, -17, 6, -16, 0, -8, -2], '#f8f9fa'); // tail
      legs(ctx, [-1, 3], 8, 6, '#495057', 1.6);
      blob(ctx, 0, 2, 9, 8, b, '#868e96');
      ell(ctx, -2, 3, 6, 4.5, mix(b, '#ffffff', 0.15)); // wing
      blob(ctx, 6, -7, 6, 5.5, b, '#868e96');
      poly(ctx, [9, -9, 18, -5, 10, -4], y); // beak
      poly(ctx, [8, -10, 16, -11, 17, -8, 9, -8], '#e8590c'); // casque
      ell(ctx, 6, -5, 2.2, 1.4, '#f8f9fa');
      eye(ctx, 6.5, -8, 1.5, t, '#c92a2a');
      break;
    }
    case 'kerbau': {
      const g = c1 ?? '#5c5f66', l = c2 ?? '#ced4da';
      legs(ctx, [-7, -3, 4, 8], 7, 7, mix(g, '#000000', 0.25), 3);
      blob(ctx, -1, 3, 12, 8, g);
      blob(ctx, 10, -3, 6.5, 6, g);
      ctx.lineCap = 'round';
      stroke(ctx, [6, -7, 1, -10, 0, -14], l, 2.6); // horns
      stroke(ctx, [13, -7, 17, -10, 18, -14], l, 2.6);
      ell(ctx, 13, 0, 4, 2.8, mix(g, '#ffffff', 0.3)); // nose
      ell(ctx, 12, 0, 0.6, 0.5, '#1b1b1b');
      ell(ctx, 14.5, 0, 0.6, 0.5, '#1b1b1b');
      eye(ctx, 9, -4, 1.5, t);
      break;
    }
    case 'buaya': {
      const g = c1 ?? '#5c940d', l = c2 ?? '#d8f5a2';
      poly(ctx, [-8, 2, -18, 6, -8, 7], g); // tail
      legs(ctx, [-5, 5], 7, 4, mix(g, '#000000', 0.25), 3);
      blob(ctx, 0, 3, 11, 5.5, g);
      for (let i = -6; i <= 6; i += 3) poly(ctx, [i - 1, -1.5, i, -4, i + 1, -1.5], mix(g, '#000000', 0.25)); // ridges
      blob(ctx, 10, -1, 8, 4, g); // snout
      ell(ctx, 11, 1, 7, 1.8, l);
      for (let i = 0; i < 4; i++) poly(ctx, [6 + i * 3, 0.6, 7 + i * 3, 2.3, 8 + i * 3, 0.6], '#fff');
      ell(ctx, 7, -4.5, 2.6, 2.2, g);
      eye(ctx, 7, -5, 1.4, t, '#fab005');
      break;
    }
    case 'harimau': {
      const o = c1 ?? '#f76707', k = c2 ?? '#212529';
      stroke(ctx, [-9, 5, -15, 1, -14, -5], o, 3.2);
      legs(ctx, [-5, -1, 4, 8], 9, 5, o, 3.2);
      blob(ctx, 0, 5, 10.5, 7, o);
      for (const x of [-5, -1, 3]) stroke(ctx, [x, 0, x + 1, 5], k, 1.4); // stripes
      ell(ctx, 1, 8, 6, 3.6, '#fff4e6');
      blob(ctx, 5, -5, 9, 8, o);
      ell(ctx, -1, -12, 2.6, 2.6, o);
      ell(ctx, 10, -12, 2.6, 2.6, o);
      ell(ctx, -1, -12, 1.3, 1.3, k);
      ell(ctx, 10, -12, 1.3, 1.3, k);
      for (const [x, y] of [[2, -11], [5, -12], [8, -11]] as const) stroke(ctx, [x, y, x, y + 2.5], k, 1);
      ell(ctx, 7, -1, 4, 3, '#fff4e6');
      ell(ctx, 8.2, -2, 1, 0.8, '#e64980');
      eye(ctx, 3, -5, 1.8, t, '#2f9e44');
      eye(ctx, 10, -5, 1.5, t + 90, '#2f9e44');
      break;
    }
    case 'unicorn': {
      // A chibi unicorn: white pony, rainbow mane and tail, a golden spiral horn, pink hooves.
      const body = c1 ?? '#fdfcff', horn = c2 ?? '#ffd43b';
      const rainbow = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#b197fc'];
      rainbow.forEach((c, i) => stroke(ctx, [-9, 2 + i * 0.4, -14 - i * 0.6, -1 + i * 1.5, -16 - i * 0.4, 4 + i * 1.6], c, 2.2)); // tail
      legs(ctx, [-6, -2, 4, 8], 8, 6, body, 3.2);
      for (const x of [-6, -2, 4, 8]) ell(ctx, x, 14, 1.8, 1.1, '#f783ac'); // hooves
      blob(ctx, 0, 4, 10.5, 7, body, '#ffffff');
      ell(ctx, 0, 9, 7, 2.5, 'rgba(180,170,220,0.35)'); // belly shade
      blob(ctx, 6, -6, 8, 7.5, body, '#ffffff');
      ell(ctx, 12, -3, 4, 3.2, '#fff0f6'); // muzzle
      ell(ctx, 13.6, -3.6, 0.7, 0.6, '#c2255c');
      poly(ctx, [2, -11.5, 3.5, -16, 5.5, -11], body); // ear
      poly(ctx, [3, -12, 3.8, -14.6, 4.8, -12], '#fcc2d7');
      // Mane: rainbow tufts down the back of the head.
      rainbow.forEach((c, i) => ell(ctx, 0.5 - i * 0.9, -11 + i * 2.1, 3.2, 2.2, c, -0.6));
      // Spiral horn.
      poly(ctx, [7, -11.5, 10.5, -21, 9.5, -11], horn);
      for (const k of [0.25, 0.5, 0.75]) stroke(ctx, [7.4 + k * 2.6, -11.8 - k * 8.4, 9.6 + k * 0.6, -11.4 - k * 8.6], mix(horn, '#b08000', 0.5), 0.7);
      ell(ctx, 13.2, -0.8, 1.6, 0.9, 'rgba(255,135,180,0.45)'); // blush
      eye(ctx, 8.5, -7, 2, t, '#7048e8');
      stroke(ctx, [9.5, -9.4, 10.6, -10.4], '#1b1b1b', 0.6); // lashes
      break;
    }
    case 'naga':
    default: {
      const p = c1 ?? '#7048e8', y = c2 ?? '#ffd43b';
      ctx.save();
      ctx.globalAlpha = 0.9;
      poly(ctx, [-4, -2, -16, -12, -12, -2, -16, 2, -4, 3], mix(p, '#ffffff', 0.2)); // wing
      ctx.restore();
      stroke(ctx, [-8, 6, -15, 8, -17, 3], p, 3.4); // tail
      legs(ctx, [-4, 4], 9, 5, p, 3.2);
      blob(ctx, 0, 4, 10, 7.5, p);
      ell(ctx, 1, 6, 6, 4, y);
      blob(ctx, 7, -6, 7.5, 6.5, p);
      poly(ctx, [3, -11, 2, -17, 6, -12], y); // horns
      poly(ctx, [8, -12, 9, -18, 11, -11], y);
      ell(ctx, 12, -4, 3.5, 2.6, mix(p, '#ffffff', 0.2));
      ell(ctx, 13.5, -4.5, 0.6, 0.5, '#1b1b1b');
      eye(ctx, 7, -7, 1.9, t, '#c92a2a');
      break;
    }
  }
  ctx.restore();
}

/** Pet gear icons (same box). */
export function drawPetGear(ctx: Ctx, shape: string, c1: string) {
  ctx.save();
  switch (shape) {
    case 'kolar': {
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2);
      ctx.strokeStyle = c1;
      ctx.lineWidth = 4;
      ctx.stroke();
      ell(ctx, 0, 9, 3.2, 3.2, '#fcc419');
      break;
    }
    case 'bandana':
      poly(ctx, [-13, -6, 13, -6, 0, 12], c1);
      stroke(ctx, [-13, -6, -16, -9], c1, 2.5);
      for (const [x, y] of [[-4, -2], [3, -1], [0, 4]]) ell(ctx, x, y, 1.3, 1.3, '#fff');
      break;
    case 'loceng': {
      const g = ctx.createRadialGradient(-3, -4, 1, 0, 0, 12);
      g.addColorStop(0, '#fff3bf');
      g.addColorStop(1, c1);
      ctx.beginPath();
      ctx.moveTo(-10, 8);
      ctx.quadraticCurveTo(-10, -12, 0, -12);
      ctx.quadraticCurveTo(10, -12, 10, 8);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ell(ctx, 0, 9, 3, 3, '#5c3d00');
      break;
    }
    case 'azimat':
      stroke(ctx, [-8, -12, 0, -4, 8, -12], '#868e96', 1.5);
      ell(ctx, 0, 3, 7, 9, c1);
      ell(ctx, 0, 3, 3.4, 5, '#fcc419');
      break;
    case 'taring':
      stroke(ctx, [-12, -8, 0, 0, 12, -8], '#8d5a33', 1.5);
      for (const x of [-6, 0, 6]) poly(ctx, [x - 2, -2 + Math.abs(x) * -0.3, x + 2, -2 + Math.abs(x) * -0.3, x, 9], '#f1f3f5');
      break;
    case 'perisai': {
      const g = ctx.createLinearGradient(-10, -12, 10, 12);
      g.addColorStop(0, '#a5d8ff');
      g.addColorStop(1, c1);
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(11, -8);
      ctx.quadraticCurveTo(10, 8, 0, 14);
      ctx.quadraticCurveTo(-10, 8, -11, -8);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      poly(ctx, [0, -7, 5, 0, 0, 7, -5, 0], '#fcc419');
      break;
    }
    case 'sayap':
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.scale(s, 1);
        poly(ctx, [1, 0, 14, -12, 16, -4, 13, 2, 15, 6, 4, 6], c1);
        stroke(ctx, [3, 1, 13, -8], '#ffffff', 1);
        ctx.restore();
      }
      break;
    case 'mahkota':
    default:
      poly(ctx, [-12, 8, -12, -6, -6, 0, 0, -10, 6, 0, 12, -6, 12, 8], c1);
      for (const x of [-6, 0, 6]) ell(ctx, x, 3, 1.8, 1.8, '#e03131');
      break;
  }
  ctx.restore();
}

/**
 * drawPet with a rounded, lit finish (like the characters): the flat drawing is rendered at the
 * real pixel size, shaded (light from the top-left, a darker underside, a soft rim light) and
 * outlined, then drawn into `ctx` at its current transform. Use this wherever a Teman is shown.
 */
export function drawPetStyled(ctx: Ctx, shape: string, t = 0, c1?: string, c2?: string) {
  const tr = ctx.getTransform();
  const k = Math.max(1, Math.hypot(tr.a, tr.b));
  const box = { x: -22, y: -26, w: 44, h: 44 }; // all pets fit in here (units)
  const W = Math.ceil(box.w * k), H = Math.ceil(box.h * k);
  const art = layer(W, H);
  const a = art.getContext('2d')!;
  a.setTransform(k, 0, 0, k, -box.x * k, -box.y * k);
  drawPet(a, shape, t, c1, c2, true); // the ground shadow is drawn separately, under the outline
  a.setTransform(1, 0, 0, 1, 0, 0);
  // Volume: a highlight from the top-left and a darker underside, only where the pet is drawn.
  a.globalCompositeOperation = 'source-atop';
  const cx = W * 0.45, cy = H * 0.42;
  const hi = a.createRadialGradient(cx - W * 0.16, cy - H * 0.22, 1, cx, cy, W * 0.55);
  hi.addColorStop(0, 'rgba(255,255,255,0.32)');
  hi.addColorStop(0.45, 'rgba(255,255,255,0.06)');
  hi.addColorStop(1, 'rgba(0,0,0,0)');
  a.fillStyle = hi;
  a.fillRect(0, 0, W, H);
  const lo = a.createLinearGradient(0, H * 0.35, 0, H * 0.86);
  lo.addColorStop(0, 'rgba(20,10,40,0)');
  lo.addColorStop(1, 'rgba(20,10,40,0.16)');
  a.fillStyle = lo;
  a.fillRect(0, 0, W, H * 0.8);
  a.globalCompositeOperation = 'source-over';
  // Outline: the silhouette, dark, a little bigger, behind.
  const ink = layer(W, H);
  const g = ink.getContext('2d')!;
  const o = Math.max(1, k * 0.7);
  for (const [dx, dy] of [[o, 0], [-o, 0], [0, o], [0, -o], [o * 0.7, o * 0.7], [-o * 0.7, o * 0.7], [o * 0.7, -o * 0.7], [-o * 0.7, -o * 0.7]]) g.drawImage(art, dx, dy);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = 'rgba(30,22,40,0.85)';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(art, 0, 0);
  ctx.save();
  shadow(ctx);
  ctx.drawImage(ink, box.x, box.y, box.w, box.h);
  ctx.restore();
}

/** A scratch canvas (reused per size, so drawing every frame doesn't churn memory). */
const layers = new Map<string, HTMLCanvasElement[]>();
let layerTurn = 0;
function layer(w: number, h: number): HTMLCanvasElement {
  const key = `${w}x${h}`;
  let list = layers.get(key);
  if (!list) {
    list = [document.createElement('canvas'), document.createElement('canvas')];
    for (const c of list) {
      c.width = w;
      c.height = h;
    }
    layers.set(key, list);
    if (layers.size > 12) layers.delete(layers.keys().next().value as string);
  }
  const c = list[layerTurn++ % 2];
  c.getContext('2d')!.clearRect(0, 0, w, h);
  return c;
}

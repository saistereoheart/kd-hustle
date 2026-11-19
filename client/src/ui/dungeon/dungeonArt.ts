// Gua Gelap art, drawn in code: the cave and its residents (Malaysian pests and folklore spirits,
// chibi and a bit silly rather than scary). Every enemy bobs while idle, leans back while winding
// up a hit, and flashes white when hit.
type Ctx = CanvasRenderingContext2D;

function ell(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}
function line(ctx: Ctx, pts: Array<[number, number]>, color: string, w: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}
/** Two eyes with pupils, looking at the player (left). */
function eyes(ctx: Ctx, x: number, y: number, gap: number, r: number, white = '#fff', pupil = '#111', angry = false) {
  for (const dx of [-gap / 2, gap / 2]) {
    ell(ctx, x + dx, y, r, r * 1.1, white);
    ell(ctx, x + dx - r * 0.3, y + r * 0.1, r * 0.5, r * 0.55, pupil);
    ell(ctx, x + dx - r * 0.45, y - r * 0.2, r * 0.18, r * 0.18, 'rgba(255,255,255,0.9)');
  }
  if (angry) {
    line(ctx, [[x - gap / 2 - r, y - r * 1.4], [x - gap / 2 + r, y - r * 0.8]], '#111', r * 0.4);
    line(ctx, [[x + gap / 2 + r, y - r * 1.4], [x + gap / 2 - r, y - r * 0.8]], '#111', r * 0.4);
  }
}

/** The cave: dark rock, stalactites, a lamp glow, the floor. */
export function drawCave(ctx: Ctx, w: number, h: number, floor: number, t: number) {
  // An angled view: the back wall at the top, the cave floor running away from you in perspective
  // (lines meet at a vanishing point up and to the right), your side lit by a torch.
  const deep = Math.min(1, floor / 20);
  const horizon = h * 0.44;
  const vx = w * 0.66, vy = h * 0.18; // vanishing point
  const wall = ctx.createLinearGradient(0, 0, 0, horizon);
  wall.addColorStop(0, `rgb(${22 - deep * 8}, ${19 - deep * 8}, ${34 + deep * 10})`);
  wall.addColorStop(1, `rgb(${40 - deep * 10}, ${34 - deep * 10}, ${54 + deep * 8})`);
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, horizon + 2);
  // Rock blocks on the back wall.
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  for (let row = 0; row < 4; row++) {
    const y = (row / 4) * horizon;
    for (let i = 0; i < 9; i++) {
      const x = ((i + (row % 2) * 0.5) / 8) * w;
      ctx.strokeRect(x - w / 16, y, w / 8, horizon / 4);
    }
  }
  // Floor (darker as it goes back), with perspective lines.
  const fl = ctx.createLinearGradient(0, horizon, 0, h);
  fl.addColorStop(0, '#15121e');
  fl.addColorStop(1, '#2a2436');
  ctx.fillStyle = fl;
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.lineTo(w, horizon);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = -6; i <= 12; i++) {
    const bx = (i / 6) * w; // where the line meets the bottom edge
    const k = (horizon - vy) / (h - vy);
    ctx.beginPath();
    ctx.moveTo(vx + (bx - vx) * k, horizon);
    ctx.lineTo(bx, h);
    ctx.stroke();
  }
  for (let j = 1; j <= 7; j++) {
    const y = horizon + (h - horizon) * (j / 7) ** 1.8; // closer together far away
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // The wall meets the floor: a dark lip.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, horizon - 2, w, 6);
  // Stalactites (front ones bigger) and stalagmites on the sides.
  for (let i = 0; i < 11; i++) {
    const x = (((i * 137) % 100) / 100) * w, len = 14 + ((i * 53) % 46);
    const near = i % 3 === 0;
    ctx.fillStyle = near ? '#1d1a29' : '#2a2638';
    ctx.beginPath();
    ctx.moveTo(x - (near ? 20 : 12), 0);
    ctx.lineTo(x + (near ? 20 : 12), 0);
    ctx.lineTo(x + 2, len * (near ? 1.5 : 1));
    ctx.closePath();
    ctx.fill();
  }
  for (const [x, y, s] of [[w * 0.04, h, 1.3], [w * 0.95, h * 0.98, 1.1], [w * 0.88, horizon + 8, 0.5], [w * 0.42, horizon + 4, 0.4]] as Array<[number, number, number]>) {
    ctx.fillStyle = '#231f31';
    ctx.beginPath();
    ctx.moveTo(x - 22 * s, y);
    ctx.lineTo(x + 22 * s, y);
    ctx.lineTo(x + 4 * s, y - 60 * s);
    ctx.closePath();
    ctx.fill();
  }
  // Torch glow on your side (front left), flickering; a cold glow deep in the cave.
  const fk = 0.85 + Math.sin(t / 90) * 0.08 + Math.sin(t / 37) * 0.05;
  const glow = ctx.createRadialGradient(w * 0.1, h * 0.75, 4, w * 0.1, h * 0.75, w * 0.6 * fk);
  glow.addColorStop(0, 'rgba(255, 170, 70, 0.38)');
  glow.addColorStop(1, 'rgba(255, 170, 70, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  const cold = ctx.createRadialGradient(vx, horizon, 2, vx, horizon, w * 0.35);
  cold.addColorStop(0, `rgba(120, 140, 255, ${0.12 + deep * 0.1})`);
  cold.addColorStop(1, 'rgba(120, 140, 255, 0)');
  ctx.fillStyle = cold;
  ctx.fillRect(0, 0, w, h);
}

/**
 * One enemy, its feet at (cx, cy), about `s` px tall. `t`: ms (idle bob), `windup`: 0..1 (leaning
 * back to swing).
 */
export function drawEnemy(ctx: Ctx, id: string, cx: number, cy: number, s: number, t: number, windup = 0) {
  ctx.save();
  const bob = Math.sin(t / 260) * s * 0.025;
  ctx.translate(cx + windup * s * 0.12, cy + bob);
  ctx.rotate(windup * 0.18);
  ell(ctx, 0, 0, s * 0.32, s * 0.06, 'rgba(0,0,0,0.45)'); // shadow
  const u = s / 100; // 1 unit = 1% of the height
  switch (id) {
    case 'lipas': {
      for (const k of [-1, 0, 1]) {
        line(ctx, [[k * 14 * u, -10 * u], [k * 24 * u - 8 * u, -2 * u], [k * 30 * u - 12 * u, 2 * u]], '#4a2f16', 3 * u);
      }
      ell(ctx, 0, -18 * u, 34 * u, 16 * u, '#7a4a1e');
      ell(ctx, 4 * u, -22 * u, 26 * u, 9 * u, '#9a6230');
      line(ctx, [[-30 * u, -20 * u], [-48 * u, -42 * u]], '#4a2f16', 2 * u);
      line(ctx, [[-28 * u, -22 * u], [-40 * u, -48 * u]], '#4a2f16', 2 * u);
      ell(ctx, -30 * u, -18 * u, 10 * u, 8 * u, '#5a3614');
      eyes(ctx, -32 * u, -21 * u, 8 * u, 3 * u, '#fff', '#111', true);
      break;
    }
    case 'tikus': {
      line(ctx, [[22 * u, -12 * u], [42 * u, -18 * u], [48 * u, -34 * u]], '#e599a7', 3 * u);
      ell(ctx, 0, -22 * u, 26 * u, 20 * u, '#868e96');
      ell(ctx, -18 * u, -38 * u, 16 * u, 14 * u, '#adb5bd');
      ell(ctx, -10 * u, -54 * u, 8 * u, 9 * u, '#adb5bd');
      ell(ctx, -10 * u, -54 * u, 5 * u, 6 * u, '#f3b5c0');
      ell(ctx, -32 * u, -36 * u, 3 * u, 3 * u, '#ff8fa3');
      eyes(ctx, -20 * u, -42 * u, 9 * u, 3.2 * u, '#fff', '#c92a2a');
      line(ctx, [[-30 * u, -34 * u], [-44 * u, -38 * u]], '#dee2e6', 1 * u);
      line(ctx, [[-30 * u, -32 * u], [-44 * u, -30 * u]], '#dee2e6', 1 * u);
      break;
    }
    case 'monyet': {
      line(ctx, [[18 * u, -20 * u], [36 * u, -30 * u], [34 * u, -52 * u]], '#7a3e1b', 4 * u);
      ell(ctx, 0, -26 * u, 22 * u, 24 * u, '#8b4a22');
      ell(ctx, -2 * u, -60 * u, 20 * u, 18 * u, '#8b4a22');
      ell(ctx, -22 * u, -60 * u, 6 * u, 7 * u, '#c07a4a');
      ell(ctx, 18 * u, -60 * u, 6 * u, 7 * u, '#c07a4a');
      ell(ctx, -4 * u, -56 * u, 13 * u, 11 * u, '#e0a878');
      eyes(ctx, -4 * u, -60 * u, 9 * u, 3 * u, '#fff', '#111', true);
      line(ctx, [[-10 * u, -50 * u], [0, -52 * u]], '#5a2a10', 1.5 * u);
      // A stolen phone
      ctx.fillStyle = '#212529';
      ctx.fillRect(-30 * u, -36 * u, 9 * u, 15 * u);
      ctx.fillStyle = '#4dabf7';
      ctx.fillRect(-29 * u, -35 * u, 7 * u, 11 * u);
      break;
    }
    case 'biawak': {
      line(ctx, [[20 * u, -10 * u], [40 * u, -6 * u], [56 * u, -2 * u]], '#4a6a2e', 6 * u);
      ell(ctx, 0, -14 * u, 30 * u, 12 * u, '#5c7a3a');
      for (let i = -2; i <= 2; i++) ell(ctx, i * 10 * u, -18 * u, 3 * u, 2 * u, '#7a9a52');
      ell(ctx, -32 * u, -20 * u, 14 * u, 9 * u, '#5c7a3a');
      line(ctx, [[-44 * u, -18 * u], [-54 * u, -16 * u], [-58 * u, -20 * u]], '#e03131', 1.5 * u);
      line(ctx, [[-54 * u, -16 * u], [-58 * u, -12 * u]], '#e03131', 1.5 * u);
      eyes(ctx, -34 * u, -24 * u, 6 * u, 2.6 * u, '#ffe066', '#111');
      for (const k of [-1, 1]) line(ctx, [[k * 16 * u, -6 * u], [k * 20 * u, 2 * u]], '#4a6a2e', 4 * u);
      break;
    }
    case 'toyol': {
      ell(ctx, 0, -18 * u, 15 * u, 16 * u, '#37b24d');
      ell(ctx, 0, -48 * u, 22 * u, 21 * u, '#40c057');
      ell(ctx, -20 * u, -50 * u, 6 * u, 8 * u, '#37b24d');
      ell(ctx, 20 * u, -50 * u, 6 * u, 8 * u, '#37b24d');
      line(ctx, [[0, -68 * u], [-2 * u, -78 * u], [4 * u, -82 * u]], '#2b8a3e', 2 * u);
      eyes(ctx, -2 * u, -50 * u, 14 * u, 5 * u, '#fff', '#e03131');
      ctx.beginPath();
      ctx.arc(-2 * u, -38 * u, 6 * u, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.strokeStyle = '#1b5e20';
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      ell(ctx, 10 * u, -36 * u, 3 * u, 2 * u, '#ffd43b'); // a stolen coin
      break;
    }
    case 'pocong': {
      ctx.beginPath();
      ctx.moveTo(-18 * u, 0);
      ctx.quadraticCurveTo(-26 * u, -50 * u, -14 * u, -78 * u);
      ctx.quadraticCurveTo(0, -94 * u, 14 * u, -78 * u);
      ctx.quadraticCurveTo(26 * u, -50 * u, 18 * u, 0);
      ctx.closePath();
      ctx.fillStyle = '#f1f3f5';
      ctx.fill();
      for (const y of [-20, -44]) line(ctx, [[-20 * u, y * u], [20 * u, (y - 3) * u]], '#ced4da', 2 * u);
      line(ctx, [[-6 * u, -90 * u], [0, -98 * u], [6 * u, -90 * u]], '#ced4da', 3 * u); // the tie
      ell(ctx, 0, -66 * u, 11 * u, 12 * u, '#343a40');
      eyes(ctx, 0, -68 * u, 9 * u, 2.6 * u, '#fff', '#fff');
      break;
    }
    case 'hantu_galah': {
      line(ctx, [[-6 * u, 0], [-4 * u, -50 * u]], '#343a40', 5 * u);
      line(ctx, [[6 * u, 0], [4 * u, -50 * u]], '#343a40', 5 * u);
      ell(ctx, 0, -70 * u, 12 * u, 26 * u, '#495057');
      line(ctx, [[-8 * u, -84 * u], [-30 * u, -56 * u], [-40 * u, -20 * u]], '#343a40', 4 * u);
      line(ctx, [[8 * u, -84 * u], [28 * u, -60 * u], [36 * u, -30 * u]], '#343a40', 4 * u);
      ell(ctx, 0, -102 * u, 10 * u, 11 * u, '#adb5bd');
      eyes(ctx, -1 * u, -103 * u, 8 * u, 2.6 * u, '#ffe066', '#111');
      break;
    }
    case 'jerangkung': {
      line(ctx, [[-8 * u, 0], [-6 * u, -34 * u]], '#e9ecef', 3 * u);
      line(ctx, [[8 * u, 0], [6 * u, -34 * u]], '#e9ecef', 3 * u);
      line(ctx, [[0, -34 * u], [0, -70 * u]], '#e9ecef', 3 * u);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(0, (-42 - i * 7) * u, (14 - i) * u, 4 * u, 0, Math.PI, 0);
        ctx.strokeStyle = '#e9ecef';
        ctx.lineWidth = 2.2 * u;
        ctx.stroke();
      }
      line(ctx, [[-12 * u, -66 * u], [-26 * u, -46 * u], [-30 * u, -30 * u]], '#e9ecef', 3 * u);
      line(ctx, [[12 * u, -66 * u], [24 * u, -48 * u], [26 * u, -32 * u]], '#e9ecef', 3 * u);
      ell(ctx, 0, -84 * u, 15 * u, 14 * u, '#f8f9fa');
      ell(ctx, -6 * u, -86 * u, 4.5 * u, 5 * u, '#111');
      ell(ctx, 6 * u, -86 * u, 4.5 * u, 5 * u, '#111');
      ell(ctx, -6 * u, -86 * u, 1.5 * u, 1.5 * u, '#ff6b6b');
      ell(ctx, 6 * u, -86 * u, 1.5 * u, 1.5 * u, '#ff6b6b');
      for (let i = -2; i <= 2; i++) line(ctx, [[i * 3 * u, -76 * u], [i * 3 * u, -72 * u]], '#495057', 1.2 * u);
      break;
    }
    case 'orang_minyak': {
      ell(ctx, 0, -2 * u, 30 * u, 5 * u, 'rgba(30, 30, 30, 0.9)'); // the oil puddle
      ctx.beginPath();
      ctx.moveTo(-22 * u, 0);
      ctx.quadraticCurveTo(-30 * u, -50 * u, -20 * u, -70 * u);
      ctx.quadraticCurveTo(0, -84 * u, 20 * u, -70 * u);
      ctx.quadraticCurveTo(30 * u, -50 * u, 22 * u, 0);
      ctx.closePath();
      ctx.fillStyle = '#16181d';
      ctx.fill();
      ell(ctx, 0, -86 * u, 16 * u, 15 * u, '#16181d');
      // The shine: oily highlights that slide around.
      const sh = (Math.sin(t / 400) + 1) / 2;
      ell(ctx, -8 * u + sh * 6 * u, -60 * u, 4 * u, 14 * u, 'rgba(255,255,255,0.35)', 0.2);
      ell(ctx, -6 * u, -92 * u, 6 * u, 3 * u, 'rgba(255,255,255,0.4)', -0.3);
      for (const x of [-16, 4, 18]) ell(ctx, x * u, (-20 - ((t / 30 + x * 7) % 30)) * u, 2 * u, 3 * u, '#16181d');
      eyes(ctx, -2 * u, -86 * u, 12 * u, 3.6 * u, '#ffe066', '#111', true);
      break;
    }
    case 'pontianak': {
      ctx.beginPath();
      ctx.moveTo(-26 * u, 0);
      ctx.quadraticCurveTo(-20 * u, -40 * u, -14 * u, -66 * u);
      ctx.lineTo(14 * u, -66 * u);
      ctx.quadraticCurveTo(20 * u, -40 * u, 26 * u, 0);
      ctx.closePath();
      ctx.fillStyle = '#f8f0fc';
      ctx.fill();
      for (const x of [-16, -4, 8, 20]) line(ctx, [[x * u, 0], [(x + 4) * u, -6 * u]], '#e6d5ee', 2 * u);
      // Long black hair down the back, a pale face.
      ctx.beginPath();
      ctx.moveTo(-18 * u, -84 * u);
      ctx.quadraticCurveTo(-28 * u, -40 * u, -20 * u, -16 * u);
      ctx.lineTo(20 * u, -16 * u);
      ctx.quadraticCurveTo(28 * u, -40 * u, 18 * u, -84 * u);
      ctx.closePath();
      ctx.fillStyle = '#0b0b0f';
      ctx.fill();
      ell(ctx, 0, -84 * u, 17 * u, 19 * u, '#0b0b0f');
      ell(ctx, -2 * u, -80 * u, 11 * u, 13 * u, '#e9ecef');
      ctx.fillStyle = '#0b0b0f';
      ctx.fillRect(-14 * u, -98 * u, 26 * u, 9 * u); // fringe
      eyes(ctx, -2 * u, -82 * u, 8 * u, 2.6 * u, '#fff', '#c92a2a');
      ell(ctx, -2 * u, -72 * u, 3 * u, 2 * u, '#c92a2a');
      ell(ctx, 14 * u, -96 * u, 4 * u, 4 * u, '#fff'); // a frangipani
      ell(ctx, 14 * u, -96 * u, 1.6 * u, 1.6 * u, '#ffd43b');
      break;
    }
    case 'hantu_raya':
    default: {
      ell(ctx, 0, -40 * u, 34 * u, 38 * u, '#c92a2a');
      ell(ctx, 0, -44 * u, 24 * u, 26 * u, '#e03131');
      ell(ctx, 0, -84 * u, 24 * u, 20 * u, '#c92a2a');
      ctx.fillStyle = '#f8f9fa';
      for (const k of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(k * 14 * u, -98 * u);
        ctx.lineTo(k * 26 * u, -118 * u);
        ctx.lineTo(k * 22 * u, -96 * u);
        ctx.closePath();
        ctx.fill();
      }
      eyes(ctx, -2 * u, -88 * u, 16 * u, 4.5 * u, '#ffe066', '#111', true);
      ctx.fillStyle = '#5c0a0a';
      ctx.fillRect(-12 * u, -76 * u, 22 * u, 6 * u);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) ctx.fillRect((-11 + i * 5.5) * u, -76 * u, 3 * u, 3 * u);
      for (const k of [-1, 1]) line(ctx, [[k * 30 * u, -56 * u], [k * 44 * u, -30 * u], [k * 40 * u, -14 * u]], '#a61e1e', 7 * u);
      break;
    }
  }
  ctx.restore();
}

let sprite: HTMLCanvasElement | null = null;
/**
 * Draws the enemy onto the scene via its own little canvas, so a hit can flash just the enemy
 * white (not the cave behind it). Feet at (cx, cy) on `dst`.
 */
export function blitEnemy(dst: Ctx, id: string, cx: number, cy: number, s: number, t: number, windup = 0, hurt = 0) {
  const W = Math.ceil(s * 2.2), H = Math.ceil(s * 1.5);
  sprite ??= document.createElement('canvas');
  if (sprite.width !== W || sprite.height !== H) {
    sprite.width = W;
    sprite.height = H;
  }
  const c = sprite.getContext('2d')!;
  c.clearRect(0, 0, W, H);
  drawEnemy(c, id, W / 2, H - s * 0.1, s, t, windup);
  if (hurt > 0) {
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = `rgba(255,255,255,${0.75 * hurt})`;
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
  }
  dst.drawImage(sprite, cx - W / 2, cy - (H - s * 0.1));
}

// Vehicle sprites drawn in code. The kapcai (small motorbike) is the delivery rider's ride.
import Phaser from 'phaser';

const RES = 2;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w * RES;
  c.height = h * RES;
  const ctx = c.getContext('2d')!;
  ctx.scale(RES, RES);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { c, ctx };
}

function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.fillStyle = '#212529';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#adb5bd';
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.45, ry * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Creates bike_side / bike_front / bike_back textures once. Size: 56×40 logical px, ground at y=36. */
export function ensureBikeTextures(scene: Phaser.Scene, body = '#e03131') {
  if (scene.textures.exists('bike_side')) return;
  // side view (facing left)
  {
    const { c, ctx } = canvas(56, 40);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(28, 37, 22, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    wheel(ctx, 12, 30, 7, 7);
    wheel(ctx, 44, 30, 7, 7);
    // frame + body panels
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(12, 24);
    ctx.lineTo(20, 14);
    ctx.lineTo(30, 22);
    ctx.lineTo(48, 20);
    ctx.lineTo(50, 27);
    ctx.lineTo(24, 30);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#8a1c1c';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // seat
    ctx.fillStyle = '#212529';
    ctx.beginPath();
    ctx.roundRect(28, 17, 18, 4, 2);
    ctx.fill();
    // handlebar + headlight
    ctx.strokeStyle = '#495057';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(18, 14);
    ctx.lineTo(16, 8);
    ctx.lineTo(21, 8);
    ctx.stroke();
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.ellipse(13, 16, 2.2, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // delivery box
    ctx.fillStyle = '#f59f00';
    ctx.beginPath();
    ctx.roundRect(42, 8, 12, 11, 1.5);
    ctx.fill();
    ctx.strokeStyle = '#a05a00';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 5px sans-serif';
    ctx.fillText('MAKAN', 42.5, 15);
    scene.textures.addCanvas('bike_side', c);
  }
  // front / back views
  for (const view of ['front', 'back'] as const) {
    const { c, ctx } = canvas(56, 40);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(28, 37, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    wheel(ctx, 28, 31, 3, 6);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(22, 18, 12, 12, 3);
    ctx.fill();
    ctx.strokeStyle = '#8a1c1c';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.strokeStyle = '#495057';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(16, 17);
    ctx.lineTo(40, 17);
    ctx.stroke();
    if (view === 'front') {
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(28, 21, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#f59f00';
      ctx.beginPath();
      ctx.roundRect(21, 6, 14, 12, 1.5);
      ctx.fill();
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(25, 26, 6, 2);
    }
    scene.textures.addCanvas(`bike_${view}`, c);
  }
}

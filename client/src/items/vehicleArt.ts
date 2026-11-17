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

/** Texture key prefix for a vehicle id (`<prefix>_side`, `_front`, `_back`). */
export function vehicleTexturePrefix(scene: Phaser.Scene, vehicle: string): string {
  if (vehicle === 'bicycle') {
    ensureBicycleTextures(scene);
    return 'bicycle';
  }
  ensureBikeTextures(scene);
  return 'bike';
}

/** The starter basikal: teal frame, front basket. Same 56×40 layout as the motorbike. */
export function ensureBicycleTextures(scene: Phaser.Scene) {
  if (scene.textures.exists('bicycle_side')) return;
  const frame = '#0ca678';
  const spokes = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
    ctx.strokeStyle = '#212529';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(173,181,189,0.9)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * (r - 1), y - Math.sin(a) * (r - 1));
      ctx.lineTo(x + Math.cos(a) * (r - 1), y + Math.sin(a) * (r - 1));
      ctx.stroke();
    }
    ctx.fillStyle = '#868e96';
    ctx.beginPath();
    ctx.arc(x, y, 1.3, 0, Math.PI * 2);
    ctx.fill();
  };
  // side view (facing left)
  {
    const { c, ctx } = canvas(56, 40);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(28, 37, 22, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    spokes(ctx, 12, 29, 8);
    spokes(ctx, 44, 29, 8);
    // frame: rear wheel → seat post → crank → head tube → front wheel
    ctx.strokeStyle = frame;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(44, 29);
    ctx.lineTo(34, 18);
    ctx.lineTo(18, 18);
    ctx.lineTo(12, 29);
    ctx.moveTo(44, 29);
    ctx.lineTo(29, 29);
    ctx.lineTo(34, 18);
    ctx.moveTo(29, 29);
    ctx.lineTo(18, 18);
    ctx.stroke();
    // crank + pedal
    ctx.fillStyle = '#495057';
    ctx.beginPath();
    ctx.arc(29, 29, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(28, 31, 5, 1.5);
    // seat + post
    ctx.strokeStyle = '#495057';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(34, 18);
    ctx.lineTo(35, 14);
    ctx.stroke();
    ctx.fillStyle = '#212529';
    ctx.beginPath();
    ctx.roundRect(31, 12.5, 9, 3, 1.5);
    ctx.fill();
    // handlebar
    ctx.beginPath();
    ctx.moveTo(18, 18);
    ctx.lineTo(17, 11);
    ctx.lineTo(21, 10);
    ctx.stroke();
    // wicker basket
    ctx.fillStyle = '#c08a4a';
    ctx.beginPath();
    ctx.roundRect(8, 12, 9, 7, 1.5);
    ctx.fill();
    ctx.strokeStyle = '#8d5a33';
    ctx.lineWidth = 0.6;
    for (let x = 10; x < 17; x += 2.2) {
      ctx.beginPath();
      ctx.moveTo(x, 12.5);
      ctx.lineTo(x, 18.5);
      ctx.stroke();
    }
    scene.textures.addCanvas('bicycle_side', c);
  }
  for (const view of ['front', 'back'] as const) {
    const { c, ctx } = canvas(56, 40);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(28, 37, 8, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#212529';
    ctx.beginPath();
    ctx.roundRect(26.5, 22, 3, 15, 1.5);
    ctx.fill();
    ctx.strokeStyle = frame;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(28, 30);
    ctx.lineTo(28, 17);
    ctx.stroke();
    ctx.strokeStyle = '#495057';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(18, 15);
    ctx.lineTo(38, 15);
    ctx.stroke();
    ctx.fillStyle = '#212529';
    ctx.fillRect(16, 14, 3, 3);
    ctx.fillRect(37, 14, 3, 3);
    if (view === 'front') {
      ctx.fillStyle = '#c08a4a';
      ctx.beginPath();
      ctx.roundRect(23, 17, 10, 7, 1.5);
      ctx.fill();
      ctx.fillStyle = '#fff3bf';
      ctx.beginPath();
      ctx.arc(28, 26, 1.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(26.5, 24, 3, 2);
    }
    scene.textures.addCanvas(`bicycle_${view}`, c);
  }
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

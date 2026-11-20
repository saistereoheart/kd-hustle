// Small decor sprites (lamps, benches, flowers, fountain, jobs board, bus stop) drawn in code.
// Each sprite is drawn in a 32-unit box and rendered at 64 px for sharpness.
import { Decor } from '@kh/shared';

const TILE = 32;
type Ctx = CanvasRenderingContext2D;

function tree(ctx: Ctx, color: string, dark: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(18, 27, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(14, 18, 4, 10);
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(16, 13, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(14, 11, 9, 0, Math.PI * 2);
  ctx.arc(20, 14, 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawDecor(ctx: Ctx, id: number) {
  switch (id) {
    case Decor.Tree:
      tree(ctx, '#3f9e45', '#2f7d35');
      break;
    case Decor.Pine:
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(17, 28, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#245e2a';
      ctx.beginPath();
      ctx.moveTo(16, 1);
      ctx.lineTo(28, 26);
      ctx.lineTo(4, 26);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2f7535';
      ctx.beginPath();
      ctx.moveTo(16, 5);
      ctx.lineTo(23, 20);
      ctx.lineTo(9, 20);
      ctx.closePath();
      ctx.fill();
      break;
    case Decor.Palm:
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(17, 28, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8a6a3c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(17, 28);
      ctx.quadraticCurveTo(13, 18, 16, 9);
      ctx.stroke();
      ctx.strokeStyle = '#3a9d48';
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(16, 9);
        ctx.quadraticCurveTo(16 + Math.cos(a) * 7, 9 + Math.sin(a) * 4 - 4, 16 + Math.cos(a) * 12, 9 + Math.sin(a) * 9);
        ctx.stroke();
      }
      break;
    case Decor.Bush:
      ctx.fillStyle = '#3c8c3f';
      ctx.beginPath();
      ctx.arc(12, 20, 7, 0, Math.PI * 2);
      ctx.arc(20, 20, 7, 0, Math.PI * 2);
      ctx.arc(16, 15, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    case Decor.Lamp: {
      // Base plate, a shaded pole (lit left edge), the arm and a lamp head with a glass.
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(16.5, 28, 4, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#495057';
      ctx.fillRect(13.5, 25, 6, 3);
      ctx.fillStyle = '#5f6672';
      ctx.fillRect(15, 5, 3, 21);
      ctx.fillStyle = '#868e96';
      ctx.fillRect(15, 5, 1, 21);
      ctx.fillStyle = '#5f6672';
      ctx.beginPath();
      ctx.moveTo(16, 5);
      ctx.quadraticCurveTo(19, 2.5, 24, 5);
      ctx.lineTo(24, 6.5);
      ctx.quadraticCurveTo(19, 4.5, 17, 7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#343a40';
      ctx.fillRect(20.5, 5.5, 6, 2.2);
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.ellipse(23.5, 8.6, 3, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff9db';
      ctx.fillRect(22.3, 8, 1.6, 0.9);
      break;
    }
    case Decor.Bench:
      ctx.fillStyle = '#8d5a33';
      ctx.fillRect(5, 12, 22, 4);
      ctx.fillRect(5, 18, 22, 4);
      ctx.fillStyle = '#4a4f59';
      ctx.fillRect(7, 22, 2, 4);
      ctx.fillRect(23, 22, 2, 4);
      break;
    case Decor.Flowers:
      ctx.fillStyle = '#5c9e3a';
      ctx.beginPath();
      ctx.roundRect(4, 8, 24, 18, 6);
      ctx.fill();
      for (const [x, y, c] of [[9, 13, '#ff6b9a'], [17, 12, '#ffd43b'], [23, 15, '#ff8787'], [12, 20, '#e599f7'], [21, 21, '#ffd43b']] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case Decor.Fountain:
      ctx.fillStyle = '#adb5bd';
      ctx.beginPath();
      ctx.arc(16, 16, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4dabf7';
      ctx.beginPath();
      ctx.arc(16, 16, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d0ebff';
      ctx.beginPath();
      ctx.arc(16, 16, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case Decor.JobsBoard:
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(6, 18, 3, 12);
      ctx.fillRect(23, 18, 3, 12);
      ctx.fillStyle = '#a0522d';
      ctx.fillRect(3, 4, 26, 18);
      ctx.fillStyle = '#fff3bf';
      ctx.fillRect(6, 7, 8, 6);
      ctx.fillStyle = '#d0ebff';
      ctx.fillRect(17, 8, 9, 5);
      ctx.fillStyle = '#ffe3e3';
      ctx.fillRect(9, 14, 10, 6);
      break;
    case Decor.Lookout:
      ctx.fillStyle = '#495057';
      ctx.fillRect(15, 14, 3, 16);
      ctx.fillStyle = '#343a40';
      ctx.save();
      ctx.translate(16, 12);
      ctx.rotate(-0.4);
      ctx.fillRect(-9, -3, 18, 6);
      ctx.restore();
      break;
    case Decor.Stall: {
      // pasar malam stall: table + striped canopy
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(3, 26, 28, 4);
      ctx.fillStyle = '#8d5a33';
      ctx.fillRect(4, 18, 24, 8);
      ctx.fillStyle = '#adb5bd';
      ctx.fillRect(4, 6, 2, 20);
      ctx.fillRect(26, 6, 2, 20);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#ffffff' : '#e03131';
        ctx.fillRect(2 + i * 4.7, 3, 4.7, 7);
      }
      ctx.fillStyle = '#f59f00';
      ctx.fillRect(8, 14, 6, 4);
      ctx.fillStyle = '#e03131';
      ctx.fillRect(16, 14, 6, 4);
      break;
    }
    case Decor.BusStop:
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(3, 24, 28, 4);
      ctx.fillStyle = '#1971c2';
      ctx.fillRect(2, 6, 28, 6);
      ctx.fillStyle = '#adb5bd';
      ctx.fillRect(4, 12, 2, 14);
      ctx.fillRect(26, 12, 2, 14);
      ctx.fillStyle = '#8d5a33';
      ctx.fillRect(7, 19, 18, 3);
      break;
  }
}

/** Sprite index in the decor sheet for each decor id. */
export const DECOR_SPRITE: Record<number, number> = {
  [Decor.Bush]: 0, [Decor.Lamp]: 1, [Decor.Bench]: 2, [Decor.Flowers]: 3, [Decor.Fountain]: 4,
  [Decor.JobsBoard]: 5, [Decor.Lookout]: 6, [Decor.BusStop]: 7, [Decor.Stall]: 8,
};

/** One row of 64 px decor sprites. */
/** The decor sprite sheet. `make` gives a blank canvas (an OffscreenCanvas in the chunk worker). */
export function buildDecorSprites(make?: (w: number, h: number) => HTMLCanvasElement): HTMLCanvasElement {
  const ids = Object.keys(DECOR_SPRITE).map(Number);
  const canvas = make ? make(ids.length * 64, 64) : document.createElement('canvas');
  canvas.width = ids.length * 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  for (const id of ids) {
    ctx.save();
    ctx.translate(DECOR_SPRITE[id] * 64, 0);
    ctx.scale(2, 2);
    drawDecor(ctx, id);
    ctx.restore();
  }
  return canvas;
}

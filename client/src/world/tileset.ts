// Generates the tileset texture in code (no image files). Each 32px tile is drawn into a
// 34px cell with its edge pixels extruded by 1px, which prevents seams between tiles when
// the camera zooms to fractional scales.
import { Decor, DECOR_TILE_COUNT, GROUND_TILE_COUNT, Tile, tileHash } from '@kh/shared';

export const TILE = 32;
export const MARGIN = 1;
export const SPACING = 2;
const CELL = TILE + SPACING;
const COLS = 8;
export const DECOR_OFFSET = GROUND_TILE_COUNT; // decor id d → tile index DECOR_OFFSET + d

type Ctx = CanvasRenderingContext2D;

function speckle(ctx: Ctx, seed: number, colors: string[], count: number, size = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[i % colors.length];
    const x = Math.floor(tileHash(i, seed, 1) * TILE);
    const y = Math.floor(tileHash(seed, i, 2) * TILE);
    ctx.fillRect(x, y, size, size);
  }
}

function drawGround(ctx: Ctx, id: number) {
  const fill = (c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, TILE, TILE);
  };
  switch (id) {
    case Tile.Grass:
      fill('#7cc456');
      speckle(ctx, 11, ['#6db349', '#8fd266'], 18);
      break;
    case Tile.Park:
      fill('#86cf5d');
      speckle(ctx, 12, ['#77bf4f', '#9bdd73'], 16);
      break;
    case Tile.Forest:
      fill('#4f9a3e');
      speckle(ctx, 13, ['#438a34', '#5aa948', '#3e7f30'], 24);
      break;
    case Tile.Field:
      fill('#9bd36a');
      ctx.fillStyle = '#a8dc78';
      ctx.fillRect(0, 0, 16, TILE);
      break;
    case Tile.Golf:
      fill('#8fdc6a');
      ctx.fillStyle = '#9be678';
      ctx.fillRect(0, 0, TILE, 16);
      break;
    case Tile.Street:
      fill('#4b4f59');
      speckle(ctx, 14, ['#555a64', '#42464f'], 14);
      break;
    case Tile.Highway:
      fill('#3a3d45');
      speckle(ctx, 15, ['#444851', '#33363d'], 14);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(14, 0, 4, 12);
      break;
    case Tile.Zebra:
      fill('#4b4f59');
      ctx.fillStyle = '#f1f3f5';
      for (let x = 2; x < TILE; x += 8) ctx.fillRect(x, 2, 4, TILE - 4);
      break;
    case Tile.Sidewalk:
      fill('#d8d2c4');
      ctx.strokeStyle = '#c3bcac';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, 16, 16);
      ctx.strokeRect(16.5, 16.5, 16, 16);
      ctx.strokeRect(16.5, 0.5, 16, 16);
      ctx.strokeRect(0.5, 16.5, 16, 16);
      break;
    case Tile.Plaza:
      fill('#e9d9b6');
      ctx.fillStyle = '#dccaa2';
      for (let y = 0; y < TILE; y += 8) for (let x = (y / 8) % 2 ? 0 : 8; x < TILE; x += 16) ctx.fillRect(x, y, 8, 8);
      break;
    case Tile.Water:
      fill('#4aa3df');
      ctx.strokeStyle = '#7cc0ee';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(9, 12, 5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.arc(24, 24, 5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      break;
    case Tile.Building:
      fill('#5a5f6b');
      break;
    case Tile.Parking:
      fill('#8b909a');
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(0, 0, 2, TILE);
      break;
    case Tile.Bridge:
      fill('#bda98a');
      ctx.fillStyle = '#a8946f';
      for (let y = 3; y < TILE; y += 7) ctx.fillRect(0, y, TILE, 2);
      break;
    case Tile.Trail:
      fill('#c9a774');
      speckle(ctx, 16, ['#b8955f', '#d8b988'], 14);
      break;
  }
}

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

function car(ctx: Ctx, body: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(9, 4, 16, 27);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(7, 2, 16, 27, 5);
  ctx.fill();
  ctx.fillStyle = '#2b3445';
  ctx.fillRect(9, 7, 12, 5);
  ctx.fillRect(9, 20, 12, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(10, 13, 10, 6);
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
    case Decor.Lamp:
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(15, 27, 6, 2);
      ctx.fillStyle = '#5f6672';
      ctx.fillRect(15, 6, 3, 22);
      ctx.fillRect(15, 6, 9, 2);
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(23, 9, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
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
    case Decor.CarRed:
      car(ctx, '#e03131');
      break;
    case Decor.CarBlue:
      car(ctx, '#1c7ed6');
      break;
    case Decor.CarWhite:
      car(ctx, '#f1f3f5');
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

/** Returns a canvas containing every ground + decor tile. */
export function buildTilesetCanvas(): HTMLCanvasElement {
  const total = GROUND_TILE_COUNT + DECOR_TILE_COUNT;
  const rows = Math.ceil(total / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = MARGIN * 2 + COLS * CELL - SPACING;
  canvas.height = MARGIN * 2 + rows * CELL - SPACING;
  const ctx = canvas.getContext('2d')!;
  const tmp = document.createElement('canvas');
  tmp.width = TILE;
  tmp.height = TILE;
  const t = tmp.getContext('2d')!;
  for (let i = 0; i < total; i++) {
    t.clearRect(0, 0, TILE, TILE);
    if (i < GROUND_TILE_COUNT) drawGround(t, i);
    else drawDecor(t, i - DECOR_OFFSET);
    const x = MARGIN + (i % COLS) * CELL;
    const y = MARGIN + Math.floor(i / COLS) * CELL;
    ctx.drawImage(tmp, x, y);
    if (i < GROUND_TILE_COUNT) {
      // extrude edges (ground tiles only; decor has transparent edges)
      ctx.drawImage(tmp, 0, 0, TILE, 1, x, y - 1, TILE, 1);
      ctx.drawImage(tmp, 0, TILE - 1, TILE, 1, x, y + TILE, TILE, 1);
      ctx.drawImage(tmp, 0, 0, 1, TILE, x - 1, y, 1, TILE);
      ctx.drawImage(tmp, TILE - 1, 0, 1, TILE, x + TILE, y, 1, TILE);
    }
  }
  return canvas;
}

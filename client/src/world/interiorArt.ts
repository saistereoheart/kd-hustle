// Interior art, drawn in code: room shell (floor, back wall, side walls, doorway) plus
// furniture and the "stations" (capsule machine, pawn counter, checkout, car wash bay...).
// Sizes are in tiles; T = pixels per tile. Everything is top-down with a little front face.
import type Phaser from 'phaser';
import type { Furniture, RoomStyle } from '@kh/shared';

export const T = 32;

const hex = (c: string) => parseInt(c.slice(1), 16);
function shade(c: number, f: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}

/** Footprint (tiles) of each furniture piece: what blocks walking. */
export const FURNITURE_SIZE: Record<Furniture, [number, number]> = {
  shelf: [3, 1], fridge: [1.4, 1], plant: [0.8, 0.8], glasscase: [2.4, 1], safe: [1.2, 1.2], hose: [1, 1], buckets: [1.4, 0.8],
  tyres: [1.2, 1.2], trolleys: [2, 1], fountain: [2.6, 2.6], bench: [2.4, 0.8], kiosk: [2, 1.4], atm: [1, 1], sofa: [2.6, 1.1],
  slot: [1.2, 1.2], table: [2.4, 1.6], desk: [2.4, 1], gate: [2, 0.6], tv: [2, 0.5], bed: [2.2, 3], boxes: [1.4, 1.2],
  ladder: [0.6, 2], sign: [1.2, 0.4],
};

/** Station footprints (tiles), by interactable type. */
export function stationSize(type: string): [number, number] {
  return type === 'carwash' ? [5, 2.6] : type === 'market' ? [3.4, 1.4] : type === 'crate' ? [1.8, 1.4] : [2.8, 1.3];
}

/** Where the doorway is: which wall, and its centre along that wall (px). */
export interface RoomDoor {
  side: 'top' | 'bottom' | 'left' | 'right';
  pos: number;
}

/** Half the doorway's width (px). */
export const DOOR_HALF = 1.2 * T;

/** Floor, walls, the doorway (in any wall) and its mat. Returns nothing: it's one static Graphics. */
export function drawRoom(g: Phaser.GameObjects.Graphics, s: RoomStyle, door: RoomDoor) {
  const W = s.w * T, H = s.h * T;
  const floor = hex(s.floor), floor2 = hex(s.floor2), wall = hex(s.wall), trim = hex(s.trim);
  const d0 = door.pos - DOOR_HALF, d1 = door.pos + DOOR_HALF;
  // drop shadow under the whole room (it floats above the darkened town)
  g.fillStyle(0x000000, 0.45).fillRoundedRect(-14, -6, W + 28, H + 26, 18);
  // floor: checker tiles
  g.fillStyle(floor, 1).fillRect(0, 0, W, H);
  g.fillStyle(floor2, 1);
  for (let y = 2; y < s.h; y++) for (let x = 0; x < s.w; x++) if ((x + y) % 2 === 0) g.fillRect(x * T, y * T, T, T);
  // soft light pool in the middle of the room, darker corners
  g.fillStyle(0xffffff, 0.06).fillEllipse(W / 2, H * 0.55, W * 0.8, H * 0.7);
  g.fillStyle(0x000000, 0.08).fillRect(0, 2 * T, T * 0.6, H - 2 * T).fillRect(W - T * 0.6, 2 * T, T * 0.6, H - 2 * T);
  // back wall (2 tiles tall) with a skirting board and a top band; a door in it cuts through
  const backWall = (x0: number, x1: number) => {
    if (x1 <= x0) return;
    g.fillStyle(wall, 1).fillRect(x0, 0, x1 - x0, 2 * T);
    g.fillStyle(shade(wall, 0.12), 1).fillRect(x0, 0, x1 - x0, 10);
    g.fillStyle(trim, 1).fillRect(x0, 2 * T - 8, x1 - x0, 8);
  };
  if (door.side === 'top') {
    backWall(0, d0);
    backWall(d1, W);
    // the passage through the wall: floor, with the frame's posts either side
    g.fillStyle(floor2, 1).fillRect(d0, 0, d1 - d0, 2 * T);
    g.fillStyle(shade(trim, -0.2), 1).fillRect(d0 - 5, 0, 5, 2 * T).fillRect(d1, 0, 5, 2 * T);
  } else backWall(0, W);
  // windows on the back wall (not where the door is)
  for (let x = 1.2; x < s.w - 2; x += 4) {
    const wx = x * T;
    if (door.side === 'top' && wx + 2 * T > d0 - 6 && wx < d1 + 6) continue;
    g.fillStyle(0xa5d8ff, 0.85).fillRoundedRect(wx, 16, 2 * T, 26, 4);
    g.fillStyle(0xffffff, 0.35).fillRect(wx + 6, 20, 10, 18);
  }
  // outer walls (thick borders) with the doorway gap on the door's side
  const wallTop = shade(wall, -0.35);
  g.fillStyle(wallTop, 1);
  const hWall = (y: number, gap: boolean) => (gap ? g.fillRect(-10, y, d0 + 10, 10).fillRect(d1, y, W - d1 + 10, 10) : g.fillRect(-10, y, W + 20, 10));
  const vWall = (x: number, gap: boolean) => (gap ? g.fillRect(x, -10, 10, d0 + 10).fillRect(x, d1, 10, H - d1 + 10) : g.fillRect(x, -10, 10, H + 20));
  hWall(-10, door.side === 'top');
  hWall(H, door.side === 'bottom');
  vWall(-10, door.side === 'left');
  vWall(W, door.side === 'right');
  // door mat just inside
  g.fillStyle(0x8c5a3c, 1);
  const mat = (x: number, y: number, w: number, h: number) => {
    g.fillStyle(0x8c5a3c, 1).fillRoundedRect(x, y, w, h, 4);
    g.lineStyle(2, 0xd9a066, 1).strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, 3);
  };
  if (door.side === 'bottom') mat(door.pos - 1.1 * T, H - 0.75 * T, 2.2 * T, 0.75 * T);
  else if (door.side === 'top') mat(door.pos - 1.1 * T, 2 * T, 2.2 * T, 0.75 * T);
  else if (door.side === 'left') mat(0, door.pos - 1.1 * T, 0.75 * T, 2.2 * T);
  else mat(W - 0.75 * T, door.pos - 1.1 * T, 0.75 * T, 2.2 * T);
}

/** A glowing spot under a counter / machine so it's obvious you can use it. */
export function drawHighlight(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number, color: number) {
  g.fillStyle(color, 0.18).fillEllipse(cx, cy + h * 0.15, w + 3.2 * T, h + 2.2 * T);
  g.fillStyle(color, 0.28).fillEllipse(cx, cy + h * 0.15, w + 1.8 * T, h + 1.3 * T);
  g.lineStyle(3, color, 0.9).strokeEllipse(cx, cy + h * 0.15, w + 1.8 * T, h + 1.3 * T);
}

/** One furniture piece, centred at (cx, cy) in px. */
export function drawFurniture(g: Phaser.GameObjects.Graphics, kind: Furniture, cx: number, cy: number, accent: number) {
  const [tw, th] = FURNITURE_SIZE[kind];
  const w = tw * T, h = th * T, x = cx - w / 2, y = cy - h / 2;
  g.fillStyle(0x000000, 0.18).fillRoundedRect(x + 3, y + 5, w, h, 5);
  switch (kind) {
    case 'shelf': {
      g.fillStyle(0x8d6e63, 1).fillRect(x, y, w, h);
      const cols = [0xe03131, 0xf59f00, 0x2f9e44, 0x1c7ed6, 0xae3ec9, 0xfab005];
      for (let i = 0; i < 9; i++) g.fillStyle(cols[i % cols.length], 1).fillRect(x + 4 + i * ((w - 8) / 9), y + 4, (w - 8) / 9 - 2, h - 10);
      g.fillStyle(0x5d4037, 1).fillRect(x, y + h - 5, w, 5);
      break;
    }
    case 'fridge':
      g.fillStyle(0xe7f5ff, 1).fillRoundedRect(x, y, w, h, 4);
      g.fillStyle(0x74c0fc, 0.7).fillRect(x + 4, y + 4, w - 8, h - 10);
      for (let i = 0; i < 4; i++) g.fillStyle([0xe03131, 0x40c057, 0xfab005, 0x1c7ed6][i], 1).fillCircle(x + 8 + i * ((w - 14) / 3), y + h / 2, 3);
      break;
    case 'plant':
      g.fillStyle(0x9c6644, 1).fillRect(cx - 7, cy, 14, 10);
      g.fillStyle(0x2f9e44, 1).fillCircle(cx, cy - 4, 11).fillCircle(cx - 8, cy, 7).fillCircle(cx + 8, cy, 7);
      g.fillStyle(0x51cf66, 1).fillCircle(cx - 3, cy - 7, 5);
      break;
    case 'glasscase':
      g.fillStyle(0x495057, 1).fillRect(x, y, w, h);
      g.fillStyle(0xa5d8ff, 0.55).fillRect(x + 3, y + 3, w - 6, h - 8);
      for (let i = 0; i < 4; i++) g.fillStyle([0xfcc419, 0xe64980, 0x15aabf, 0xf8f9fa][i], 1).fillCircle(x + 12 + i * ((w - 24) / 3), y + h / 2 - 1, 4);
      break;
    case 'safe':
      g.fillStyle(0x343a40, 1).fillRoundedRect(x, y, w, h, 4);
      g.lineStyle(3, 0xadb5bd, 1).strokeCircle(cx, cy, 8);
      break;
    case 'hose':
      g.fillStyle(0xf59f00, 1).fillCircle(cx, cy, 13);
      g.lineStyle(4, 0x2f9e44, 1).strokeCircle(cx, cy, 9);
      break;
    case 'buckets':
      for (const dx of [-12, 12]) {
        g.fillStyle(dx < 0 ? 0xe03131 : 0x1c7ed6, 1).fillCircle(cx + dx, cy, 10);
        g.fillStyle(0xffffff, 0.8).fillCircle(cx + dx, cy, 6);
      }
      break;
    case 'tyres':
      g.fillStyle(0x212529, 1).fillCircle(cx, cy, 18);
      g.fillStyle(0x495057, 1).fillCircle(cx, cy, 8);
      break;
    case 'trolleys':
      for (let i = 0; i < 3; i++) {
        g.lineStyle(3, 0xadb5bd, 1).strokeRect(x + i * 12, y + 2, w - 26, h - 6);
      }
      break;
    case 'fountain':
      g.fillStyle(0xced4da, 1).fillCircle(cx, cy, w / 2);
      g.fillStyle(0x4dabf7, 1).fillCircle(cx, cy, w / 2 - 8);
      g.fillStyle(0xd0ebff, 1).fillCircle(cx, cy, 10);
      g.fillStyle(0xffffff, 0.7).fillCircle(cx - 14, cy - 8, 3).fillCircle(cx + 12, cy + 10, 3);
      break;
    case 'bench':
      g.fillStyle(0x8d6e63, 1).fillRoundedRect(x, y, w, h, 4);
      g.fillStyle(0x6d4c41, 1).fillRect(x, y + h - 4, w, 4);
      break;
    case 'kiosk':
      g.fillStyle(accent, 1).fillRoundedRect(x, y, w, h, 6);
      g.fillStyle(0xffffff, 0.9).fillRect(x + 6, y + 6, w - 12, 10);
      break;
    case 'atm':
      g.fillStyle(0x1d3557, 1).fillRoundedRect(x, y, w, h, 3);
      g.fillStyle(0x8ce99a, 1).fillRect(x + 6, y + 5, w - 12, 10);
      g.fillStyle(0xdee2e6, 1).fillRect(x + 8, y + 20, w - 16, 6);
      break;
    case 'sofa':
      g.fillStyle(shade(accent, -0.2), 1).fillRoundedRect(x, y, w, h, 8);
      g.fillStyle(accent, 1).fillRoundedRect(x + 6, y + 6, w - 12, h - 10, 6);
      break;
    case 'slot':
      g.fillStyle(0xc92a2a, 1).fillRoundedRect(x, y, w, h, 5);
      g.fillStyle(0xfff3bf, 1).fillRect(x + 5, y + 7, w - 10, 12);
      g.fillStyle(0xffd43b, 1).fillCircle(x + w - 4, y + 6, 4);
      break;
    case 'table':
      g.fillStyle(0x2b8a3e, 1).fillRoundedRect(x, y, w, h, 18);
      g.lineStyle(3, 0xfcc419, 1).strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, 16);
      break;
    case 'desk':
      g.fillStyle(0x6d4c41, 1).fillRoundedRect(x, y, w, h, 4);
      g.fillStyle(0x343a40, 1).fillRect(cx - 10, y + 4, 20, 13);
      break;
    case 'gate':
      g.fillStyle(0x495057, 1).fillRect(x, y, w, h);
      g.fillStyle(0x51cf66, 1).fillRect(x + 4, y + 4, 10, h - 8);
      g.fillStyle(0xff6b6b, 1).fillRect(x + w - 14, y + 4, 10, h - 8);
      break;
    case 'tv':
      g.fillStyle(0x212529, 1).fillRect(x, y, w, h);
      g.fillStyle(0x4dabf7, 1).fillRect(x + 3, y + 2, w - 6, h - 4);
      break;
    case 'bed':
      g.fillStyle(0xf8f9fa, 1).fillRoundedRect(x, y, w, h, 6);
      g.fillStyle(accent, 1).fillRoundedRect(x, y + h * 0.35, w, h * 0.65, 6);
      g.fillStyle(0xffffff, 1).fillRoundedRect(x + 8, y + 6, w - 16, 18, 6);
      break;
    case 'boxes':
      g.fillStyle(0xc69c6d, 1).fillRect(x, y + 6, w * 0.6, h - 6);
      g.fillStyle(0xd8b384, 1).fillRect(x + w * 0.45, y, w * 0.55, h * 0.7);
      g.lineStyle(2, 0x9c7a50, 1).strokeRect(x + w * 0.45, y, w * 0.55, h * 0.7);
      break;
    case 'ladder':
      g.lineStyle(3, 0xadb5bd, 1).strokeRect(x, y, w, h);
      for (let k = 8; k < h; k += 10) g.lineBetween(x, y + k, x + w, y + k);
      break;
    case 'sign':
      g.fillStyle(0xffffff, 1).fillRect(x, y, w, h);
      g.fillStyle(0xe03131, 1).fillRect(x + 3, y + 3, w - 6, h - 6);
      break;
  }
}

/** A station (what you use in here), centred at (cx, cy) px. */
export function drawStation(g: Phaser.GameObjects.Graphics, type: string, crate: string | undefined, cx: number, cy: number, accent: number) {
  const [tw, th] = stationSize(type);
  const w = tw * T, h = th * T, x = cx - w / 2, y = cy - h / 2;
  g.fillStyle(0x000000, 0.2).fillRoundedRect(x + 3, y + 6, w, h, 6);
  if (type === 'crate' && crate === 'capsule') {
    // gacha capsule machine: red base, glass dome full of capsules
    g.fillStyle(0xc92a2a, 1).fillRoundedRect(x + 6, cy - 2, w - 12, h / 2 + 4, 6);
    g.fillStyle(0xe7f5ff, 0.9).fillCircle(cx, cy - 8, 22);
    const caps = [0xfa5252, 0xfcc419, 0x40c057, 0x339af0, 0xcc5de8, 0xff922b];
    for (let i = 0; i < 9; i++) g.fillStyle(caps[i % caps.length], 1).fillCircle(cx - 12 + (i % 3) * 12, cy - 18 + Math.floor(i / 3) * 9, 5);
    g.fillStyle(0xffd43b, 1).fillCircle(cx, cy + 14, 6);
  } else if (type === 'crate') {
    // counter with stacked gift boxes / red packets
    g.fillStyle(0x6d4c41, 1).fillRoundedRect(x, y + h * 0.35, w, h * 0.65, 6);
    const cols = crate === 'luckybag' ? [0xe03131, 0xc92a2a, 0xfcc419] : [0xae3ec9, 0x1c7ed6, 0xf59f00];
    for (let i = 0; i < 3; i++) {
      g.fillStyle(cols[i], 1).fillRect(x + 6 + i * ((w - 12) / 3), y + 2 + (i % 2) * 6, (w - 12) / 3 - 4, h * 0.45);
      g.fillStyle(0xfff3bf, 1).fillRect(x + 6 + i * ((w - 12) / 3) + ((w - 12) / 3 - 4) / 2 - 2, y + 2 + (i % 2) * 6, 4, h * 0.45);
    }
  } else if (type === 'pawn') {
    g.fillStyle(0x5d4037, 1).fillRoundedRect(x, y, w, h, 6);
    g.fillStyle(0xa5d8ff, 0.6).fillRect(x + 6, y + 6, w - 12, h - 16);
    for (let i = 0; i < 5; i++) g.fillStyle([0xfcc419, 0xadb5bd, 0xe64980, 0x15aabf, 0xf8f9fa][i], 1).fillCircle(x + 14 + i * ((w - 28) / 4), cy - 2, 4);
    g.fillStyle(0xffd43b, 1).fillCircle(x + w - 12, y + 8, 5); // service bell
  } else if (type === 'market') {
    g.fillStyle(0x495057, 1).fillRoundedRect(x, y, w, h, 6);
    g.fillStyle(0x212529, 1).fillRect(x + 6, cy - 6, w * 0.6, 12); // conveyor
    g.fillStyle(0x868e96, 1).fillRect(x + w * 0.72, y + 6, w * 0.22, h - 12); // till
    g.fillStyle(0x8ce99a, 1).fillRect(x + w * 0.75, y + 10, w * 0.16, 8);
  } else if (type === 'carwash') {
    // wet pad with drain stripes, a car under suds, hose reel
    g.fillStyle(0xadb5bd, 1).fillRoundedRect(x, y, w, h, 10);
    g.fillStyle(0x868e96, 1);
    for (let k = x + 10; k < x + w - 10; k += 22) g.fillRect(k, y + h - 10, 12, 4);
    g.fillStyle(0x74c0fc, 0.45).fillEllipse(cx - w * 0.3, cy + 10, 60, 16).fillEllipse(cx + w * 0.3, cy - 14, 44, 12);
    g.fillStyle(accent, 1).fillRoundedRect(cx - 56, cy - 22, 112, 44, 12);
    g.fillStyle(0xa5d8ff, 1).fillRoundedRect(cx - 30, cy - 18, 22, 36, 4).fillRoundedRect(cx + 16, cy - 18, 16, 36, 4);
    g.fillStyle(0xffffff, 0.85);
    for (const [dx, dy, r] of [[-40, -14, 7], [-30, 12, 6], [6, -16, 8], [34, 14, 6], [46, -8, 5]]) g.fillCircle(cx + dx, cy + dy, r);
  } else {
    g.fillStyle(accent, 1).fillRoundedRect(x, y, w, h, 6);
  }
}

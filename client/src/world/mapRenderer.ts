// Renders the town: a Phaser tilemap for ground + decor (culled automatically), and
// buildings drawn as flat cartoon roofs with a front facade. Buildings are grouped into
// 1024px chunks whose visibility we toggle against the camera, so phones only draw what's
// on screen.
import Phaser from 'phaser';
import { CANOPY_DECOR, type BuiltBuilding, type BuiltMap } from '@kh/shared';
import { buildTilesetCanvas, DECOR_OFFSET, MARGIN, SPACING, TILE } from './tileset';

interface Style {
  roof: number;
  wall: number;
  storeys: number;
}

const SHOPLOT_ROOFS = [0xe07a5f, 0xf2cc8f, 0x81b29a, 0xe9c46a, 0xf4a261, 0x9bc1bc];
const STYLES: Record<string, Style> = {
  shoplot: { roof: 0xe07a5f, wall: 0xf3e5d3, storeys: 1 },
  office: { roof: 0x7fa7c9, wall: 0xdfe7ef, storeys: 1 },
  tower: { roof: 0x5c6f91, wall: 0xc9d6e8, storeys: 1.4 },
  mall: { roof: 0xf1d5a6, wall: 0xe9dcc9, storeys: 1.2 },
  terrace: { roof: 0xc0583f, wall: 0xf5e6d3, storeys: 0.6 },
  semid: { roof: 0xa44a3f, wall: 0xf0e1cc, storeys: 0.7 },
  bungalow: { roof: 0x7a3e2b, wall: 0xf7ecd9, storeys: 0.8 },
  flat: { roof: 0xc9b18f, wall: 0xe8dcc8, storeys: 1.1 },
  condo: { roof: 0x8fb3c9, wall: 0xe6eef3, storeys: 1.3 },
  hospital: { roof: 0xf1f3f5, wall: 0xdee2e6, storeys: 1.1 },
  station: { roof: 0x6c757d, wall: 0xced4da, storeys: 0.9 },
  casino: { roof: 0x6a1b9a, wall: 0x3c096c, storeys: 1.1 },
  hypermarket: { roof: 0xd62828, wall: 0xf1faee, storeys: 1 },
  bank: { roof: 0x1d3557, wall: 0xe9ecef, storeys: 1 },
  shop: { roof: 0x2a9d8f, wall: 0xe9f5db, storeys: 0.8 },
  clubhouse: { roof: 0x386641, wall: 0xf2e8cf, storeys: 0.8 },
  civic: { roof: 0x577590, wall: 0xe9ecef, storeys: 0.8 },
  furniture: { roof: 0x1d4ed8, wall: 0xfacc15, storeys: 1 },
};

const CHUNK = 32; // tiles per chunk side

export function darken(c: number, f: number) {
  const r = Math.round(((c >> 16) & 255) * f);
  const g = Math.round(((c >> 8) & 255) * f);
  const b = Math.round((c & 255) * f);
  return (r << 16) | (g << 8) | b;
}

export function roofColor(b: BuiltBuilding): number {
  const s = STYLES[b.kind] ?? STYLES.shoplot;
  if (b.kind === 'shoplot') return SHOPLOT_ROOFS[(b.unit + b.x + b.y) % SHOPLOT_ROOFS.length];
  if (b.kind === 'terrace') return b.unit % 2 ? s.roof : darken(s.roof, 0.88);
  return s.roof;
}

function drawBuilding(g: Phaser.GameObjects.Graphics, b: BuiltBuilding) {
  const s = STYLES[b.kind] ?? STYLES.shoplot;
  const x = b.x * TILE;
  const y = b.y * TILE;
  const w = b.w * TILE;
  const h = b.h * TILE;
  const roof = roofColor(b);
  const facade = Math.min(h * 0.4, TILE * s.storeys);

  // drop shadow
  g.fillStyle(0x000000, 0.18).fillRect(x + 6, y + 8, w, h);
  // facade
  g.fillStyle(s.wall, 1).fillRect(x, y + h - facade, w, facade);
  g.fillStyle(darken(s.wall, 0.7), 1).fillRect(x, y + h - 3, w, 3);
  // windows on the facade
  const winH = Math.max(5, facade * 0.32);
  const winY = y + h - facade + facade * 0.22;
  const winColor = b.kind === 'casino' ? 0xffd43b : 0x8ecae6;
  for (let wx = x + 6; wx + 8 < x + w - 4; wx += 14) g.fillStyle(winColor, 0.9).fillRect(wx, winY, 8, winH);
  // roof
  const roofH = h - facade;
  g.fillStyle(roof, 1).fillRect(x, y, w, roofH);
  g.lineStyle(3, darken(roof, 0.7), 1).strokeRect(x + 1.5, y + 1.5, w - 3, roofH - 3);
  g.lineStyle(2, 0xffffff, 0.18).strokeRect(x + 6, y + 6, w - 12, roofH - 12);

  // roof details per kind
  const cx = x + w / 2;
  const cy = y + roofH / 2;
  if (b.kind === 'tower' && w >= 5 * TILE) {
    g.fillStyle(darken(roof, 0.8), 1).fillCircle(cx, cy, Math.min(w, roofH) * 0.28);
    g.lineStyle(3, 0xffd43b, 1).strokeCircle(cx, cy, Math.min(w, roofH) * 0.28);
  } else if (b.kind === 'hospital') {
    g.fillStyle(0xe03131, 1).fillRect(cx - 6, cy - 18, 12, 36).fillRect(cx - 18, cy - 6, 36, 12);
  } else if (b.kind === 'station') {
    g.fillStyle(0x1971c2, 1).fillCircle(cx, cy, 16);
  } else if (b.kind === 'casino') {
    g.lineStyle(4, 0xffd43b, 1).strokeRect(x + 10, y + 10, w - 20, roofH - 20);
  } else if (b.kind === 'furniture') {
    g.fillStyle(0xfacc15, 1).fillRect(x, cy - 10, w, 20);
  } else if (w >= 4 * TILE && roofH >= 3 * TILE) {
    // aircon units
    g.fillStyle(0xadb5bd, 1).fillRect(x + w - 30, y + 12, 16, 12).fillRect(x + 14, y + 12, 12, 10);
  }

  // door marker
  const d = b.door;
  const dx = d.x * TILE;
  const dy = d.y * TILE;
  g.fillStyle(0x5c3d2e, 1);
  if (d.side === 's') g.fillRect(dx + 8, y + h - Math.min(facade, 24), 16, Math.min(facade, 24) - 3);
  else if (d.side === 'n') g.fillRect(dx + 8, y, 16, 6);
  else if (d.side === 'e') g.fillRect(x + w - 6, dy + 8, 6, 16);
  else g.fillRect(x, dy + 8, 6, 16);
}

interface Chunk {
  x: number;
  y: number;
  objects: Phaser.GameObjects.GameObject[];
}

export class MapView {
  private chunks: Chunk[] = [];
  readonly canopy: Phaser.Tilemaps.TilemapLayer;

  constructor(private scene: Phaser.Scene, private map: BuiltMap) {
    if (!scene.textures.exists('tiles')) scene.textures.addCanvas('tiles', buildTilesetCanvas());
    const tm = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: map.width, height: map.height });
    const tileset = tm.addTilesetImage('tiles', 'tiles', TILE, TILE, MARGIN, SPACING)!;
    const ground = tm.createBlankLayer('ground', tileset)!;
    const decor = tm.createBlankLayer('decor', tileset)!;
    this.canopy = tm.createBlankLayer('canopy', tileset)!;
    const g2d: number[][] = [];
    const d2d: number[][] = [];
    const c2d: number[][] = [];
    for (let y = 0; y < map.height; y++) {
      const gr: number[] = [];
      const dr: number[] = [];
      const cr: number[] = [];
      for (let x = 0; x < map.width; x++) {
        const i = y * map.width + x;
        gr.push(map.ground[i]);
        const d = map.decor[i];
        dr.push(d && !CANOPY_DECOR.has(d) ? DECOR_OFFSET + d : -1);
        cr.push(d && CANOPY_DECOR.has(d) ? DECOR_OFFSET + d : -1);
      }
      g2d.push(gr);
      d2d.push(dr);
      c2d.push(cr);
    }
    ground.putTilesAt(g2d, 0, 0);
    decor.putTilesAt(d2d, 0, 0);
    this.canopy.putTilesAt(c2d, 0, 0);
    ground.setDepth(-1000);
    decor.setDepth(-999);
    // Tree canopies render above characters so you can walk "under" trees.
    this.canopy.setDepth(1_000_000).setAlpha(0.92);

    // --- buildings, grouped into chunks ---
    const byChunk = new Map<string, BuiltBuilding[]>();
    for (const b of map.buildings) {
      const key = `${Math.floor(b.x / CHUNK)},${Math.floor(b.y / CHUNK)}`;
      const list = byChunk.get(key) ?? [];
      list.push(b);
      byChunk.set(key, list);
    }
    for (const [key, list] of byChunk) {
      const [cx, cy] = key.split(',').map(Number);
      const g = scene.add.graphics().setDepth(-998);
      const objects: Phaser.GameObjects.GameObject[] = [g];
      for (const b of list) {
        drawBuilding(g, b);
        if (b.name && (b.unit === 0 || !/-\d+$/.test(b.id))) {
          const fontPx = Math.max(12, Math.min(22, b.w * 2.2));
          const t = scene.add
            .text((b.x + b.w / 2) * TILE, (b.y + (b.h - Math.min(b.h * 0.4, 1)) / 2) * TILE, b.name, {
              fontFamily: 'system-ui, sans-serif',
              fontSize: `${fontPx}px`,
              fontStyle: 'bold',
              color: '#ffffff',
              stroke: '#1d2133',
              strokeThickness: 4,
              align: 'center',
              wordWrap: { width: Math.max(80, b.w * TILE - 8) },
              resolution: 2,
            })
            .setOrigin(0.5)
            .setDepth(-990);
          objects.push(t);
        }
      }
      this.chunks.push({ x: cx * CHUNK * TILE, y: cy * CHUNK * TILE, objects });
    }

    // Area names (parks, plazas, the padang...)
    for (const a of map.layout.areas) {
      if (!a.name) continue;
      const [x, y, w, h] = a.rect;
      const t = scene.add
        .text((x + w / 2) * TILE, (y + h / 2) * TILE, a.name, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '16px',
          fontStyle: 'italic bold',
          color: '#ffffff',
          stroke: '#2b5b2e',
          strokeThickness: 4,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setAlpha(0.85)
        .setDepth(-995);
      this.chunks.push({ x: Math.floor((x + w / 2) / CHUNK) * CHUNK * TILE, y: Math.floor((y + h / 2) / CHUNK) * CHUNK * TILE, objects: [t] });
    }
  }

  /** Show only chunks near the camera. */
  cull(view: Phaser.Geom.Rectangle) {
    const pad = 24 * TILE; // big buildings can extend past their chunk
    const size = CHUNK * TILE;
    for (const c of this.chunks) {
      const visible = c.x < view.right + pad && c.x + size > view.x - pad && c.y < view.bottom + pad && c.y + size > view.y - pad;
      for (const o of c.objects) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(visible);
    }
  }
}

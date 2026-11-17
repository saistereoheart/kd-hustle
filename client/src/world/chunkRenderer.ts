// Renders the real-scale map as vector art (Canvas 2D: anti-aliased roads, lane markings,
// polygon buildings) into 512 px chunk textures. Chunks are drawn on demand near the camera
// and evicted when far away, so memory stays bounded on phones even though the whole map is
// 24,576 × 18,432 px. Tree canopies go into a second transparent chunk layer that renders
// ABOVE characters (you walk "under" trees).
//
// Drawing happens in TILE units: the canvas transform maps 1 unit → 1 tile.
import Phaser from 'phaser';
import { CANOPY_DECOR, Decor, pointInPoly, Tile, tileHash, type Box, type BuiltBuilding, type BuiltMap, type BuiltRoad } from '@kh/shared';
import { buildDecorSprites, DECOR_SPRITE } from './tileset';

const CHUNK = 16; // tiles per chunk side (512 px)
/** Each chunk texture extends this many tiles past its edges so neighbours overlap (no seams). */
const BLEED = 0.25;

type Ctx = CanvasRenderingContext2D;

const COLORS = {
  grass: '#7cc456',
  park: '#86cf5d',
  forest: '#4f9a3e',
  field: '#9bd36a',
  golf: '#8fdc6a',
  parking: '#9097a1',
  plaza: '#e9d9b6',
  construction: '#c8a878',
  water: '#4aa3df',
  sidewalk: '#d6cfc0',
  kerb: '#a19c90',
  path: '#dccaa0',
  highway: '#3a3d45',
  arterial: '#484c55',
  street: '#4f535d',
  service: '#5c606a',
  marking: 'rgba(255,255,255,0.85)',
  yellow: '#f2c94c',
};

interface RoofStyle {
  roof: string;
  wall: string;
  levels: number;
}
const ROOF: Record<string, RoofStyle> = {
  shoplot: { roof: '#e07a5f', wall: '#f3e5d3', levels: 3 },
  office: { roof: '#7fa7c9', wall: '#dfe7ef', levels: 5 },
  tower: { roof: '#5c6f91', wall: '#c9d6e8', levels: 20 },
  mall: { roof: '#e8cfa0', wall: '#e9dcc9', levels: 4 },
  terrace: { roof: '#c0583f', wall: '#f5e6d3', levels: 2 },
  semid: { roof: '#a44a3f', wall: '#f0e1cc', levels: 2 },
  bungalow: { roof: '#7a3e2b', wall: '#f7ecd9', levels: 2 },
  flat: { roof: '#c9b18f', wall: '#e8dcc8', levels: 5 },
  condo: { roof: '#8fb3c9', wall: '#e6eef3', levels: 15 },
  hospital: { roof: '#f1f3f5', wall: '#dee2e6', levels: 8 },
  station: { roof: '#868e96', wall: '#ced4da', levels: 2 },
  casino: { roof: '#6a1b9a', wall: '#3c096c', levels: 5 },
  hypermarket: { roof: '#d62828', wall: '#f1faee', levels: 3 },
  bank: { roof: '#1d3557', wall: '#e9ecef', levels: 3 },
  shop: { roof: '#2a9d8f', wall: '#e9f5db', levels: 2 },
  clubhouse: { roof: '#386641', wall: '#f2e8cf', levels: 2 },
  civic: { roof: '#577590', wall: '#e9ecef', levels: 3 },
  furniture: { roof: '#1d4ed8', wall: '#facc15', levels: 3 },
  school: { roof: '#b5838d', wall: '#f1e3d3', levels: 3 },
  parking: { roof: '#adb5bd', wall: '#dee2e6', levels: 5 },
  construction: { roof: '#d4a373', wall: '#e9c46a', levels: 2 },
  roof: { roof: 'rgba(206,212,218,0.55)', wall: 'rgba(0,0,0,0)', levels: 0 },
  religious: { roof: '#2b9348', wall: '#f8f9fa', levels: 2 },
};
const SHOPLOT_ROOFS = ['#e07a5f', '#f2cc8f', '#81b29a', '#e9c46a', '#f4a261', '#9bc1bc', '#d4a5a5', '#b5c99a'];

export function roofColorOf(b: BuiltBuilding): string {
  if (b.kind === 'shoplot' || b.kind === 'flat') {
    const h = Math.floor(tileHash(Math.round(b.bbox.x0), Math.round(b.bbox.y0), 7) * SHOPLOT_ROOFS.length);
    return b.kind === 'shoplot' ? SHOPLOT_ROOFS[h] : ROOF.flat.roof;
  }
  return (ROOF[b.kind] ?? ROOF.shoplot).roof;
}

// ------------------------------------------------------------------ geometry helpers
function tracePoly(ctx: Ctx, p: number[]) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.closePath();
}
function traceLine(ctx: Ctx, p: number[]) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
}
/** Parallel polyline at distance d (left of travel direction for d < 0). */
function offsetLine(p: number[], d: number): number[] {
  const out: number[] = [];
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const px = p[i * 2], py = p[i * 2 + 1];
    let nx = 0, ny = 0;
    if (i > 0) {
      const dx = px - p[i * 2 - 2], dy = py - p[i * 2 - 1];
      const l = Math.hypot(dx, dy) || 1;
      nx += -dy / l;
      ny += dx / l;
    }
    if (i < n - 1) {
      const dx = p[i * 2 + 2] - px, dy = p[i * 2 + 3] - py;
      const l = Math.hypot(dx, dy) || 1;
      nx += -dy / l;
      ny += dx / l;
    }
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    // miter correction, clamped so sharp bends don't explode
    let k = 1;
    if (i > 0 && i < n - 1) {
      const dx = p[i * 2 + 2] - p[i * 2 - 2], dy = p[i * 2 + 3] - p[i * 2 - 1];
      const l2 = Math.hypot(dx, dy) || 1;
      const cos = Math.abs((-dy / l2) * nx + (dx / l2) * ny);
      k = Math.min(2, 1 / Math.max(0.5, cos));
    }
    out.push(px + nx * d * k, py + ny * d * k);
  }
  return out;
}
/** Removes `trim` tiles from both ends of a polyline (keeps markings out of junctions). */
function trimLine(p: number[], trim: number): number[] | null {
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const l = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    segs.push(l);
    total += l;
  }
  if (total <= trim * 2 + 1) return null;
  const at = (dist: number): [number, number, number] => {
    let acc = 0;
    for (let s = 0; s < segs.length; s++) {
      if (acc + segs[s] >= dist) {
        const t = (dist - acc) / (segs[s] || 1);
        return [p[s * 2] + (p[s * 2 + 2] - p[s * 2]) * t, p[s * 2 + 1] + (p[s * 2 + 3] - p[s * 2 + 1]) * t, s];
      }
      acc += segs[s];
    }
    return [p[p.length - 2], p[p.length - 1], segs.length - 1];
  };
  const [sx, sy, ss] = at(trim);
  const [ex, ey, es] = at(total - trim);
  const out = [sx, sy];
  for (let s = ss + 1; s <= es; s++) out.push(p[s * 2], p[s * 2 + 1]);
  out.push(ex, ey);
  return out;
}
function polyCentroid(p: number[]): [number, number] {
  let x = 0, y = 0;
  for (let i = 0; i < p.length; i += 2) {
    x += p[i];
    y += p[i + 1];
  }
  return [x / (p.length / 2), y / (p.length / 2)];
}
function polyArea(p: number[]) {
  let a = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += (p[j] + p[i]) * (p[j + 1] - p[i + 1]);
  return Math.abs(a / 2);
}
function shade(color: string, f: number): string {
  if (!color.startsWith('#')) return color;
  const n = parseInt(color.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// ------------------------------------------------------------------ spatial index
interface Bucket {
  areas: number[];
  roads: number[];
  paths: number[];
  waters: number[];
  rails: number[];
  buildings: number[];
  crossings: number[];
  labels: number[];
}
interface RoadLabel {
  text: string;
  x: number;
  y: number;
  angle: number;
  size: number;
  italic?: boolean;
}

interface LiveChunk {
  ground: Phaser.GameObjects.Image;
  canopy: Phaser.GameObjects.Image | null;
  keys: string[];
  lastUsed: number;
}

export class ChunkRenderer {
  private buckets = new Map<string, Bucket>();
  private labels: RoadLabel[] = [];
  private live = new Map<string, LiveChunk>();
  private decorSprites = buildDecorSprites();
  private res: number;
  private maxChunks: number;
  private counter = 0;

  constructor(private scene: Phaser.Scene, private map: BuiltMap, resolution: number) {
    this.res = resolution;
    const bytesPerChunk = (CHUNK * map.tileSize * resolution) ** 2 * 4 * 1.5; // + canopy layers
    this.maxChunks = Math.max(16, Math.floor((72 * 1024 * 1024) / bytesPerChunk));
    this.buildIndex();
  }

  private bucket(cx: number, cy: number): Bucket {
    const k = `${cx},${cy}`;
    let b = this.buckets.get(k);
    if (!b) {
      b = { areas: [], roads: [], paths: [], waters: [], rails: [], buildings: [], crossings: [], labels: [] };
      this.buckets.set(k, b);
    }
    return b;
  }
  private addToBuckets(box: Box, list: keyof Bucket, i: number) {
    for (let cy = Math.floor(box.y0 / CHUNK); cy <= Math.floor(box.y1 / CHUNK); cy++)
      for (let cx = Math.floor(box.x0 / CHUNK); cx <= Math.floor(box.x1 / CHUNK); cx++) this.bucket(cx, cy)[list].push(i);
  }

  private buildIndex() {
    const m = this.map;
    m.areas.forEach((a, i) => this.addToBuckets(a.bbox, 'areas', i));
    m.roads.forEach((r, i) => this.addToBuckets({ x0: r.bbox.x0 - 6, y0: r.bbox.y0 - 6, x1: r.bbox.x1 + 6, y1: r.bbox.y1 + 6 }, 'roads', i));
    m.paths.forEach((p, i) => this.addToBuckets(p.bbox, 'paths', i));
    m.waterways.forEach((w, i) => this.addToBuckets(w.bbox, 'waters', i));
    m.rails.forEach((r, i) => this.addToBuckets({ x0: r.bbox.x0 - 6, y0: r.bbox.y0 - 6, x1: r.bbox.x1 + 6, y1: r.bbox.y1 + 6 }, 'rails', i));
    m.buildings.forEach((b, i) => this.addToBuckets({ x0: b.bbox.x0, y0: b.bbox.y0, x1: b.bbox.x1 + 3, y1: b.bbox.y1 + 3 }, 'buildings', i));
    m.crossings.forEach((c, i) => this.addToBuckets({ x0: c.x - 6, y0: c.y - 6, x1: c.x + 6, y1: c.y + 6 }, 'crossings', i));

    // Street name labels: one per long named road, placed on its longest segment.
    const seen = new Map<string, number>();
    for (const r of m.roads) {
      if (!r.name || r.elevated) continue;
      let best = -1, bestLen = 0;
      for (let s = 0; s + 3 < r.pts.length; s += 2) {
        const l = Math.hypot(r.pts[s + 2] - r.pts[s], r.pts[s + 3] - r.pts[s + 1]);
        if (l > bestLen) {
          bestLen = l;
          best = s;
        }
      }
      if (bestLen < 14) continue;
      const x = (r.pts[best] + r.pts[best + 2]) / 2;
      const y = (r.pts[best + 1] + r.pts[best + 3]) / 2;
      // Don't repeat the same street name within 60 tiles.
      const prev = seen.get(r.name);
      if (prev !== undefined) {
        const pl = this.labels[prev];
        if (Math.hypot(pl.x - x, pl.y - y) < 60) continue;
      }
      let angle = Math.atan2(r.pts[best + 3] - r.pts[best + 1], r.pts[best + 2] - r.pts[best]);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      seen.set(r.name, this.labels.length);
      this.labels.push({ text: r.name, x, y, angle, size: Math.min(1.3, Math.max(0.8, r.width * 0.32)) });
    }
    for (const a of m.areas) {
      if (!a.name) continue;
      const [x, y] = polyCentroid(a.poly);
      this.labels.push({ text: a.name, x, y, angle: 0, size: 1.4, italic: true });
    }
    this.labels.forEach((l, i) => {
      const half = l.text.length * l.size * 0.35 + 1;
      this.addToBuckets({ x0: l.x - half, y0: l.y - half, x1: l.x + half, y1: l.y + half }, 'labels', i);
    });
  }

  /** Ensure chunks around the camera exist; evict far ones. Call every frame. */
  update(view: Phaser.Geom.Rectangle, budgetMs = 8, force = false) {
    const T = this.map.tileSize;
    const S = CHUNK * T;
    const pad = S * 0.5;
    const cx0 = Math.floor((view.x - pad) / S), cx1 = Math.floor((view.right + pad) / S);
    const cy0 = Math.floor((view.y - pad) / S), cy1 = Math.floor((view.bottom + pad) / S);
    const minCx = Math.floor(this.map.originTx / CHUNK), maxCx = Math.floor((this.map.originTx + this.map.width - 1) / CHUNK);
    const minCy = Math.floor(this.map.originTy / CHUNK), maxCy = Math.floor((this.map.originTy + this.map.height - 1) / CHUNK);
    const midX = (view.x + view.right) / 2, midY = (view.y + view.bottom) / 2;
    const need: Array<[number, number, number]> = [];
    const now = ++this.counter;
    for (let cy = Math.max(cy0, minCy); cy <= Math.min(cy1, maxCy); cy++)
      for (let cx = Math.max(cx0, minCx); cx <= Math.min(cx1, maxCx); cx++) {
        const live = this.live.get(`${cx},${cy}`);
        if (live) live.lastUsed = now;
        else need.push([cx, cy, Math.hypot((cx + 0.5) * S - midX, (cy + 0.5) * S - midY)]);
      }
    need.sort((a, b) => a[2] - b[2]);
    const start = performance.now();
    for (const [cx, cy] of need) {
      this.createChunk(cx, cy, now);
      if (!force && performance.now() - start > budgetMs) break;
    }
    if (this.live.size > this.maxChunks) {
      const old = [...this.live.entries()].filter(([, c]) => c.lastUsed !== now).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [k, c] of old.slice(0, this.live.size - this.maxChunks)) this.destroyChunk(k, c);
    }
  }

  get chunkCount() {
    return this.live.size;
  }

  private destroyChunk(key: string, c: LiveChunk) {
    c.ground.destroy();
    c.canopy?.destroy();
    for (const k of c.keys) this.scene.textures.remove(k);
    this.live.delete(key);
  }

  destroy() {
    for (const [k, c] of this.live) this.destroyChunk(k, c);
  }

  private createChunk(cx: number, cy: number, now: number) {
    const T = this.map.tileSize;
    const px = Math.ceil((CHUNK + BLEED * 2) * T * this.res);
    const keyBase = `chunk_${cx}_${cy}_${Math.random().toString(36).slice(2, 7)}`;
    const ground = document.createElement('canvas');
    ground.width = ground.height = px;
    const gctx = ground.getContext('2d')!;
    const canopyCanvas = document.createElement('canvas');
    canopyCanvas.width = canopyCanvas.height = px;
    const cctx = canopyCanvas.getContext('2d')!;
    const scale = T * this.res;
    for (const ctx of [gctx, cctx]) ctx.setTransform(scale, 0, 0, scale, -(cx * CHUNK - BLEED) * scale, -(cy * CHUNK - BLEED) * scale);
    const hasCanopy = this.drawChunk(gctx, cctx, cx, cy);

    const keys = [`${keyBase}_g`];
    this.scene.textures.addCanvas(keys[0], ground);
    const img = this.scene.add.image((cx * CHUNK - BLEED) * T, (cy * CHUNK - BLEED) * T, keys[0]).setOrigin(0).setScale(1 / this.res).setDepth(-1000);
    let canopy: Phaser.GameObjects.Image | null = null;
    if (hasCanopy) {
      keys.push(`${keyBase}_c`);
      this.scene.textures.addCanvas(keys[1], canopyCanvas);
      canopy = this.scene.add.image((cx * CHUNK - BLEED) * T, (cy * CHUNK - BLEED) * T, keys[1]).setOrigin(0).setScale(1 / this.res).setDepth(1_000_000).setAlpha(0.72);
    }
    this.live.set(`${cx},${cy}`, { ground: img, canopy, keys, lastUsed: now });
  }

  // ---------------------------------------------------------------- drawing
  private drawChunk(g: Ctx, c: Ctx, cx: number, cy: number): boolean {
    const m = this.map;
    const b = this.buckets.get(`${cx},${cy}`);
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // 1. grass with soft blotches
    g.fillStyle = COLORS.grass;
    g.fillRect(x0 - BLEED, y0 - BLEED, CHUNK + BLEED * 2, CHUNK + BLEED * 2);
    for (let i = 0; i < 18; i++) {
      const h1 = tileHash(cx * 31 + i, cy * 17 + i, 3), h2 = tileHash(cx * 13 + i, cy * 29 + i, 5);
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,60,0,0.06)';
      g.beginPath();
      g.ellipse(x0 + h1 * CHUNK, y0 + h2 * CHUNK, 0.8 + h1 * 1.8, 0.5 + h2 * 1.2, h1 * 3, 0, Math.PI * 2);
      g.fill();
    }
    if (!b) {
      this.drawDecor(g, c, x0, y0);
      return this.drawCanopy(c, x0, y0);
    }

    // 2. areas
    for (const i of b.areas) {
      const a = m.areas[i];
      tracePoly(g, a.poly);
      g.fillStyle = COLORS[a.kind as keyof typeof COLORS] ?? COLORS.park;
      g.fill();
      if (a.kind === 'water') {
        g.strokeStyle = '#3d8fc6';
        g.lineWidth = 0.25;
        g.stroke();
      } else if (a.kind === 'field' || a.kind === 'golf') {
        g.save();
        g.clip();
        g.fillStyle = 'rgba(255,255,255,0.08)';
        for (let x = x0 - (x0 % 4); x < x0 + CHUNK; x += 4) g.fillRect(x, y0, 2, CHUNK);
        g.restore();
      } else if (a.kind === 'parking') {
        g.save();
        g.clip();
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        g.lineWidth = 0.08;
        for (let x = x0 - (x0 % 1.3); x < x0 + CHUNK; x += 1.3) {
          for (let y = y0 - (y0 % 6); y < y0 + CHUNK; y += 6) {
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x, y + 2.4);
            g.stroke();
          }
        }
        g.restore();
      } else if (a.kind === 'plaza') {
        g.save();
        g.clip();
        g.strokeStyle = 'rgba(160,130,90,0.25)';
        g.lineWidth = 0.05;
        for (let x = Math.floor(x0); x < x0 + CHUNK; x++) {
          g.beginPath();
          g.moveTo(x, y0);
          g.lineTo(x, y0 + CHUNK);
          g.stroke();
        }
        for (let y = Math.floor(y0); y < y0 + CHUNK; y++) {
          g.beginPath();
          g.moveTo(x0, y);
          g.lineTo(x0 + CHUNK, y);
          g.stroke();
        }
        g.restore();
      }
    }

    // 3. waterways
    for (const i of b.waters) {
      const w = m.waterways[i];
      traceLine(g, w.pts);
      g.strokeStyle = COLORS.water;
      g.lineWidth = w.width;
      g.stroke();
    }

    // 4. footpaths (ground)
    for (const i of b.paths) {
      const p = m.paths[i];
      if (p.bridge) continue;
      traceLine(g, p.pts);
      g.strokeStyle = shade(COLORS.path, -0.15);
      g.lineWidth = p.width + 0.2;
      g.stroke();
      g.strokeStyle = COLORS.path;
      g.lineWidth = p.width;
      g.stroke();
    }

    // 5. roads — pass by pass so junctions merge cleanly
    const roads = b.roads.map((i) => m.roads[i]).filter((r) => !r.elevated);
    const order = { service: 0, street: 1, arterial: 2, highway: 3 } as const;
    roads.sort((r1, r2) => order[r1.cls] - order[r2.cls]);
    this.drawRoads(g, roads);
    for (const i of b.crossings) this.drawCrossing(g, m.crossings[i]);

    // 6. parked cars on parking tiles
    this.drawParkedCars(g, x0, y0);

    // 7. buildings (shadows first, then bodies)
    const blds = b.buildings.map((i) => m.buildings[i]);
    for (const bl of blds) this.drawBuildingShadow(g, bl);
    for (const bl of blds) this.drawBuilding(g, bl);

    // 8. small decor (lamps, benches, flowers, fountain, jobs board...)
    this.drawDecor(g, c, x0, y0);

    // 9. elevated: flyovers, the DASH viaduct, MRT viaduct, footbridges
    const elevated = b.roads.map((i) => m.roads[i]).filter((r) => r.elevated);
    if (elevated.length) {
      for (const r of elevated) {
        g.save();
        g.translate(0.6, 0.9);
        traceLine(g, r.pts);
        g.strokeStyle = 'rgba(0,0,0,0.22)';
        g.lineWidth = r.width + 0.6;
        g.stroke();
        g.restore();
      }
      this.drawRoads(g, elevated, true);
    }
    for (const i of b.rails) {
      const r = m.rails[i];
      g.save();
      g.translate(0.6, 0.9);
      traceLine(g, r.pts);
      g.strokeStyle = 'rgba(0,0,0,0.2)';
      g.lineWidth = 3.4;
      g.stroke();
      g.restore();
      traceLine(g, r.pts);
      g.strokeStyle = '#b8bec6';
      g.lineWidth = 3.2;
      g.stroke();
      for (const d of [-0.7, 0.7]) {
        traceLine(g, offsetLine(r.pts, d));
        g.strokeStyle = '#6c727b';
        g.lineWidth = 0.18;
        g.stroke();
      }
    }
    for (const i of b.paths) {
      const p = m.paths[i];
      if (!p.bridge) continue;
      traceLine(g, p.pts);
      g.strokeStyle = '#8d939c';
      g.lineWidth = p.width + 0.6;
      g.stroke();
      g.strokeStyle = '#d9d4ca';
      g.lineWidth = p.width;
      g.stroke();
    }

    // 10. labels (street + area names)
    for (const i of b.labels) this.drawLabel(g, this.labels[i]);

    return this.drawCanopy(c, x0, y0);
  }

  private drawRoads(g: Ctx, roads: BuiltRoad[], elevated = false) {
    // sidewalks
    for (const r of roads) {
      if (r.sidewalk <= 0) continue;
      traceLine(g, r.pts);
      g.strokeStyle = COLORS.sidewalk;
      g.lineWidth = r.width + r.sidewalk * 2;
      g.stroke();
    }
    // kerbs / barriers
    for (const r of roads) {
      traceLine(g, r.pts);
      g.strokeStyle = r.cls === 'highway' || elevated ? '#c3c7cc' : COLORS.kerb;
      g.lineWidth = r.width + (r.cls === 'highway' || elevated ? 0.5 : 0.25);
      g.stroke();
    }
    // asphalt
    for (const r of roads) {
      traceLine(g, r.pts);
      g.strokeStyle = COLORS[r.cls];
      g.lineWidth = r.width;
      g.stroke();
    }
    // markings
    const laneW = r0LaneWidth(roads[0]);
    for (const r of roads) {
      if (r.cls === 'service' && r.lanes < 2) continue;
      const p = trimLine(r.pts, r.width * 0.9);
      if (!p) continue;
      const lw = (r.width - (r.cls === 'highway' ? 0.5 : 0)) / r.lanes || laneW;
      const half = (lw * r.lanes) / 2;
      g.lineCap = 'butt';
      for (let k = 1; k < r.lanes; k++) {
        const off = -half + k * lw;
        const center = !r.oneway && Math.abs(off) < 0.01;
        traceLine(g, offsetLine(p, off));
        if (center) {
          g.setLineDash([]);
          g.strokeStyle = r.cls === 'street' ? COLORS.marking : COLORS.yellow;
          g.lineWidth = 0.1;
        } else {
          g.setLineDash([1.5, 1.5]);
          g.strokeStyle = COLORS.marking;
          g.lineWidth = 0.09;
        }
        g.stroke();
      }
      g.setLineDash([]);
      if (r.cls === 'highway' || r.cls === 'arterial') {
        for (const s of [-1, 1]) {
          traceLine(g, offsetLine(p, s * (half - 0.15)));
          g.strokeStyle = 'rgba(255,255,255,0.6)';
          g.lineWidth = 0.08;
          g.stroke();
        }
      }
      g.lineCap = 'round';
    }
  }

  private drawCrossing(g: Ctx, c: { x: number; y: number; angle: number; width: number }) {
    g.save();
    g.translate(c.x, c.y);
    g.rotate(c.angle);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let p = -c.width / 2 + 0.2; p < c.width / 2 - 0.2; p += 0.7) g.fillRect(-0.9, p, 1.8, 0.38);
    g.restore();
  }

  private drawParkedCars(g: Ctx, x0: number, y0: number) {
    const m = this.map;
    const colors = ['#e03131', '#1c7ed6', '#f1f3f5', '#343a40', '#f59f00', '#adb5bd', '#2f9e44'];
    for (let ty = y0; ty < y0 + CHUNK; ty++) {
      if (ty % 6 !== 0) continue;
      for (let tx = x0; tx < x0 + CHUNK; tx++) {
        const gx = tx - m.originTx, gy = ty - m.originTy;
        if (gx < 0 || gy < 0 || gx >= m.width || gy + 2 >= m.height) continue;
        if (m.terrain[gy * m.width + gx] !== Tile.Parking || m.terrain[(gy + 2) * m.width + gx] !== Tile.Parking) continue;
        const h = tileHash(tx, ty, 11);
        if (h > 0.55) continue;
        const col = colors[Math.floor(h * 100) % colors.length];
        const cxp = tx + 0.15, cyp = ty + 0.1;
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath();
        g.roundRect(cxp + 0.08, cyp + 0.12, 0.95, 2.25, 0.3);
        g.fill();
        g.fillStyle = col;
        g.beginPath();
        g.roundRect(cxp, cyp, 0.95, 2.25, 0.3);
        g.fill();
        g.fillStyle = 'rgba(30,40,60,0.75)';
        g.fillRect(cxp + 0.12, cyp + 0.45, 0.71, 0.45);
        g.fillRect(cxp + 0.12, cyp + 1.5, 0.71, 0.32);
      }
    }
  }

  private heightOf(b: BuiltBuilding) {
    const lv = b.levels ?? (ROOF[b.kind] ?? ROOF.shoplot).levels;
    return Math.min(6, 0.35 + lv * 0.22);
  }

  private drawBuildingShadow(g: Ctx, b: BuiltBuilding) {
    if (b.kind === 'roof') return;
    const h = this.heightOf(b);
    g.save();
    g.translate(h * 0.55, h * 0.8);
    tracePoly(g, b.poly);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fill();
    g.restore();
  }

  private drawBuilding(g: Ctx, b: BuiltBuilding) {
    const style = ROOF[b.kind] ?? ROOF.shoplot;
    const roof = roofColorOf(b);
    const p = b.poly;
    tracePoly(g, p);
    g.fillStyle = roof;
    g.fill();
    if (b.kind === 'roof') {
      g.strokeStyle = 'rgba(120,120,120,0.6)';
      g.lineWidth = 0.12;
      g.stroke();
      return;
    }
    // South-facing walls: a facade band with windows gives a hint of height.
    const facade = Math.min(1.6, 0.5 + this.heightOf(b) * 0.25);
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length;
      const ax = p[i], ay = p[i + 1], bx = p[j], by = p[j + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.8) continue;
      // outward normal
      let nx = (by - ay) / len, ny = -(bx - ax) / len;
      if (pointInPoly((ax + bx) / 2 + nx * 0.05, (ay + by) / 2 + ny * 0.05, p)) {
        nx = -nx;
        ny = -ny;
      }
      if (ny < 0.4) continue;
      const f = Math.min(facade, len * 0.5);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.lineTo(bx - nx * f, by - ny * f);
      g.lineTo(ax - nx * f, ay - ny * f);
      g.closePath();
      g.fillStyle = style.wall;
      g.fill();
      // windows
      g.fillStyle = b.kind === 'casino' ? '#ffd43b' : 'rgba(80,140,190,0.75)';
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      for (let d = 0.5; d < len - 0.5; d += 1.1) {
        const wx = ax + ux * d - nx * f * 0.7, wy = ay + uy * d - ny * f * 0.7;
        g.beginPath();
        g.moveTo(wx, wy);
        g.lineTo(wx + ux * 0.55, wy + uy * 0.55);
        g.lineTo(wx + ux * 0.55 + nx * f * 0.4, wy + uy * 0.55 + ny * f * 0.4);
        g.lineTo(wx + nx * f * 0.4, wy + ny * f * 0.4);
        g.closePath();
        g.fill();
      }
    }
    tracePoly(g, p);
    g.strokeStyle = shade(roof, -0.3);
    g.lineWidth = 0.14;
    g.stroke();

    // roof details
    const area = polyArea(p);
    const [mx, my] = polyCentroid(p);
    if (b.kind === 'hospital') {
      g.fillStyle = '#e03131';
      g.fillRect(mx - 0.5, my - 1.6, 1, 3.2);
      g.fillRect(mx - 1.6, my - 0.5, 3.2, 1);
    } else if (b.kind === 'tower' && area > 60) {
      g.strokeStyle = '#ffd43b';
      g.lineWidth = 0.25;
      g.beginPath();
      g.arc(mx, my, 2.2, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#ffd43b';
      g.font = 'bold 2.4px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('H', mx, my + 0.1);
    } else if (b.kind === 'casino') {
      tracePoly(g, p);
      g.strokeStyle = '#ffd43b';
      g.lineWidth = 0.35;
      g.stroke();
    } else if (area > 150 && b.kind !== 'parking') {
      // parapet band + rooftop plant (AC units, skylights) spread over big roofs
      g.save();
      tracePoly(g, p);
      g.clip();
      tracePoly(g, p);
      g.strokeStyle = shade(roof, 0.25);
      g.lineWidth = 0.9;
      g.stroke();
      for (let ty = Math.ceil(b.bbox.y0 / 5) * 5; ty < b.bbox.y1; ty += 5) {
        for (let tx = Math.ceil(b.bbox.x0 / 5) * 5; tx < b.bbox.x1; tx += 5) {
          const hh = tileHash(tx, ty, 13);
          if (hh > 0.55 || !pointInPoly(tx + 1, ty + 1, p)) continue;
          if (hh < 0.2) {
            g.fillStyle = 'rgba(170,215,240,0.8)';
            g.fillRect(tx, ty, 2.2, 1.4);
          } else {
            g.fillStyle = 'rgba(205,210,215,0.95)';
            g.fillRect(tx, ty, 1.1, 0.9);
            g.fillStyle = 'rgba(120,125,130,0.9)';
            g.beginPath();
            g.arc(tx + 0.55, ty + 0.45, 0.28, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      g.restore();
    } else if (area > 40 && b.kind !== 'parking') {
      const h = tileHash(Math.round(mx), Math.round(my), 9);
      g.fillStyle = 'rgba(200,205,210,0.9)';
      g.fillRect(mx - 1.5 + h, my - 0.8, 1, 0.8);
      g.fillRect(mx + 0.5 - h, my + 0.4, 0.8, 0.7);
    }
    if (b.kind === 'parking') {
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 0.08;
      tracePoly(g, p);
      g.save();
      g.clip();
      for (let x = Math.floor(b.bbox.x0); x < b.bbox.x1; x += 1.3) {
        g.beginPath();
        g.moveTo(x, b.bbox.y0);
        g.lineTo(x, b.bbox.y1);
        g.stroke();
      }
      g.restore();
    }
    // door
    if (b.door) {
      g.fillStyle = '#6b4a35';
      g.strokeStyle = '#3d2a1e';
      g.lineWidth = 0.08;
      g.beginPath();
      g.roundRect(b.door.x - 0.4, b.door.y - 0.4, 0.8, 0.8, 0.15);
      g.fill();
      g.stroke();
    }
  }

  private drawDecor(g: Ctx, _c: Ctx, x0: number, y0: number) {
    const m = this.map;
    for (let ty = y0; ty < y0 + CHUNK; ty++) {
      for (let tx = x0; tx < x0 + CHUNK; tx++) {
        const gx = tx - m.originTx, gy = ty - m.originTy;
        if (gx < 0 || gy < 0 || gx >= m.width || gy >= m.height) continue;
        const d = m.decor[gy * m.width + gx];
        if (!d || CANOPY_DECOR.has(d)) continue;
        const spr = DECOR_SPRITE[d];
        if (spr === undefined) continue;
        const size = d === Decor.Fountain ? 4 : d === Decor.Stall ? 3 : d === Decor.JobsBoard || d === Decor.BusStop ? 2 : 1;
        g.drawImage(this.decorSprites, spr * 64, 0, 64, 64, tx + 0.5 - size / 2, ty + 0.5 - size / 2, size, size);
      }
    }
  }

  /** Tree canopies (drawn into the layer above characters). Trees near the edge of the
   *  chunk are drawn too so canopies continue seamlessly across chunk borders. */
  private drawCanopy(c: Ctx, x0: number, y0: number): boolean {
    const m = this.map;
    let any = false;
    for (let ty = y0 - 3; ty < y0 + CHUNK + 3; ty++) {
      for (let tx = x0 - 3; tx < x0 + CHUNK + 3; tx++) {
        const gx = tx - m.originTx, gy = ty - m.originTy;
        if (gx < 0 || gy < 0 || gx >= m.width || gy >= m.height) continue;
        const d = m.decor[gy * m.width + gx];
        if (!CANOPY_DECOR.has(d)) continue;
        any = true;
        const h = tileHash(tx, ty, 21);
        const x = tx + 0.5, y = ty + 0.5;
        if (d === Decor.Palm) {
          c.strokeStyle = '#2f8f3c';
          c.lineWidth = 0.35;
          c.lineCap = 'round';
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * Math.PI * 2 + h;
            c.beginPath();
            c.moveTo(x, y - 1);
            c.quadraticCurveTo(x + Math.cos(a) * 1, y - 1 + Math.sin(a) * 0.6 - 0.6, x + Math.cos(a) * 1.9, y - 1 + Math.sin(a) * 1.4);
            c.stroke();
          }
          c.fillStyle = '#8a6a3c';
          c.beginPath();
          c.arc(x, y - 1, 0.25, 0, Math.PI * 2);
          c.fill();
        } else {
          const r = 1.3 + h * 0.8;
          const base = d === Decor.Pine ? '#245e2a' : h < 0.5 ? '#2f7d35' : '#3a8c3a';
          c.fillStyle = 'rgba(0,0,0,0.12)';
          c.beginPath();
          c.arc(x + 0.4, y + 0.3, r, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = base;
          c.beginPath();
          c.arc(x, y - 0.6, r, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = shade(base.startsWith('#') ? base : '#2f7d35', 0.18);
          c.beginPath();
          c.arc(x - r * 0.25, y - 0.6 - r * 0.3, r * 0.55, 0, Math.PI * 2);
          c.arc(x + r * 0.3, y - 0.6 - r * 0.05, r * 0.4, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
    return any;
  }

  private drawLabel(g: Ctx, l: RoadLabel) {
    g.save();
    g.translate(l.x, l.y);
    g.rotate(l.angle);
    g.font = `${l.italic ? 'italic ' : ''}700 ${l.size}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.strokeStyle = l.italic ? 'rgba(30,70,30,0.85)' : 'rgba(25,28,40,0.85)';
    g.lineWidth = l.size * 0.28;
    g.strokeText(l.text, 0, 0);
    g.fillStyle = '#ffffff';
    g.fillText(l.text, 0, 0);
    g.restore();
  }
}

function r0LaneWidth(r: BuiltRoad | undefined) {
  return r ? r.width / r.lanes : 1.75;
}


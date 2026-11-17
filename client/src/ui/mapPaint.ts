// Vector painter for the minimap and the full map. Draws the map from its real geometry
// (area/building polygons, road polylines at their real width) instead of the 2 m tile grid,
// so it stays smooth at any zoom. Only features inside the visible rectangle are drawn.
import type { Box, BuiltMap, BuiltRoad } from '@kh/shared';
import { roofColorOf } from '../world/mapRenderer';

const AREA_FILL: Record<string, string> = {
  grass: '#86cf5d', park: '#86cf5d', forest: '#3f8a33', field: '#9bd36a', golf: '#8fdc6a',
  parking: '#9097a1', plaza: '#e9d9b6', construction: '#c8a878', water: '#4aa3df',
};
const AREA_ORDER = ['grass', 'golf', 'forest', 'park', 'field', 'construction', 'parking', 'plaza', 'water'];
const ROAD_FILL: Record<BuiltRoad['cls'], string> = { highway: '#30333b', arterial: '#4a4e57', street: '#565a64', service: '#666a73' };
const ROAD_ORDER: Record<BuiltRoad['cls'], number> = { service: 0, street: 1, arterial: 2, highway: 3 };

/** Screen transform: screen = o + (tile - mapOrigin) × scale, scale in px per tile. */
export interface PaintView {
  scale: number;
  ox: number;
  oy: number;
  /** Visible size in CSS px. */
  w: number;
  h: number;
}

export function paintMap(ctx: CanvasRenderingContext2D, map: BuiltMap, v: PaintView) {
  const { scale: s } = v;
  // Visible rectangle in tile coords, for culling.
  const vx0 = map.originTx + -v.ox / s, vy0 = map.originTy + -v.oy / s;
  const vis: Box = { x0: vx0 - 2, y0: vy0 - 2, x1: vx0 + v.w / s + 2, y1: vy0 + v.h / s + 2 };
  const seen = (b: Box) => b.x1 >= vis.x0 && b.x0 <= vis.x1 && b.y1 >= vis.y0 && b.y0 <= vis.y1;

  ctx.save();
  ctx.fillStyle = '#7cc456';
  const [mx, my] = [v.ox, v.oy];
  ctx.fillRect(mx, my, map.width * s, map.height * s);
  ctx.beginPath();
  ctx.rect(mx, my, map.width * s, map.height * s);
  ctx.clip();
  // Draw in tile coords from here on.
  ctx.translate(v.ox - map.originTx * s, v.oy - map.originTy * s);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const px = 1 / s; // one screen pixel, in tiles
  const trace = (pts: number[], close: boolean) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (close) ctx.closePath();
  };

  // 1. areas
  for (const kind of AREA_ORDER) {
    ctx.fillStyle = AREA_FILL[kind];
    for (const a of map.areas) {
      if (a.kind !== kind || !seen(a.bbox)) continue;
      trace(a.poly, true);
      ctx.fill();
    }
  }
  // 2. rivers and drains
  ctx.strokeStyle = AREA_FILL.water;
  for (const w of map.waterways) {
    if (!seen(w.bbox)) continue;
    ctx.lineWidth = w.width;
    trace(w.pts, false);
    ctx.stroke();
  }
  // 3. footpaths (thin, only once there's room for them)
  if (s >= 1.5) {
    ctx.strokeStyle = '#dccaa0';
    for (const p of map.paths) {
      if (p.bridge || !seen(p.bbox)) continue;
      ctx.lineWidth = Math.max(p.width, 1.2 * px);
      trace(p.pts, false);
      ctx.stroke();
    }
  }
  // 4. ground roads: sidewalks, then asphalt by class so junctions merge
  const ground = map.roads.filter((r) => !r.elevated && seen(r.bbox)).sort((a, b) => ROAD_ORDER[a.cls] - ROAD_ORDER[b.cls]);
  ctx.strokeStyle = '#d8d2c4';
  for (const r of ground) {
    if (!r.sidewalk) continue;
    ctx.lineWidth = r.width + r.sidewalk * 2;
    trace(r.pts, false);
    ctx.stroke();
  }
  const asphalt = (roads: BuiltRoad[]) => {
    for (const r of roads) {
      ctx.strokeStyle = ROAD_FILL[r.cls];
      ctx.lineWidth = Math.max(r.width, 1.5 * px);
      trace(r.pts, false);
      ctx.stroke();
    }
  };
  asphalt(ground);
  // 5. buildings
  for (const b of map.buildings) {
    if (!seen(b.bbox)) continue;
    trace(b.poly, true);
    ctx.fillStyle = b.kind === 'roof' ? 'rgba(201,206,212,0.85)' : roofColorOf(b);
    ctx.fill();
    if (s >= 3) {
      ctx.lineWidth = px;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.stroke();
    }
  }
  // 6. overhead: rail viaducts, elevated roads (the DASH, flyovers), footbridges
  for (const r of map.rails) {
    if (!seen(r.bbox)) continue;
    ctx.strokeStyle = r.elevated ? '#b8bec6' : '#8d939c';
    ctx.lineWidth = 3;
    trace(r.pts, false);
    ctx.stroke();
  }
  const decks = map.roads.filter((r) => r.elevated && seen(r.bbox)).sort((a, b) => ROAD_ORDER[a.cls] - ROAD_ORDER[b.cls]);
  ctx.strokeStyle = '#c3c7cc';
  for (const r of decks) {
    ctx.lineWidth = r.width + Math.max(0.6, 2 * px);
    trace(r.pts, false);
    ctx.stroke();
  }
  asphalt(decks);
  for (const p of map.paths) {
    if (!p.bridge || !seen(p.bbox)) continue;
    ctx.strokeStyle = '#d9d4ca';
    ctx.lineWidth = Math.max(p.width, 1.5 * px);
    trace(p.pts, false);
    ctx.stroke();
  }
  // 7. centre lines on big roads when zoomed right in
  if (s >= 6) {
    ctx.setLineDash([1.5, 1.5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(0.12, px);
    for (const r of [...ground, ...decks]) {
      if (r.lanes < 2 || r.cls === 'service') continue;
      trace(r.pts, false);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.restore();
}

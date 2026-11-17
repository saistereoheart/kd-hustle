// npm run import-map: turns the cached OSM download (data-src/osm/*.osm) into
// shared/map/kd.osm.json — the game's map data at real scale.
//
//   Map data © OpenStreetMap contributors, available under the ODbL 1.0.
//
// What it keeps: road geometry/class/lanes/one-way + street names, footpaths, building
// footprints (+levels, entrances), parks/water/parking/forest areas, waterways, rail,
// trees and pedestrian crossings. What it DROPS: every shop, brand, business and building
// name (parody names for landmarks live in town.overrides.json).
import fs from 'node:fs';
import path from 'node:path';
import { overridesSchema, osmMapDataSchema, type AreaKind, type BuildingKind, type OsmMapData, type RoadClass } from '../shared/src/index';
import { ROOT } from '../server/src/paths';
import { emptyOsm, parseOsmXml, type OsmData, type OsmWay } from './osm/osmXml';

const overrides = overridesSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/map/town.overrides.json'), 'utf8')));
const srcDir = path.join(ROOT, 'data-src', 'osm');
if (!fs.existsSync(srcDir) || fs.readdirSync(srcDir).filter((f) => f.endsWith('.osm')).length === 0) {
  console.error('No OSM data found. Run "npm run fetch-osm" first.');
  process.exit(1);
}

// ---------------------------------------------------------------- load
const osm: OsmData = emptyOsm();
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith('.osm')).sort()) {
  parseOsmXml(fs.readFileSync(path.join(srcDir, f), 'utf8'), osm);
}
console.log(`Loaded ${osm.nodes.size} nodes, ${osm.ways.size} ways, ${osm.relations.size} relations`);

// ---------------------------------------------------------------- projection
// Local equirectangular projection around the fixed origin: accurate to centimetres over a few km.
const { lat: lat0, lon: lon0 } = overrides.origin;
const mpt = overrides.metersPerTile;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((lat0 * Math.PI) / 180);
const r2 = (v: number) => Math.round(v * 20) / 20; // 0.05 tile precision
const project = (lat: number, lon: number): [number, number] => [r2(((lon - lon0) * M_PER_DEG_LON) / mpt), r2(((lat0 - lat) * M_PER_DEG_LAT) / mpt)];

const [bx, by, bw, bh] = overrides.bounds;
const MARGIN = 40;
const inBounds = (pts: number[]) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
  }
  return maxX >= bx - MARGIN && minX <= bx + bw + MARGIN && maxY >= by - MARGIN && minY <= by + bh + MARGIN;
};

const wayPts = (w: OsmWay): number[] | null => {
  const out: number[] = [];
  for (const id of w.nodes) {
    const n = osm.nodes.get(id);
    if (!n) return null; // incomplete way at the edge of the download
    out.push(...project(n.lat, n.lon));
  }
  return out;
};

/** Joins the outer member ways of a multipolygon into closed rings. */
function relationRings(relId: number): number[][] {
  const rel = osm.relations.get(relId)!;
  const segs: number[][] = [];
  for (const m of rel.members) {
    if (m.type !== 'way' || (m.role !== 'outer' && m.role !== '')) continue;
    const w = osm.ways.get(m.ref);
    if (w && w.nodes.length >= 2) segs.push([...w.nodes]);
  }
  const rings: number[][] = [];
  while (segs.length) {
    let ring = segs.shift()!;
    let grew = true;
    while (ring[0] !== ring[ring.length - 1] && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = ring[ring.length - 1];
        if (s[0] === end) ring = ring.concat(s.slice(1));
        else if (s[s.length - 1] === end) ring = ring.concat([...s].reverse().slice(1));
        else continue;
        segs.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring[0] === ring[ring.length - 1] && ring.length >= 4) rings.push(ring);
  }
  return rings
    .map((ids) => {
      const pts: number[] = [];
      for (const id of ids) {
        const n = osm.nodes.get(id);
        if (!n) return [];
        pts.push(...project(n.lat, n.lon));
      }
      return pts;
    })
    .filter((p) => p.length >= 8);
}

const polyArea = (p: number[]) => {
  let a = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += (p[j] + p[i]) * (p[j + 1] - p[i + 1]);
  return Math.abs(a / 2);
};
/** Drop the duplicated closing point of closed ways. */
const openRing = (p: number[]) => (p.length >= 4 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1] ? p.slice(0, -2) : p);

// ---------------------------------------------------------------- roads
const ROAD_CLASS: Record<string, RoadClass> = {
  motorway: 'highway', motorway_link: 'highway', trunk: 'highway', trunk_link: 'highway',
  primary: 'arterial', primary_link: 'arterial', secondary: 'arterial', secondary_link: 'arterial',
  tertiary: 'street', tertiary_link: 'street', unclassified: 'street', residential: 'street', living_street: 'street',
  service: 'service',
};
const PATHS: Record<string, OsmMapData['paths'][number]['kind']> = {
  footway: 'footway', path: 'footway', steps: 'steps', cycleway: 'cycleway', track: 'track', pedestrian: 'pedestrian', corridor: 'footway',
};
/** Default total lanes when OSM has no lanes=* tag: [two-way, one-way]. */
const DEFAULT_LANES: Record<string, [number, number]> = {
  motorway: [6, 3], trunk: [4, 2], primary: [4, 2], secondary: [2, 2], tertiary: [2, 1], unclassified: [2, 1],
  residential: [2, 1], living_street: [2, 1], service: [1, 1],
};

const data: OsmMapData = {
  meta: {
    source: 'OpenStreetMap',
    license: 'ODbL-1.0 (https://opendatacommons.org/licenses/odbl/1-0/)',
    attribution: '© OpenStreetMap contributors',
    generatedAt: new Date().toISOString(),
    metersPerTile: mpt,
    origin: { lat: lat0, lon: lon0 },
  },
  roads: [], paths: [], buildings: [], areas: [], waterways: [], rails: [], trees: [], crossings: [],
};

for (const w of osm.ways.values()) {
  const t = w.tags;
  if (!t.highway || t.area === 'yes') continue;
  // Underpasses (tunnel=yes / layer<0) are kept: in top-down 2D they're ground-level roads that
  // cut through the highway above them.
  if (t.tunnel === 'yes' && t.highway === 'motorway') continue;
  const pts = wayPts(w);
  if (!pts || pts.length < 4 || !inBounds(pts)) continue;
  const cls = ROAD_CLASS[t.highway];
  if (cls) {
    const base = t.highway.replace('_link', '');
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1' || t.junction === 'roundabout' || t.highway === 'motorway';
    const tagged = parseInt(t.lanes ?? '', 10);
    const link = t.highway.endsWith('_link');
    const lanes = Number.isFinite(tagged) && tagged > 0 ? Math.min(tagged, 8) : link ? 1 : (DEFAULT_LANES[base] ?? [2, 1])[oneway ? 1 : 0];
    const ptsDir = t.oneway === '-1' ? reversePts(pts) : pts;
    data.roads.push({
      id: `w${w.id}`,
      // Street names are kept; service roads often carry business names, so those are dropped.
      name: cls !== 'service' && t.name ? t.name : undefined,
      cls,
      lanes,
      oneway,
      elevated: t.bridge === 'yes' || t.bridge === 'viaduct' || Number(t.layer) > 0,
      pts: ptsDir,
    });
  } else if (PATHS[t.highway]) {
    data.paths.push({ id: `w${w.id}`, kind: PATHS[t.highway], bridge: t.bridge === 'yes' || Number(t.layer) > 0, pts });
  }
}

function reversePts(p: number[]) {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

// ---------------------------------------------------------------- buildings
function buildingKind(t: Record<string, string>, area: number, levels: number | null): BuildingKind {
  const b = t.building;
  if (b === 'roof' || b === 'carport' || t.amenity === 'fuel') return 'roof';
  if (b === 'construction') return 'construction';
  if (b === 'parking' || t.amenity === 'parking') return 'parking';
  if (b === 'hospital' || t.amenity === 'hospital' || t.amenity === 'clinic') return 'hospital';
  if (b === 'school' || b === 'university' || b === 'college' || t.amenity === 'school') return 'school';
  if (b === 'mosque' || b === 'temple' || b === 'church' || t.amenity === 'place_of_worship') return 'religious';
  if (b === 'train_station' || b === 'transportation' || t.railway === 'station' || t.public_transport === 'station') return 'station';
  if (b === 'office') return levels && levels >= 10 ? 'tower' : 'office';
  if (b === 'house' || b === 'detached') return area > 70 ? 'bungalow' : 'semid';
  if (b === 'semidetached_house') return 'semid';
  if (b === 'terrace') return 'terrace';
  if (b === 'apartments' || b === 'residential') return levels && levels >= 6 ? 'condo' : area > 150 ? 'condo' : 'flat';
  if (b === 'retail' || b === 'commercial' || b === 'supermarket' || b === 'mall') return area > 500 ? 'mall' : 'shoplot';
  if (b === 'government' || b === 'public' || b === 'civic' || t.amenity === 'police' || t.amenity === 'community_centre') return 'civic';
  if (levels && levels >= 10) return 'tower';
  return area > 700 ? 'mall' : 'shoplot';
}

const entranceNodes = new Set([...osm.nodes.values()].filter((n) => n.tags.entrance || n.tags.door).map((n) => n.id));

const addBuilding = (id: string, tags: Record<string, string>, poly: number[], nodeIds: number[]) => {
  if (poly.length < 6 || !inBounds(poly)) return;
  const area = polyArea(poly);
  if (area < 1.5) return; // sheds/kiosks smaller than ~6 m²
  const levels = parseFloat(tags['building:levels'] ?? '') || null;
  const entrances: number[] = [];
  for (const nid of nodeIds) {
    if (!entranceNodes.has(nid)) continue;
    const n = osm.nodes.get(nid)!;
    entrances.push(...project(n.lat, n.lon));
  }
  data.buildings.push({ id, kind: buildingKind(tags, area, levels), levels, poly, ...(entrances.length ? { entrances } : {}) });
};

for (const w of osm.ways.values()) {
  if (!w.tags.building || w.tags.building === 'no') continue;
  if (w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  const pts = wayPts(w);
  if (pts) addBuilding(`w${w.id}`, w.tags, openRing(pts), w.nodes);
}
for (const r of osm.relations.values()) {
  if (r.tags.type !== 'multipolygon' || !r.tags.building) continue;
  relationRings(r.id).forEach((ring, i) => addBuilding(i === 0 ? `r${r.id}` : `r${r.id}-${i}`, r.tags, openRing(ring), []));
}

// ---------------------------------------------------------------- areas
function areaKind(t: Record<string, string>): AreaKind | null {
  if (t.building) return null;
  if (t.natural === 'water' || t.landuse === 'basin' || t.landuse === 'reservoir' || t.leisure === 'swimming_pool' || t.waterway === 'riverbank') return 'water';
  if (t.landuse === 'forest' || t.natural === 'wood' || t.natural === 'scrub') return 'forest';
  if (t.leisure === 'golf_course') return 'golf';
  if (t.leisure === 'pitch' || t.leisure === 'track' || t.leisure === 'stadium') return 'field';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground' || t.landuse === 'recreation_ground' || t.landuse === 'village_green') return 'park';
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.natural === 'grassland') return 'grass';
  if (t.amenity === 'parking' && t.parking !== 'multi-storey' && t.parking !== 'underground') return 'parking';
  if ((t.highway === 'pedestrian' && t.area === 'yes') || t.place === 'square' || t.amenity === 'marketplace') return 'plaza';
  if (t.landuse === 'construction' || t.landuse === 'brownfield') return 'construction';
  return null;
}
for (const w of osm.ways.values()) {
  const kind = areaKind(w.tags);
  if (!kind || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  const pts = wayPts(w);
  if (pts && inBounds(pts)) data.areas.push({ id: `w${w.id}`, kind, poly: openRing(pts) });
}
for (const r of osm.relations.values()) {
  if (r.tags.type !== 'multipolygon') continue;
  const kind = areaKind(r.tags);
  if (!kind) continue;
  relationRings(r.id).forEach((ring, i) => {
    if (inBounds(ring)) data.areas.push({ id: i === 0 ? `r${r.id}` : `r${r.id}-${i}`, kind, poly: openRing(ring) });
  });
}
// Big areas first so small ones (ponds inside parks) draw on top.
data.areas.sort((a, b) => polyArea(b.poly) - polyArea(a.poly));

// ---------------------------------------------------------------- waterways, rail, trees, crossings
const WATER_W: Record<string, number> = { river: 6, canal: 3, stream: 1.5, drain: 1.2, ditch: 1 };
for (const w of osm.ways.values()) {
  const t = w.tags;
  const pts = t.waterway || t.railway ? wayPts(w) : null;
  if (!pts || pts.length < 4 || !inBounds(pts)) continue;
  if (t.waterway && WATER_W[t.waterway] && t.tunnel !== 'culvert' && t.tunnel !== 'yes') {
    data.waterways.push({ id: `w${w.id}`, width: WATER_W[t.waterway], pts });
  } else if (t.railway && ['subway', 'light_rail', 'rail', 'monorail'].includes(t.railway) && t.tunnel !== 'yes') {
    data.rails.push({ id: `w${w.id}`, elevated: t.bridge === 'yes' || t.bridge === 'viaduct' || Number(t.layer) > 0, pts });
  }
}
for (const n of osm.nodes.values()) {
  const [x, y] = project(n.lat, n.lon);
  if (x < bx - MARGIN || y < by - MARGIN || x > bx + bw + MARGIN || y > by + bh + MARGIN) continue;
  if (n.tags.natural === 'tree') data.trees.push(x, y);
  if (n.tags.highway === 'crossing' || n.tags.crossing) data.crossings.push(x, y);
}

// ---------------------------------------------------------------- write
const checked = osmMapDataSchema.parse(data);
const out = path.join(ROOT, 'shared/map/kd.osm.json');
fs.writeFileSync(out, JSON.stringify(checked));
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(
  `Wrote ${path.relative(ROOT, out)} (${kb} KB): ${data.roads.length} roads, ${data.paths.length} paths, ` +
    `${data.buildings.length} buildings, ${data.areas.length} areas, ${data.waterways.length} waterways, ` +
    `${data.rails.length} rail lines, ${data.trees.length / 2} trees, ${data.crossings.length / 2} crossings`,
);
console.log('Map data © OpenStreetMap contributors (ODbL).');

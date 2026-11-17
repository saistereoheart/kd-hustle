// npm run fetch-osm: downloads OpenStreetMap data for the map area into data-src/osm/
// (git-ignored). Map data © OpenStreetMap contributors, ODbL.
// Uses the main OSM API in small tiles (the Overpass API may be blocked on some networks).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/src/paths';

const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/map/town.overrides.json'), 'utf8'));
const { south, west, north, east } = overrides.osmFetchBbox as { south: number; west: number; north: number; east: number };
const outDir = path.join(ROOT, 'data-src', 'osm');
fs.mkdirSync(outDir, { recursive: true });

const ROWS = Math.ceil((north - south) / 0.006);
const COLS = Math.ceil((east - west) / 0.006);
const force = process.argv.includes('--force');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log(`Fetching OSM ${south},${west} → ${north},${east} in ${ROWS}×${COLS} tiles`);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const s = south + ((north - south) * r) / ROWS;
    const n = south + ((north - south) * (r + 1)) / ROWS;
    const w = west + ((east - west) * c) / COLS;
    const e = west + ((east - west) * (c + 1)) / COLS;
    const file = path.join(outDir, `tile-${r}-${c}.osm`);
    if (!force && fs.existsSync(file) && fs.statSync(file).size > 1000) {
      console.log(`  tile ${r},${c}: cached`);
      continue;
    }
    const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${w.toFixed(5)},${s.toFixed(5)},${e.toFixed(5)},${n.toFixed(5)}`;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'KotaHustle-map-import/0.1 (hobby LAN game)' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        fs.writeFileSync(file, text);
        console.log(`  tile ${r},${c}: ${(text.length / 1024).toFixed(0)} KB`);
        break;
      } catch (err) {
        if (attempt >= 3) {
          console.error(`  tile ${r},${c}: FAILED (${(err as Error).message}).`);
          console.error('  If this keeps failing, see docs/PROGRESS.md → "Map data" for manual download steps.');
          process.exit(1);
        }
        await sleep(3000 * attempt);
      }
    }
    await sleep(1200); // be polite to the OSM servers
  }
}
console.log(`Done. Raw data in ${path.relative(ROOT, outDir)} (git-ignored). Now run: npm run import-map`);

// npm run map-preview: writes test-results/map-preview.png, a 2 px-per-tile picture of the
// terrain grid (what the game uses for collision), with a grid line every 50 tiles and the
// world origin (Menara Mitraland) in red. Handy when editing town.overrides.json.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildMap, terrainConfigSchema, Tile } from '../shared/src/index';
import { ROOT } from '../server/src/paths';

const read = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const map = buildMap(
  { data: read('shared/map/kd.osm.json'), overrides: read('shared/map/town.overrides.json') },
  terrainConfigSchema.parse(read('shared/config/terrain.json')),
);
const C: Record<number, number[]> = {
  [Tile.Grass]: [124, 196, 86], [Tile.Road]: [75, 79, 89], [Tile.Sidewalk]: [216, 210, 196], [Tile.Crossing]: [255, 255, 255],
  [Tile.Plaza]: [233, 217, 182], [Tile.Water]: [74, 163, 223], [Tile.Highway]: [40, 42, 50], [Tile.Forest]: [63, 138, 51],
  [Tile.Field]: [155, 211, 106], [Tile.Building]: [200, 90, 70], [Tile.Parking]: [139, 144, 154], [Tile.Golf]: [143, 220, 106],
  [Tile.Bridge]: [255, 200, 0], [Tile.Path]: [201, 167, 116], [Tile.Park]: [134, 207, 93], [Tile.Construction]: [180, 150, 100],
  [Tile.Roof]: [230, 170, 160], [Tile.Overpass]: [255, 150, 0],
};
const S = 2, W = map.width * S, H = map.height * S;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const tx = Math.floor(x / S) + map.originTx, ty = Math.floor(y / S) + map.originTy;
    let c = C[map.terrain[Math.floor(y / S) * map.width + Math.floor(x / S)]] ?? [255, 0, 255];
    if ((tx % 50 === 0 && x % S === 0) || (ty % 50 === 0 && y % S === 0)) c = tx === 0 || ty === 0 ? [255, 0, 0] : [255, 255, 255];
    const o = y * (W * 3 + 1) + 1 + x * 3;
    raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
  }
}
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b: Buffer) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type: string, d: Buffer) => {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(type), d]);
  const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, cc]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const out = path.join(ROOT, 'test-results', 'map-preview.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`Wrote ${path.relative(ROOT, out)} (${W}×${H}). Grid every 50 tiles (100 m); red lines = origin (Menara Mitraland).`);

// Dev tool: renders the built map (or part of it) to an SVG and a PNG so the layout can be
// checked without running the game: roads by class, elevated decks, paths, buildings (named
// ones labelled with their OSM id), doors, interactables, stall plots and walk-reachability.
//
//   npm run map-inspect -- [x0 y0 x1 y1] [--px 4] [--ids]
//
// Output: test-results/map-inspect.svg / .png (git-ignored). (npm run map-preview is the terrain-grid view.)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConfig } from '../server/src/config/loadConfig';
import { reachableFromSpawn } from '../shared/src/map/reach';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string, d: number) => {
  const i = args.indexOf(n);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const nums = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--px'))).map(Number);
const cfg = loadConfig('shared/config', 'shared/map');
const m = cfg.map;
const [x0, y0, x1, y1] = nums.length === 4 ? nums : [m.originTx, m.originTy, m.originTx + m.width, m.originTy + m.height];
const PX = opt('--px', 4);
const W = (x1 - x0) * PX, H = (y1 - y0) * PX;
const showIds = flag('--ids');

const inView = (b: { x0: number; y0: number; x1: number; y1: number }) => b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1;
const P = (x: number, y: number) => `${((x - x0) * PX).toFixed(1)},${((y - y0) * PX).toFixed(1)}`;
const line = (pts: number[]) => {
  let s = '';
  for (let i = 0; i < pts.length; i += 2) s += (i ? 'L' : 'M') + P(pts[i], pts[i + 1]);
  return s;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const out: string[] = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial">`);
out.push(`<rect width="${W}" height="${H}" fill="#7cc456"/>`);

// Unreachable walkable tiles (from spawn) tinted red: shows islands the player can't get to.
const reach = reachableFromSpawn(m);
for (let ty = y0; ty < y1; ty++)
  for (let tx = x0; tx < x1; tx++) {
    const gx = tx - m.originTx, gy = ty - m.originTy;
    if (gx < 0 || gy < 0 || gx >= m.width || gy >= m.height) continue;
    const i = gy * m.width + gx;
    const t = m.terrain[i];
    const fill = t === 5 ? '#4aa3df' : t === 10 ? '#9097a1' : t === 4 ? '#e9d9b6' : t === 7 ? '#4f9a3e' : t === 14 ? '#86cf5d' : null;
    if (fill) out.push(`<rect x="${(tx - x0) * PX}" y="${(ty - y0) * PX}" width="${PX}" height="${PX}" fill="${fill}"/>`);
    if (!m.solid[i] && !reach[i]) out.push(`<rect x="${(tx - x0) * PX}" y="${(ty - y0) * PX}" width="${PX}" height="${PX}" fill="#ff0000" opacity="0.35"/>`);
  }

const roadCol: Record<string, string> = { highway: '#2b2d33', arterial: '#484c55', street: '#5a5e68', service: '#7a7e88' };
for (const r of m.roads.filter((r) => !r.elevated && inView(r.bbox))) {
  if (r.sidewalk) out.push(`<path d="${line(r.pts)}" stroke="#d6cfc0" stroke-width="${(r.width + r.sidewalk * 2) * PX}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
}
for (const r of m.roads.filter((r) => !r.elevated && inView(r.bbox)))
  out.push(`<path d="${line(r.pts)}" stroke="${roadCol[r.cls]}" stroke-width="${r.width * PX}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
for (const p of m.paths.filter((p) => inView(p.bbox)))
  out.push(`<path d="${line(p.pts)}" stroke="${p.bridge ? '#ffffff' : '#dccaa0'}" stroke-width="${p.width * PX}" fill="none" stroke-linecap="round"/>`);
for (const r of m.roads.filter((r) => r.elevated && inView(r.bbox)))
  out.push(`<path d="${line(r.pts)}" stroke="#c3c7cc" stroke-width="${r.width * PX}" fill="none" opacity="0.75" stroke-linecap="round"/>`);
for (const r of m.rails.filter((r) => inView(r.bbox))) out.push(`<path d="${line(r.pts)}" stroke="#b8bec6" stroke-width="${3 * PX}" fill="none" opacity="0.8"/>`);
for (const b of m.buildings.filter((b) => inView(b.bbox))) {
  out.push(`<path d="${line(b.poly)}Z" fill="${b.name ? '#f08c00' : b.kind === 'roof' ? '#ced4da' : '#e8d7c3'}" stroke="#555" stroke-width="0.5" opacity="${b.kind === 'roof' ? 0.5 : 1}"/>`);
  for (const d of b.doors) out.push(`<circle cx="${(d.frontX + 0.5 - x0) * PX}" cy="${(d.frontY + 0.5 - y0) * PX}" r="${PX * 0.6}" fill="${reach[(d.frontY - m.originTy) * m.width + d.frontX - m.originTx] ? '#2f9e44' : '#e03131'}"/>`);
}
for (const b of m.buildings.filter((b) => inView(b.bbox) && (b.name || showIds))) {
  const cx = (b.bbox.x0 + b.bbox.x1) / 2, cy = (b.bbox.y0 + b.bbox.y1) / 2;
  const fs2 = b.name ? 11 : 7;
  out.push(`<text x="${(cx - x0) * PX}" y="${(cy - y0) * PX}" font-size="${fs2}" text-anchor="middle" fill="#000">${esc(b.name ?? '')}${showIds || b.name ? `<tspan x="${(cx - x0) * PX}" dy="${fs2}" font-size="7">${b.id}</tspan>` : ''}</text>`);
}
for (const it of m.interactables) {
  out.push(`<circle cx="${(it.x - x0) * PX}" cy="${(it.y - y0) * PX}" r="${PX * 1.2}" fill="#7048e8"/>`);
  out.push(`<text x="${(it.x - x0) * PX + 6}" y="${(it.y - y0) * PX - 4}" font-size="11" font-weight="bold" fill="#3b0080">${esc(it.name)}</text>`);
}
for (const s of m.stallPlots) out.push(`<rect x="${(s.x - x0) * PX - 3}" y="${(s.y - y0) * PX - 3}" width="6" height="6" fill="#e64980"/>`);
out.push(`<circle cx="${(m.spawnPx.x / m.tileSize - x0) * PX}" cy="${(m.spawnPx.y / m.tileSize - y0) * PX}" r="6" fill="#fff" stroke="#000"/>`);
// grid every 50 tiles
for (let gx = Math.ceil(x0 / 50) * 50; gx < x1; gx += 50) out.push(`<line x1="${(gx - x0) * PX}" y1="0" x2="${(gx - x0) * PX}" y2="${H}" stroke="#000" stroke-width="0.4" opacity="0.4"/><text x="${(gx - x0) * PX + 2}" y="12" font-size="10">${gx}</text>`);
for (let gy = Math.ceil(y0 / 50) * 50; gy < y1; gy += 50) out.push(`<line x1="0" y1="${(gy - y0) * PX}" x2="${W}" y2="${(gy - y0) * PX}" stroke="#000" stroke-width="0.4" opacity="0.4"/><text x="2" y="${(gy - y0) * PX - 2}" font-size="10">${gy}</text>`);
out.push('</svg>');

const dir = path.resolve('test-results');
fs.mkdirSync(dir, { recursive: true });
const svgFile = path.join(dir, 'map-inspect.svg');
fs.writeFileSync(svgFile, out.join('\n'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Math.ceil(W), height: Math.ceil(H) } });
await page.goto('file://' + svgFile);
await page.screenshot({ path: path.join(dir, 'map-inspect.png') });
await browser.close();
console.log(`Wrote ${svgFile} and map-inspect.png (${Math.ceil(W)}×${Math.ceil(H)})`);

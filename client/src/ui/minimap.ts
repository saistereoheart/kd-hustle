// Minimap (local view around the player, toggle with M) + a full-map overlay.
// The base image is rendered once at 1 px per tile (768×576), then scaled.
import { Tile, type BuiltMap } from '@kh/shared';
import { roofColorOf } from '../world/mapRenderer';
import { el, uiRoot } from './dom';

const TILE_COLORS: Record<number, string> = {
  [Tile.Grass]: '#7cc456', [Tile.Park]: '#86cf5d', [Tile.Forest]: '#3f8a33', [Tile.Field]: '#9bd36a',
  [Tile.Golf]: '#8fdc6a', [Tile.Road]: '#5b606b', [Tile.Highway]: '#30333b', [Tile.Crossing]: '#5b606b',
  [Tile.Sidewalk]: '#d8d2c4', [Tile.Plaza]: '#e9d9b6', [Tile.Water]: '#4aa3df', [Tile.Building]: '#b0705f',
  [Tile.Parking]: '#9097a1', [Tile.Bridge]: '#c9cdd2', [Tile.Path]: '#dccaa0', [Tile.Construction]: '#c8a878',
  [Tile.Roof]: '#c9ced4',
};

/** Building kinds named on the full map (houses/condos would just clutter it). */
const LANDMARK_KINDS = new Set(['mall', 'station', 'hospital', 'casino', 'tower', 'bank', 'hypermarket', 'furniture', 'clubhouse', 'civic', 'shop', 'office', 'roof']);

export interface Dot {
  x: number;
  y: number;
  name: string;
  self?: boolean;
}

export class Minimap {
  private base: HTMLCanvasElement;
  private canvas: HTMLCanvasElement;
  private full: HTMLElement | null = null;
  private visible = true;
  private readonly size = { w: 168, h: 126 };
  private readonly zoom = 1.25; // px per tile in the minimap (≈ 270 m across)
  private lastDots: Dot[] = [];

  constructor(private map: BuiltMap) {
    this.base = document.createElement('canvas');
    this.base.width = map.width;
    this.base.height = map.height;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(map.width, map.height);
    for (let i = 0; i < map.terrain.length; i++) {
      const hex = TILE_COLORS[map.terrain[i]] ?? '#7cc456';
      const n = parseInt(hex.slice(1), 16);
      img.data[i * 4] = (n >> 16) & 255;
      img.data[i * 4 + 1] = (n >> 8) & 255;
      img.data[i * 4 + 2] = n & 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.translate(-map.originTx, -map.originTy);
    for (const b of map.buildings) {
      if (b.kind === 'roof') continue;
      ctx.beginPath();
      ctx.moveTo(b.poly[0], b.poly[1]);
      for (let i = 2; i < b.poly.length; i += 2) ctx.lineTo(b.poly[i], b.poly[i + 1]);
      ctx.closePath();
      ctx.fillStyle = roofColorOf(b);
      ctx.fill();
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas = el('canvas', { class: 'minimap', 'data-testid': 'minimap', title: 'Tap for the full map', width: String(this.size.w * dpr), height: String(this.size.h * dpr) });
    this.canvas.style.width = `${this.size.w}px`;
    this.canvas.style.height = `${this.size.h}px`;
    this.canvas.addEventListener('click', () => this.openFull());
    uiRoot().append(this.canvas);
  }

  toggle() {
    this.visible = !this.visible;
    this.canvas.classList.toggle('hidden', !this.visible);
  }

  /** World px → base-image px. */
  private toBase(x: number, y: number): [number, number] {
    return [x / this.map.tileSize - this.map.originTx, y / this.map.tileSize - this.map.originTy];
  }

  update(dots: Dot[]) {
    this.lastDots = dots;
    if (this.full) this.drawFull();
    if (!this.visible) return;
    const self = dots.find((d) => d.self);
    if (!self) return;
    const ctx = this.canvas.getContext('2d')!;
    const sx = this.canvas.width / this.size.w;
    ctx.setTransform(sx, 0, 0, sx, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#20263a';
    ctx.fillRect(0, 0, this.size.w, this.size.h);
    const viewW = this.size.w / this.zoom;
    const viewH = this.size.h / this.zoom;
    const [bx, by] = this.toBase(self.x, self.y);
    const cx = Math.max(viewW / 2, Math.min(this.map.width - viewW / 2, bx));
    const cy = Math.max(viewH / 2, Math.min(this.map.height - viewH / 2, by));
    const ox = cx - viewW / 2;
    const oy = cy - viewH / 2;
    ctx.drawImage(this.base, ox, oy, viewW, viewH, 0, 0, this.size.w, this.size.h);
    for (const d of dots) {
      const [dx, dy] = this.toBase(d.x, d.y);
      const px = (dx - ox) * this.zoom;
      const py = (dy - oy) * this.zoom;
      if (px < -4 || py < -4 || px > this.size.w + 4 || py > this.size.h + 4) continue;
      ctx.beginPath();
      ctx.arc(px, py, d.self ? 4 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = d.self ? '#ffe066' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#11131f';
      ctx.stroke();
    }
  }

  get fullOpen() {
    return this.full !== null;
  }

  openFull() {
    if (this.full) return;
    const canvas = el('canvas', { 'data-testid': 'fullmap' });
    const close = el('button', { class: 'btn close', type: 'button' }, 'Close map');
    const credit = el('div', { class: 'map-credit' }, `Map data ${this.map.attribution} (ODbL)`);
    this.full = el('div', { class: 'fullmap' }, canvas, credit, close);
    close.addEventListener('click', () => this.closeFull());
    this.full.addEventListener('click', (e) => {
      if (e.target === this.full) this.closeFull();
    });
    uiRoot().append(this.full);
    this.drawFull();
  }

  closeFull() {
    this.full?.remove();
    this.full = null;
  }

  private drawFull() {
    if (!this.full) return;
    const canvas = this.full.querySelector('canvas')!;
    const scale = Math.min((innerWidth - 24) / this.map.width, (innerHeight - 100) / this.map.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.map.width * scale;
    const h = this.map.height * scale;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const at = (tx: number, ty: number): [number, number] => [(tx - this.map.originTx) * scale, (ty - this.map.originTy) * scale];
    // District names
    ctx.font = `800 ${Math.max(12, scale * 16)}px system-ui, sans-serif`;
    for (const d of this.map.overrides.districts) {
      const [x, y, dw, dh] = d.rect;
      if (dw >= this.map.width) continue; // the catch-all district
      const [lx, ly] = at(...(d.label ?? [x + dw / 2, y + dh / 2]));
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(17,19,31,0.85)';
      ctx.fillStyle = d.color;
      ctx.strokeText(d.name, lx, ly);
      ctx.fillText(d.name, lx, ly);
    }
    // Landmarks
    ctx.font = `600 ${Math.max(9, scale * 8)}px system-ui, sans-serif`;
    for (const b of this.map.buildings) {
      if (!b.name || !LANDMARK_KINDS.has(b.kind)) continue;
      const [lx, ly] = at((b.bbox.x0 + b.bbox.x1) / 2, (b.bbox.y0 + b.bbox.y1) / 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(17,19,31,0.8)';
      ctx.fillStyle = '#ffffff';
      ctx.strokeText(b.name, lx, ly);
      ctx.fillText(b.name, lx, ly);
    }
    // Players
    ctx.font = `700 ${Math.max(10, scale * 9)}px system-ui, sans-serif`;
    for (const d of this.lastDots) {
      const [bx, by] = this.toBase(d.x, d.y);
      const px = bx * scale;
      const py = by * scale;
      ctx.beginPath();
      ctx.arc(px, py, d.self ? 6 : 5, 0, Math.PI * 2);
      ctx.fillStyle = d.self ? '#ffe066' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#11131f';
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeText(d.name, px, py - 12);
      ctx.fillStyle = d.self ? '#ffe066' : '#ffffff';
      ctx.fillText(d.name, px, py - 12);
    }
  }

  destroy() {
    this.closeFull();
    this.canvas.remove();
  }
}

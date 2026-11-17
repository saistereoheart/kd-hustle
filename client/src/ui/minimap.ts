// Minimap (local view around the player, toggle with M) + a full-map overlay.
// The map image is rendered once at 1 px per tile, then scaled.
import { Tile, type BuiltMap } from '@kh/shared';
import { roofColor } from '../world/mapRenderer';
import { el, uiRoot } from './dom';

const TILE_COLORS: Record<number, string> = {
  [Tile.Grass]: '#7cc456', [Tile.Park]: '#86cf5d', [Tile.Forest]: '#3f8a33', [Tile.Field]: '#9bd36a',
  [Tile.Golf]: '#8fdc6a', [Tile.Street]: '#5b606b', [Tile.Highway]: '#3a3d45', [Tile.Zebra]: '#5b606b',
  [Tile.Sidewalk]: '#d8d2c4', [Tile.Plaza]: '#e9d9b6', [Tile.Water]: '#4aa3df', [Tile.Building]: '#5a5f6b',
  [Tile.Parking]: '#8b909a', [Tile.Bridge]: '#bda98a', [Tile.Trail]: '#c9a774',
};

/** Building kinds named on the full map (houses/condos would just clutter it). */
const LANDMARK_KINDS = new Set(['mall', 'station', 'hospital', 'casino', 'tower', 'bank', 'hypermarket', 'furniture', 'clubhouse', 'civic']);

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
  private readonly zoom = 3; // px per tile in the minimap

  constructor(private map: BuiltMap) {
    this.base = document.createElement('canvas');
    this.base.width = map.width;
    this.base.height = map.height;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(map.width, map.height);
    for (let i = 0; i < map.ground.length; i++) {
      const hex = TILE_COLORS[map.ground[i]] ?? '#7cc456';
      const n = parseInt(hex.slice(1), 16);
      img.data[i * 4] = (n >> 16) & 255;
      img.data[i * 4 + 1] = (n >> 8) & 255;
      img.data[i * 4 + 2] = n & 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    for (const b of map.buildings) {
      ctx.fillStyle = `#${roofColor(b).toString(16).padStart(6, '0')}`;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas = el('canvas', { class: 'minimap', 'data-testid': 'minimap', title: 'Tap for the full map', width: String(this.size.w * dpr), height: String(this.size.h * dpr) });
    this.canvas.style.width = `${this.size.w}px`;
    this.canvas.style.height = `${this.size.h}px`;
    this.canvas.addEventListener('click', () => this.openFull());
    uiRoot().append(this.canvas);
  }

  private lastDots: Dot[] = [];

  toggle() {
    this.visible = !this.visible;
    this.canvas.classList.toggle('hidden', !this.visible);
  }

  update(dots: Dot[]) {
    this.lastDots = dots;
    if (this.full) this.drawFull();
    if (!this.visible) return;
    const self = dots.find((d) => d.self);
    if (!self) return;
    const T = this.map.tileSize;
    const ctx = this.canvas.getContext('2d')!;
    const sx = this.canvas.width / this.size.w;
    ctx.setTransform(sx, 0, 0, sx, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#20263a';
    ctx.fillRect(0, 0, this.size.w, this.size.h);
    const viewW = this.size.w / this.zoom;
    const viewH = this.size.h / this.zoom;
    const cx = Math.max(viewW / 2, Math.min(this.map.width - viewW / 2, self.x / T));
    const cy = Math.max(viewH / 2, Math.min(this.map.height - viewH / 2, self.y / T));
    const ox = cx - viewW / 2;
    const oy = cy - viewH / 2;
    ctx.drawImage(this.base, ox, oy, viewW, viewH, 0, 0, this.size.w, this.size.h);
    for (const d of dots) {
      const px = (d.x / T - ox) * this.zoom;
      const py = (d.y / T - oy) * this.zoom;
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
    this.full = el('div', { class: 'fullmap' }, canvas, close);
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
    const scale = Math.max(2, Math.floor(Math.min((innerWidth - 24) / this.map.width, (innerHeight - 80) / this.map.height) * 2) / 2);
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
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // District names
    ctx.font = `800 ${Math.max(11, scale * 4.5)}px system-ui, sans-serif`;
    for (const d of this.map.layout.districts) {
      const [x, y, dw, dh] = d.rect;
      if (dw >= this.map.width) continue; // the catch-all district
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(17,19,31,0.85)';
      ctx.fillStyle = d.color;
      const [lx, ly] = d.label ?? [x + dw / 2, y + dh / 2];
      ctx.strokeText(d.name, lx * scale, ly * scale);
      ctx.fillText(d.name, lx * scale, ly * scale);
    }
    // Landmarks
    ctx.font = `600 ${Math.max(9, scale * 2.6)}px system-ui, sans-serif`;
    for (const b of this.map.buildings) {
      if (!b.name || /-\d+$/.test(b.id)) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(17,19,31,0.8)';
      ctx.fillStyle = '#ffffff';
      ctx.strokeText(b.name, (b.x + b.w / 2) * scale, (b.y + b.h / 2) * scale);
      ctx.fillText(b.name, (b.x + b.w / 2) * scale, (b.y + b.h / 2) * scale);
    }
    // Players
    const T = this.map.tileSize;
    ctx.font = `700 ${Math.max(10, scale * 3)}px system-ui, sans-serif`;
    for (const d of this.lastDots) {
      const px = (d.x / T) * scale;
      const py = (d.y / T) * scale;
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

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
  /** A job target (drawn as a gold ring). */
  target?: boolean;
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
      ctx.arc(px, py, d.self ? 4 : d.target ? 5 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = d.self ? '#ffe066' : d.target ? '#ff922b' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#11131f';
      ctx.stroke();
    }
  }

  get fullOpen() {
    return this.full !== null;
  }

  /** Full-map view: zoom (wheel / pinch / buttons / double-click) and pan (drag). */
  private view = { scale: 1, ox: 0, oy: 0, fit: 1 };

  openFull() {
    if (this.full) return;
    const canvas = el('canvas', { 'data-testid': 'fullmap' });
    const btn = (label: string, action: string, title: string) => el('button', { class: 'icon-btn', type: 'button', 'data-action': action, title, 'aria-label': title }, label);
    const zin = btn('+', 'zoom-in', 'Zoom in');
    const zout = btn('−', 'zoom-out', 'Zoom out');
    const me = btn('📍', 'zoom-me', 'Centre on me');
    const close = el('button', { class: 'btn close', type: 'button' }, 'Close map');
    const credit = el('div', { class: 'map-credit' }, `Map data ${this.map.attribution} (ODbL) · scroll / pinch to zoom, drag to move · M or tap outside to close`);
    const wrap = el('div', { class: 'fullmap-canvas' }, canvas, el('div', { class: 'fullmap-zoom' }, zin, zout, me));
    this.full = el('div', { class: 'fullmap' }, wrap, credit, close);
    close.addEventListener('click', () => this.closeFull());
    // Click/tap anywhere outside the map itself closes it.
    this.full.addEventListener('click', (e) => {
      if (e.target === this.full || e.target === credit) this.closeFull();
    });
    uiRoot().append(this.full);

    // Fit the whole map, centred.
    const r = wrap.getBoundingClientRect();
    const fit = Math.min(r.width / this.map.width, r.height / this.map.height);
    this.view = { scale: fit, fit, ox: (r.width - this.map.width * fit) / 2, oy: (r.height - this.map.height * fit) / 2 };

    const zoomAt = (factor: number, sx: number, sy: number) => {
      const v = this.view;
      const next = Math.max(v.fit * 0.9, Math.min(16, v.scale * factor));
      // keep the map point under (sx, sy) fixed
      v.ox = sx - ((sx - v.ox) * next) / v.scale;
      v.oy = sy - ((sy - v.oy) * next) / v.scale;
      v.scale = next;
      this.drawFull();
    };
    const centre = () => {
      const rr = wrap.getBoundingClientRect();
      return [rr.width / 2, rr.height / 2] as const;
    };
    zin.addEventListener('click', () => zoomAt(1.6, ...centre()));
    zout.addEventListener('click', () => zoomAt(1 / 1.6, ...centre()));
    me.addEventListener('click', () => {
      const self = this.lastDots.find((d) => d.self);
      if (!self) return;
      const [bx, by] = this.toBase(self.x, self.y);
      const [cx, cy] = centre();
      this.view.scale = Math.max(this.view.scale, 4);
      this.view.ox = cx - bx * this.view.scale;
      this.view.oy = cy - by * this.view.scale;
      this.drawFull();
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rr = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rr.left, e.clientY - rr.top);
    }, { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      const rr = canvas.getBoundingClientRect();
      zoomAt(2, e.clientX - rr.left, e.clientY - rr.top);
    });
    // Drag to pan; two fingers to pinch-zoom.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        this.view.ox += cur.x - prev.x;
        this.view.oy += cur.y - prev.y;
        this.drawFull();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const rr = canvas.getBoundingClientRect();
        if (pinchDist > 0) zoomAt(d / pinchDist, (a.x + b.x) / 2 - rr.left, (a.y + b.y) / 2 - rr.top);
        pinchDist = d;
      }
    });
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinchDist = 0;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    this.drawFull();
  }

  closeFull() {
    this.full?.remove();
    this.full = null;
  }

  /** M: open the full map, or close it if it's open. */
  toggleFull() {
    if (this.full) this.closeFull();
    else this.openFull();
  }

  private drawFull() {
    if (!this.full) return;
    const canvas = this.full.querySelector('canvas')!;
    const wrap = canvas.parentElement!;
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    }
    const { scale, ox, oy } = this.view;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#20263a';
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.imageSmoothingEnabled = scale < 3;
    ctx.drawImage(this.base, ox, oy, this.map.width * scale, this.map.height * scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const at = (tx: number, ty: number): [number, number] => [ox + (tx - this.map.originTx) * scale, oy + (ty - this.map.originTy) * scale];
    const label = (text: string, x: number, y: number, font: string, fill: string, lw = 3) => {
      if (x < -200 || y < -50 || x > r.width + 200 || y > r.height + 50) return;
      ctx.font = font;
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(17,19,31,0.85)';
      ctx.fillStyle = fill;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };
    const zoomedIn = scale / this.view.fit;
    // Street names once you've zoomed in a bit.
    if (zoomedIn > 2.2) {
      const seen = new Set<string>();
      for (const road of this.map.roads) {
        if (!road.name || road.elevated || seen.has(road.name) || road.pts.length < 4) continue;
        seen.add(road.name);
        const mid = Math.floor(road.pts.length / 4) * 2;
        const [lx, ly] = at(road.pts[mid], road.pts[mid + 1]);
        label(road.name, lx, ly, '600 11px system-ui, sans-serif', '#dee2e6', 3);
      }
    }
    // District names (fade out when zoomed far in).
    if (zoomedIn < 6) {
      for (const d of this.map.overrides.districts) {
        const [x, y, dw, dh] = d.rect;
        if (dw >= this.map.width) continue; // the catch-all district
        const [lx, ly] = at(...(d.label ?? [x + dw / 2, y + dh / 2]));
        label(d.name, lx, ly, `800 ${Math.round(Math.min(26, 13 + zoomedIn * 2))}px system-ui, sans-serif`, d.color, 4);
      }
    }
    // Landmarks (all named buildings once zoomed in).
    for (const b of this.map.buildings) {
      if (!b.name || (zoomedIn < 1.8 && !LANDMARK_KINDS.has(b.kind))) continue;
      const [lx, ly] = at((b.bbox.x0 + b.bbox.x1) / 2, (b.bbox.y0 + b.bbox.y1) / 2);
      label(b.name, lx, ly, `600 ${Math.round(Math.min(15, 10 + zoomedIn))}px system-ui, sans-serif`, '#ffffff');
    }
    // Interactables
    if (zoomedIn > 1.5) {
      for (const it of this.map.interactables) {
        const [lx, ly] = at(it.x, it.y);
        label(it.type === 'jobs' ? '📋' : it.type === 'pawn' ? '🏪' : it.type === 'carwash' ? '🚿' : '🎰', lx, ly, '16px system-ui, sans-serif', '#ffe066', 0);
      }
    }
    // Players and job targets
    for (const d of this.lastDots) {
      const [bx, by] = this.toBase(d.x, d.y);
      const px = ox + bx * scale;
      const py = oy + by * scale;
      ctx.beginPath();
      ctx.arc(px, py, d.self ? 6 : d.target ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = d.self ? '#ffe066' : d.target ? '#ff922b' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#11131f';
      ctx.stroke();
      label(d.target ? 'Target' : d.name, px, py - 14, '700 12px system-ui, sans-serif', d.self ? '#ffe066' : '#ffffff');
    }
  }

  destroy() {
    this.closeFull();
    this.canvas.remove();
  }
}

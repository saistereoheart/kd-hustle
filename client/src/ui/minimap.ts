// Minimap (local view around the player, toggle with N) + a full-map overlay (M).
// Both are painted from the real map geometry (see mapPaint.ts), so they stay smooth when
// zoomed in. The minimap uses a pre-painted image at BASE_SCALE px per tile; the full map
// repaints the visible part whenever you zoom or pan.
import type { BuiltMap } from '@kh/shared';
import { el, uiRoot } from './dom';
import { paintMap } from './mapPaint';

/** Pixels per tile of the pre-painted base image. */
const BASE_SCALE = 2;

/** Building kinds named on the full map (houses/condos would just clutter it). */
const LANDMARK_KINDS = new Set(['mall', 'station', 'hospital', 'casino', 'tower', 'bank', 'hypermarket', 'furniture', 'clubhouse', 'civic', 'shop', 'office', 'roof']);

export interface FullMapOptions {
  /** Pick mode: a tap on the map calls onPick with the tile coords. */
  pick?: { hint: string; onPick: (tx: number, ty: number) => void };
  onClose?: () => void;
}

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
    this.base.width = map.width * BASE_SCALE;
    this.base.height = map.height * BASE_SCALE;
    paintMap(this.base.getContext('2d')!, map, { scale: BASE_SCALE, ox: 0, oy: 0, w: this.base.width, h: this.base.height });
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
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = '#20263a';
    ctx.fillRect(0, 0, this.size.w, this.size.h);
    const viewW = this.size.w / this.zoom;
    const viewH = this.size.h / this.zoom;
    const [bx, by] = this.toBase(self.x, self.y);
    const cx = Math.max(viewW / 2, Math.min(this.map.width - viewW / 2, bx));
    const cy = Math.max(viewH / 2, Math.min(this.map.height - viewH / 2, by));
    const ox = cx - viewW / 2;
    const oy = cy - viewH / 2;
    ctx.drawImage(this.base, ox * BASE_SCALE, oy * BASE_SCALE, viewW * BASE_SCALE, viewH * BASE_SCALE, 0, 0, this.size.w, this.size.h);
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
  /** The painted map for the current view (repainted only when the view changes). */
  private layer: HTMLCanvasElement | null = null;
  private layerKey = '';
  private pick: FullMapOptions['pick'] | null = null;
  private route: { pts: number[]; dest: [number, number] } | null = null;
  private pin: [number, number] | null = null;
  private sheet: HTMLElement | null = null;
  private onCloseFull: (() => void) | null = null;

  /**
   * Opens the full map. With `pick`, a tap on the map picks a spot (tile coords) instead of
   * just panning, e.g. to choose a ride's destination.
   */
  openFull(opts: FullMapOptions = {}) {
    if (this.full) {
      if (!opts.pick) return;
      this.closeFull();
    }
    this.pick = opts.pick ?? null;
    this.onCloseFull = opts.onClose ?? null;
    this.route = null;
    this.pin = null;
    const canvas = el('canvas', { 'data-testid': 'fullmap' });
    const btn = (label: string, action: string, title: string) => el('button', { class: 'icon-btn', type: 'button', 'data-action': action, title, 'aria-label': title }, label);
    const zin = btn('+', 'zoom-in', 'Zoom in');
    const zout = btn('−', 'zoom-out', 'Zoom out');
    const me = btn('📍', 'zoom-me', 'Centre on me');
    const close = el('button', { class: 'btn close', type: 'button' }, this.pick ? 'Cancel' : 'Close map');
    const credit = el('div', { class: 'map-credit' }, `Map data ${this.map.attribution} (ODbL) · scroll / pinch to zoom, drag to move · M or tap outside to close`);
    this.sheet = el('div', { class: 'fullmap-sheet hidden', 'data-testid': 'fullmap-sheet' });
    const hint = this.pick ? el('div', { class: 'fullmap-hint' }, this.pick.hint) : null;
    const wrap = el('div', { class: 'fullmap-canvas' }, canvas, el('div', { class: 'fullmap-zoom' }, zin, zout, me), hint ?? '', this.sheet);
    this.full = el('div', { class: `fullmap${this.pick ? ' picking' : ''}` }, wrap, credit, close);
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
      const next = Math.max(v.fit * 0.9, Math.min(24, v.scale * factor));
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
    me.addEventListener('click', () => this.centreOnSelf(4));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rr = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rr.left, e.clientY - rr.top);
    }, { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      if (this.pick) return;
      const rr = canvas.getBoundingClientRect();
      zoomAt(2, e.clientX - rr.left, e.clientY - rr.top);
    });
    // Drag to pan; two fingers to pinch-zoom. In pick mode a tap (no drag) picks the spot.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let tap: { x: number; y: number; moved: boolean } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tap = pointers.size === 1 ? { x: e.clientX, y: e.clientY, moved: false } : null;
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
      if (tap && Math.hypot(cur.x - tap.x, cur.y - tap.y) > 8) tap.moved = true;
      if (pointers.size === 1) {
        if (tap && !tap.moved) return;
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
      if (e.type === 'pointerup' && tap && !tap.moved && this.pick) {
        const rr = canvas.getBoundingClientRect();
        const tx = this.map.originTx + (e.clientX - rr.left - this.view.ox) / this.view.scale;
        const ty = this.map.originTy + (e.clientY - rr.top - this.view.oy) / this.view.scale;
        if (tx >= this.map.originTx && ty >= this.map.originTy && tx < this.map.originTx + this.map.width && ty < this.map.originTy + this.map.height) {
          this.pin = [tx, ty];
          this.drawFull();
          this.pick.onPick(tx, ty);
        }
      }
      tap = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    if (this.pick) this.centreOnSelf(Math.max(fit * 2.5, 1.4));
    this.drawFull();
  }

  /** Centre the full map on the player (zooming in to at least `minScale`). */
  private centreOnSelf(minScale: number) {
    const self = this.lastDots.find((d) => d.self);
    if (!self || !this.full) return;
    const r = this.full.querySelector('.fullmap-canvas')!.getBoundingClientRect();
    const [bx, by] = this.toBase(self.x, self.y);
    this.view.scale = Math.max(this.view.scale, minScale);
    this.view.ox = r.width / 2 - bx * this.view.scale;
    this.view.oy = r.height / 2 - by * this.view.scale;
    this.drawFull();
  }

  /** Show a planned route (tile coords, flat) on the full map, or clear it. */
  setRoute(pts: number[] | null) {
    this.route = pts && pts.length >= 4 ? { pts, dest: [pts[pts.length - 2], pts[pts.length - 1]] } : null;
    this.drawFull();
  }

  /** Content of the panel at the bottom of the full map (ride booking), or null to hide it. */
  setSheet(content: HTMLElement | null) {
    if (!this.sheet) return;
    this.sheet.classList.toggle('hidden', !content);
    this.sheet.replaceChildren(...(content ? [content] : []));
  }

  closeFull() {
    if (!this.full) return;
    this.full.remove();
    this.full = null;
    this.sheet = null;
    this.pick = null;
    this.layer = null;
    this.layerKey = '';
    const cb = this.onCloseFull;
    this.onCloseFull = null;
    cb?.();
  }

  /** M: open the full map, or close it if it's open. */
  toggleFull() {
    if (this.full) this.closeFull();
    else this.openFull();
  }

  /** Paint (or reuse) the map layer for the current view. */
  private paintLayer(w: number, h: number, dpr: number) {
    const { scale, ox, oy } = this.view;
    const key = `${scale.toFixed(4)},${ox.toFixed(1)},${oy.toFixed(1)},${w},${h},${dpr}`;
    if (this.layer && this.layerKey === key) return this.layer;
    const c = this.layer ?? document.createElement('canvas');
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (scale * dpr <= BASE_SCALE) {
      // Zoomed out: the pre-painted base is already sharp enough.
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.base, ox, oy, this.map.width * scale, this.map.height * scale);
    } else {
      paintMap(ctx, this.map, { scale, ox, oy, w, h });
    }
    this.layer = c;
    this.layerKey = key;
    return c;
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#20263a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.paintLayer(r.width, r.height, dpr), 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    // Planned ride route
    if (this.route) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < this.route.pts.length; i += 2) {
        const [x, y] = at(this.route.pts[i], this.route.pts[i + 1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(17,19,31,0.75)';
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = '#40c057';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    }
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
    // Picked destination
    const dest = this.route?.dest ?? this.pin;
    if (dest) {
      const [px, py] = at(dest[0], dest[1]);
      label('📍', px, py - 12, '26px system-ui, sans-serif', '#ff6b6b', 0);
    }
  }

  destroy() {
    this.closeFull();
    this.canvas.remove();
  }
}

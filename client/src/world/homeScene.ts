// Your own home's interior (Phase 5): walk around it, and Decorate mode, a Sims-like grid
// editor: pick furniture you own, place / move / rotate / remove it, undo / redo, see the star
// rating and the top suggestions update live (same maths as the server), then Save. From here
// you can also clean the unit (Airbnb) and fix maintenance requests yourself.
import Phaser from 'phaser';
import { formatMoney, layoutProblem, rateUnit, suggestions, type Placed, type PropSelf, type RatingCfg } from '@kh/shared';
import type { App } from '../app';
import { drawPlaced, furniturePiece } from '../items/furnitureArt';
import { el, toast, uiRoot } from '../ui/dom';
import { iconUrl } from '../ui/panel';
import { loadPrefs } from '../ui/settings';
import { sfx } from '../ui/sound';
import { AVATAR_DEPTH, Avatar } from './avatar';

const C = 40; // px per cell (1 m)
const WALL = 18; // wall thickness in px

export class HomeScene extends Phaser.Scene {
  private app!: App;
  unitId = '';
  private me!: Avatar;
  private pos = { x: 0, y: 0 };
  private dir: 'up' | 'down' | 'left' | 'right' = 'up';
  private W = 7;
  private H = 6;
  private layout: Placed[] = [];
  private furnTex: Phaser.Textures.CanvasTexture | null = null;
  private furnImg: Phaser.GameObjects.Image | null = null;
  private ghost: Phaser.GameObjects.Graphics | null = null;
  private ui: HTMLElement | null = null;
  private side: HTMLElement | null = null;
  private decorating = false;
  private hand: { iid: number; item: string; rot: number } | null = null;
  private hover: { x: number; y: number } | null = null;
  private undo: Placed[][] = [];
  private redo: Placed[][] = [];
  private dirty = false;
  private leaving = false;
  private off: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    super('home');
  }

  init(data: { app: App; unit: string }) {
    this.app = data.app;
    this.unitId = data.unit;
    this.decorating = false;
    this.hand = null;
    this.undo = [];
    this.redo = [];
    this.dirty = false;
    this.leaving = false;
  }

  private get self(): PropSelf | undefined {
    return this.app.store.myProps.find((p) => p.unit === this.unitId);
  }

  private ratingCfg(): RatingCfg {
    const tiers = this.app.cfg.rarities.tiers.map((t) => t.id);
    return { furniture: this.app.cfg.furniture, properties: this.app.cfg.properties, rarityIndex: (id) => Math.max(0, tiers.indexOf(this.app.items.get(id)?.rarity ?? 'common')) };
  }

  create() {
    const s = this.self;
    const t = this.app.cfg.properties.types[s?.type ?? 'studio'];
    this.W = t.w;
    this.H = t.h;
    this.layout = (s?.layout ?? []).map((p) => ({ ...p }));
    const W = this.W * C, H = this.H * C;
    this.add.rectangle(W / 2, H / 2, 40000, 40000, 0x05060c, 0.75).setDepth(-10);
    const g = this.add.graphics().setDepth(-5);
    g.fillStyle(0x000000, 0.45).fillRoundedRect(-WALL - 12, -WALL - 6, W + WALL * 2 + 24, H + WALL * 2 + 22, 16);
    // wooden floor planks
    g.fillStyle(0xd8b384, 1).fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += C / 2) {
      g.fillStyle((y / (C / 2)) % 2 ? 0xcfa874 : 0xd8b384, 1).fillRect(0, y, W, C / 2);
      for (let x = ((y / (C / 2)) % 2) * C; x < W; x += C * 2) g.fillStyle(0xb98f5e, 1).fillRect(x, y, 1, C / 2);
    }
    // walls and the doorway (bottom middle)
    g.fillStyle(0xf1e3d3, 1).fillRect(-WALL, -WALL, W + WALL * 2, WALL).fillRect(-WALL, 0, WALL, H).fillRect(W, 0, WALL, H);
    const d0 = (Math.floor(this.W / 2) - 1) * C, d1 = (Math.floor(this.W / 2) + 1) * C;
    g.fillRect(-WALL, H, d0 + WALL, WALL).fillRect(d1, H, W - d1 + WALL, WALL);
    g.fillStyle(0x8c5a3c, 1).fillRect(d0 + 6, H - 10, d1 - d0 - 12, 10);
    // grid lines (only shown while decorating)
    this.gridG = this.add.graphics().setDepth(-4).setVisible(false);
    this.gridG.lineStyle(1, 0xffffff, 0.25);
    for (let x = 0; x <= this.W; x++) this.gridG.lineBetween(x * C, 0, x * C, H);
    for (let y = 0; y <= this.H; y++) this.gridG.lineBetween(0, y * C, W, y * C);

    this.furnTex = this.textures.createCanvas(`home_${Date.now()}`, W, H);
    this.furnImg = this.add.image(0, 0, this.furnTex!.key).setOrigin(0).setDepth(AVATAR_DEPTH - 1);
    this.ghost = this.add.graphics().setDepth(AVATAR_DEPTH + 10_000);
    this.redraw();

    const you = this.app.lastInit!.you;
    this.pos = { x: W / 2, y: H - C * 0.6 };
    this.me = new Avatar(this, this.app.cfg.character, this.app.items, {
      name: you.name, level: this.app.store.progress.level, appearance: you.appearance, x: this.pos.x, y: this.pos.y, isSelf: true,
      cosmetics: this.app.town?.selfCosmetics ?? you.cosmetics, particles: loadPrefs().particles,
    });
    this.me.setState('up', false);
    this.add
      .text(W / 2, -WALL - 6, `🏠 ${this.app.cfg.properties.types[s?.type ?? 'studio'].name}`, { fontFamily: 'system-ui, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#ffffff', stroke: '#11131f', strokeThickness: 5, resolution: 3 })
      .setOrigin(0.5, 1)
      .setDepth(999_000);
    this.fit();
    this.buildUi();
    this.off = this.app.store.on(() => this.refreshUi());

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointer(p, false));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointer(p, true));
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.decorating) return;
      if (e.key === 'r' || e.key === 'R') this.rotate();
      else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) this.doUndo();
      else if ((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey)) this.doRedo();
      else if (e.key === 'Delete' || e.key === 'Backspace') this.dropHand();
    };
    window.addEventListener('keydown', this.keyHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.off?.();
      if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
      this.ui?.remove();
      this.side?.remove();
      this.me?.destroy();
      if (this.furnTex) this.textures.remove(this.furnTex.key);
    });
  }
  private gridG!: Phaser.GameObjects.Graphics;

  fit() {
    const cam = this.cameras?.main;
    if (!cam) return; // the scene has shut down (left it, or not built yet)
    cam.setSize(this.scale.width, this.scale.height);
    const W = this.W * C + WALL * 2 + 40, H = this.H * C + WALL * 2 + 80;
    // Leave room for the side panel while decorating on wide screens.
    const avail = this.decorating && innerWidth > innerHeight ? 0.58 : 0.92;
    const zoom = Math.min((this.scale.width * avail) / W, (this.scale.height * 0.74) / H);
    cam.setZoom(Math.min(zoom, 3 * this.app.dpr));
    const shift = this.decorating && innerWidth > innerHeight ? (this.scale.width * 0.2) / cam.zoom : 0;
    cam.centerOn((this.W * C) / 2 + shift, (this.H * C) / 2 - 10);
  }

  private redraw() {
    const tex = this.furnTex!;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, tex.width, tex.height);
    // floor pieces (rugs) first, then the rest, wall items last
    const order = (p: Placed) => (furniturePiece(p.item)?.floor ? 0 : furniturePiece(p.item)?.wall ? 2 : 1);
    for (const p of [...this.layout].sort((a, b) => order(a) - order(b))) drawPlaced(ctx, p.item, p.x, p.y, p.rot, C);
    tex.refresh();
  }

  // ---------------------------------------------------------------- walking
  private solidAt(px: number, py: number) {
    const cx = Math.floor(px / C), cy = Math.floor(py / C);
    for (const p of this.layout) {
      const f = furniturePiece(p.item);
      if (!f || f.floor || f.wall) continue;
      const [w, h] = p.rot % 2 ? [f.h, f.w] : [f.w, f.h];
      if (cx >= p.x && cx < p.x + w && cy >= p.y && cy < p.y + h) return true;
    }
    return false;
  }

  override update(_t: number, delta: number) {
    if (this.leaving) return;
    const dt = Math.min(delta, 100) / 1000;
    let { x: vx, y: vy } = this.decorating ? { x: 0, y: 0 } : this.app.inputVector();
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }
    const moving = len > 0.01;
    const W = this.W * C, H = this.H * C;
    if (moving) {
      this.dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
      const sp = this.app.cfg.movement.walkSpeed * 0.8;
      const nx = Math.max(10, Math.min(W - 10, this.pos.x + vx * sp * dt));
      const inDoor = Math.abs(this.pos.x - W / 2) < C - 8;
      const ny = Math.max(12, Math.min(inDoor ? H + 20 : H - 4, this.pos.y + vy * sp * dt));
      if (!this.solidAt(nx, this.pos.y - 4)) this.pos.x = nx;
      if (!this.solidAt(this.pos.x, ny - 4)) this.pos.y = ny;
      this.me.setPosition(this.pos.x, this.pos.y);
      if (this.pos.y > H + 12) return this.leave();
    }
    this.me.setState(this.dir, moving);
    this.me.tick(performance.now());
  }

  // ---------------------------------------------------------------- decorating
  private onPointer(p: Phaser.Input.Pointer, down: boolean) {
    if (!this.decorating) return;
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    const cx = Math.floor(wp.x / C), cy = Math.floor(wp.y / C);
    this.hover = { x: cx, y: cy };
    if (!down) return this.drawGhost();
    if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return;
    if (this.hand) this.place(cx, cy);
    else {
      // Pick up the piece under the pointer (top-most: wall, then normal, then rugs).
      const hit = [...this.layout].reverse().sort((a, b) => (furniturePiece(b.item)?.floor ? -1 : 0) - (furniturePiece(a.item)?.floor ? -1 : 0)).find((pl) => {
        const f = furniturePiece(pl.item);
        if (!f) return false;
        const [w, h] = pl.rot % 2 ? [f.h, f.w] : [f.w, f.h];
        return cx >= pl.x && cx < pl.x + w && cy >= pl.y && cy < pl.y + h;
      });
      if (hit) {
        this.snapshot();
        this.layout = this.layout.filter((x) => x.iid !== hit.iid);
        this.hand = { iid: hit.iid, item: hit.item, rot: hit.rot };
        this.changed();
      }
    }
  }

  private footprint(item: string, rot: number): [number, number] {
    const f = furniturePiece(item)!;
    return rot % 2 ? [f.h, f.w] : [f.w, f.h];
  }

  private drawGhost() {
    const g = this.ghost!;
    g.clear();
    if (!this.decorating || !this.hand || !this.hover) return;
    const [w, h] = this.footprint(this.hand.item, this.hand.rot);
    const x = Math.max(0, Math.min(this.W - w, this.hover.x)), y = Math.max(0, Math.min(this.H - h, this.hover.y));
    const ok = !layoutProblem(this.ratingCfg(), { w: this.W, h: this.H }, [...this.layout, { ...this.hand, x, y }]);
    g.fillStyle(ok ? 0x51cf66 : 0xff6b6b, 0.35).fillRect(x * C, y * C, w * C, h * C);
    g.lineStyle(2, ok ? 0x51cf66 : 0xff6b6b, 1).strokeRect(x * C, y * C, w * C, h * C);
  }

  private place(cx: number, cy: number) {
    const hand = this.hand!;
    const [w, h] = this.footprint(hand.item, hand.rot);
    const x = Math.max(0, Math.min(this.W - w, cx)), y = Math.max(0, Math.min(this.H - h, cy));
    const next = [...this.layout, { iid: hand.iid, item: hand.item, x, y, rot: hand.rot }];
    const problem = layoutProblem(this.ratingCfg(), { w: this.W, h: this.H }, next);
    if (problem) {
      sfx.error();
      return void toast(problem, 'bad');
    }
    this.snapshot();
    this.layout = next;
    this.hand = null;
    sfx.click();
    this.changed();
  }

  private rotate() {
    if (!this.hand) return;
    this.hand.rot = (this.hand.rot + 1) % 4;
    this.drawGhost();
  }

  /** Put what's in your hand back in the box (it stays in your inventory). */
  private dropHand() {
    if (!this.hand) return;
    this.hand = null;
    this.changed();
  }

  private snapshot() {
    this.undo.push(this.layout.map((p) => ({ ...p })));
    if (this.undo.length > 50) this.undo.shift();
    this.redo = [];
  }

  private doUndo() {
    const prev = this.undo.pop();
    if (!prev) return;
    this.redo.push(this.layout);
    this.layout = prev;
    this.hand = null;
    this.changed();
  }

  private doRedo() {
    const next = this.redo.pop();
    if (!next) return;
    this.undo.push(this.layout);
    this.layout = next;
    this.hand = null;
    this.changed();
  }

  private changed() {
    this.dirty = true;
    this.redraw();
    this.drawGhost();
    this.refreshUi();
  }

  private setDecorating(on: boolean) {
    this.decorating = on;
    this.gridG.setVisible(on);
    this.side?.classList.toggle('hidden', !on);
    this.hand = null;
    this.drawGhost();
    this.fit();
    this.refreshUi();
  }

  private save() {
    this.app.socket?.timeout(6000).emit('prop:layout', { unit: this.unitId, layout: this.layout }, (err, res) => {
      if (err || !res.ok) {
        sfx.error();
        return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      this.dirty = false;
      sfx.chime();
      toast(`💾 Saved! ${res.stars.toFixed(1)}★`, 'good');
      this.refreshUi();
    });
  }

  // ---------------------------------------------------------------- the DOM side
  private buildUi() {
    const bar = el('div', { class: 'home-bar' });
    this.ui = bar;
    this.side = el('div', { class: 'decorate-panel hidden', 'data-testid': 'decorate-panel' });
    uiRoot().append(bar, this.side);
    this.refreshUi();
  }

  /** Free furniture: owned, not placed here (in the editor) or in another home. */
  private freeFurniture() {
    const elsewhere = new Set<number>();
    for (const p of this.app.store.myProps) if (p.unit !== this.unitId) for (const pl of p.layout) elsewhere.add(pl.iid);
    const here = new Set(this.layout.map((p) => p.iid));
    if (this.hand) here.add(this.hand.iid);
    return this.app.store.inventory.filter((i) => furniturePiece(i.itemId) && !elsewhere.has(i.iid) && !here.has(i.iid));
  }

  private refreshUi() {
    const s = this.self;
    if (!this.ui || !s) return;
    const btn = (label: string, fn: () => void, cls = 'btn', attrs: Record<string, string> = {}) => {
      const b = el('button', { class: cls, type: 'button', ...attrs }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const work = s.work ? Math.max(0, (s.work.at + (s.work.kind === 'clean' ? this.app.cfg.properties.airbnb.cleanMs : this.app.cfg.properties.rent.diyMs) - this.app.store.serverNow()) / 1000) : 0;
    const tools: HTMLElement[] = [
      btn(this.decorating ? '✅ Done' : '🛠️ Decorate', () => this.setDecorating(!this.decorating), this.decorating ? 'btn primary' : 'btn', { 'data-action': 'decorate' }),
    ];
    if (s.mode === 'airbnb' && s.cleanliness < 100) tools.push(btn(`🧽 Clean (${Math.round(s.cleanliness)}%)`, () => this.work('clean'), 'btn', { 'data-action': 'clean' }));
    for (const r of s.requests) tools.push(btn(`🔧 Fix: ${r.text}`, () => this.work('diy', r.id), 'btn'));
    if (work > 0) tools.push(el('span', { class: 'muted' }, `⏳ ${work.toFixed(0)} s…`));
    tools.push(btn('🚪 Leave', () => this.leave(), 'btn', { 'data-testid': 'home-exit' }));
    this.ui.replaceChildren(...tools);
    if (!this.decorating || !this.side) return;

    const cfg = this.ratingCfg();
    const t = this.app.cfg.properties.types[s.type];
    const r = rateUnit(cfg, { w: t.w, h: t.h }, this.layout, s.cleanliness);
    const free = this.freeFurniture();
    const sugg = suggestions(cfg, { w: t.w, h: t.h, type: s.type, loc: s.loc }, this.layout, s.cleanliness, free.map((i) => i.itemId));
    const bar = (label: string, v: number) => {
      const b = el('div', { class: 'progress' }, el('i', {}));
      (b.firstChild as HTMLElement).style.width = `${Math.round(v * 100)}%`;
      return el('div', { class: 'factor' }, el('span', {}, label), b);
    };
    const counts = new Map<string, { item: string; iids: number[] }>();
    for (const i of free) {
      const c = counts.get(i.itemId) ?? { item: i.itemId, iids: [] };
      c.iids.push(i.iid);
      counts.set(i.itemId, c);
    }
    const pieces = [...counts.values()].map((c) => {
      const def = this.app.items.get(c.item);
      const b = el('button', { class: `deco-piece${this.hand?.item === c.item ? ' active' : ''}`, type: 'button', 'data-piece': c.item, title: def?.name ?? c.item }, el('img', { src: def ? iconUrl(def, 'normal', 48) : '', alt: '' }), el('span', {}, `${def?.name ?? c.item}${c.iids.length > 1 ? ` ×${c.iids.length}` : ''}`));
      b.addEventListener('click', () => {
        this.hand = { iid: c.iids[0], item: c.item, rot: 0 };
        this.drawGhost();
        this.refreshUi();
      });
      return b;
    });
    this.side.replaceChildren(
      el('div', { class: 'deco-stars', 'data-testid': 'deco-stars' }, `${'★'.repeat(Math.floor(r.stars))}${r.stars % 1 >= 0.5 ? '½' : ''} ${r.stars.toFixed(1)}`),
      ...(r.missing.length ? [el('div', { class: 'deco-missing' }, `Missing: ${r.missing.join(', ')} (caps the stars)`)] : []),
      bar('Comfort', r.factors.comfort), bar('Style & theme', r.factors.style), bar('Rarity', r.factors.rarity),
      bar('Amenities', r.factors.amenities), bar('Cleanliness', r.factors.clean), bar(r.blocked ? 'Space (walkway blocked!)' : 'Space', r.factors.space),
      el('h4', {}, '💡 Suggestions'),
      ...(sugg.length ? sugg.map((x) => el('div', { class: 'deco-sugg' }, `${x.text} → +${x.gain.toFixed(1)}★${x.nightGainSen > 0 ? `, +${formatMoney(x.nightGainSen)}/night` : ''}`)) : [el('div', { class: 'muted' }, 'Looking good!')]),
      el('h4', {}, `🛋️ Your furniture (${free.length})`),
      el('div', { class: 'deco-pieces' }, ...(pieces.length ? pieces : [el('p', { class: 'muted small' }, `Nothing to place. Buy at ${this.app.cfg.furniture.storeName} or win some from the Mall Mystery Box.`)])),
      el('p', { class: 'muted small' }, this.hand ? `Placing: tap the floor. R rotates, Del puts it back. ${this.app.touch ? '' : 'Ctrl+Z undo.'}` : 'Tap a piece above to place it, or tap furniture in the room to move it.'),
      el(
        'div',
        { class: 'actions' },
        btn('↶ Undo', () => this.doUndo(), 'btn small'),
        btn('↷ Redo', () => this.doRedo(), 'btn small'),
        ...(this.hand ? [btn('⟳ Rotate', () => this.rotate(), 'btn small')] : []),
        btn(this.dirty ? '💾 Save' : '✓ Saved', () => this.save(), this.dirty ? 'btn primary' : 'btn', { 'data-action': 'save-layout' }),
      ),
    );
  }

  /** Cleaning / a DIY repair: start, wait it out (you're "working"), then finish. */
  private work(kind: 'clean' | 'diy', req?: number) {
    const done = (err: unknown, res: { ok: boolean; error?: string; doneAt?: number }) => {
      if (err || !res.ok) return void toast(err ? 'No response.' : (res.error ?? ''), 'bad');
      const wait = Math.max(0, (res.doneAt ?? 0) - this.app.store.serverNow()) + 400;
      toast(kind === 'clean' ? '🧽 Cleaning…' : '🔧 Fixing…', 'info', wait);
      this.me.playEmote('dance', { emoji: kind === 'clean' ? '🧽' : '🔧', loop: true, durationMs: wait }, loadPrefs().particles);
      this.time.delayedCall(wait, () => {
        const fin = (e2: unknown, r2: { ok: boolean; error?: string }) => {
          this.me.stopEmote();
          if (e2 || !r2.ok) return void toast(e2 ? 'No response.' : (r2.error ?? ''), 'bad');
          sfx.chime();
          toast(kind === 'clean' ? '✨ Sparkling clean!' : '✅ Fixed!', 'good');
        };
        if (kind === 'clean') this.app.socket?.timeout(5000).emit('prop:clean', { unit: this.unitId, phase: 'finish' }, fin as never);
        else this.app.socket?.timeout(5000).emit('prop:fix', { unit: this.unitId, req: req!, how: 'diy-finish' }, fin as never);
      });
    };
    if (kind === 'clean') this.app.socket?.timeout(5000).emit('prop:clean', { unit: this.unitId, phase: 'start' }, done as never);
    else this.app.socket?.timeout(5000).emit('prop:fix', { unit: this.unitId, req: req!, how: 'diy-start' }, done as never);
  }

  leave() {
    if (this.leaving) return;
    if (this.dirty && !confirm('Leave without saving your decorating?')) return;
    this.leaving = true;
    this.app.exitBuilding();
  }

  debugInfo() {
    return { unit: this.unitId, layout: this.layout, decorating: this.decorating, hand: this.hand, dirty: this.dirty };
  }
  /** Tests: place a piece by iid at a cell without the pointer. */
  debugPlace(iid: number, item: string, x: number, y: number, rot = 0) {
    this.hand = { iid, item, rot };
    this.place(x, y);
  }
}

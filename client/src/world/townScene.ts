// The outdoor town. The local player is predicted client-side (instant response) and
// reported to the server ~15×/s; other players are rendered ~110 ms in the past and
// interpolated between server snapshots so they move smoothly despite network jitter.
import Phaser from 'phaser';
import {
  DIRECTIONS, districtAt, gridIndexAt, moveWithCollision, vehicleSpeedGrid, formatMoney, manifestRateSen,
  type BuiltBuilding, type BuiltMap, type ChatMsg, type Direction, type InitPayload, type PlayerPublic, type ServerToClientEvents, type SnapshotPayload,
} from '@kh/shared';
import type { App } from '../app';
import { toast } from '../ui/dom';
import { loadPrefs } from '../ui/settings';
import { Avatar } from './avatar';
import { MapView } from './mapRenderer';
import { StallLayer } from './stallLayer';

interface Sample {
  t: number;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
}
interface Remote {
  id: number;
  name: string;
  avatar: Avatar;
  samples: Sample[];
}

/** Position at time t from a buffer of timed samples (drops samples that are too old). */
function interpolate(s: Sample[], t: number): Sample | null {
  while (s.length >= 2 && s[1].t <= t) s.shift();
  if (!s.length) return null;
  if (s.length < 2 || s[0].t > t) return s[0];
  const k = (t - s[0].t) / Math.max(1, s[1].t - s[0].t);
  return { t, x: s[0].x + (s[1].x - s[0].x) * k, y: s[0].y + (s[1].y - s[0].y) * k, dir: s[1].dir, moving: s[1].moving || s[0].moving };
}

export class TownScene extends Phaser.Scene {
  private app!: App;
  private initData!: InitPayload;
  private me!: Avatar;
  private remotes = new Map<number, Remote>();
  /** Our own positions from the server while a Ronda drives us. */
  private selfSamples: Sample[] = [];
  private mapView!: MapView;
  private pos = { x: 0, y: 0 };
  private dir: Direction = 'down';
  private moving = false;
  private seq = 0;
  private lastSent = { x: NaN, y: NaN, dir: 'down' as Direction, moving: false };
  private sendAcc = 0;
  private slowAcc = 0;
  private districtAcc = 0;
  private manifestAcc = 0;
  private districtId = '';
  private doorIndex = new Map<number, BuiltBuilding>();
  private nearBuilding: BuiltBuilding | null = null;
  private nearInteract: BuiltMap['interactables'][number] | null = null;
  private nearPlot: BuiltMap['stallPlots'][number] | null = null;
  private stalls!: StallLayer;
  private marker: Phaser.GameObjects.Container | null = null;
  private vehicleSpeed: Float32Array = new Float32Array(0);
  private offs: Array<() => void> = [];

  constructor() {
    super('town');
  }

  init(data: { app: App; init: InitPayload }) {
    this.app = data.app;
    this.initData = data.init;
    this.remotes = new Map();
    this.offs = [];
    this.districtId = '';
    this.lastSent = { x: NaN, y: NaN, dir: 'down', moving: false };
  }

  /** Camera zoom for the current screen size. The canvas is in DEVICE pixels (sharp on phones),
   *  so the zoom includes the device pixel ratio. */
  private zoomFor() {
    const dpr = this.app.dpr;
    return Phaser.Math.Clamp(Math.min(this.scale.width, this.scale.height) / dpr / 620, 0.6, 1.4) * dpr;
  }

  /** Map chunk resolution: about one texel per screen pixel (capped for memory). */
  private chunkRes() {
    return Math.min(2.5, Math.max(1, Math.round(this.zoomFor() * 2) / 2));
  }
  private mapRes = 1;

  /** The canvas changed size (window resize / fullscreen): fit the camera and recentre on us. */
  onViewportResize(w: number, h: number) {
    const cam = this.cameras.main;
    cam.setSize(w, h);
    cam.setZoom(this.zoomFor());
    cam.centerOn(this.pos.x, this.pos.y);
    // Zoomed in more than the chunks were drawn for: redraw them sharper (and the other way round).
    const res = this.chunkRes();
    if (res !== this.mapRes) {
      this.mapRes = res;
      this.mapView.destroy();
      this.stalls.destroy();
      this.mapView = new MapView(this, this.app.map, res);
    }
    this.mapView.update(cam.worldView, true);
  }

  get selfId() {
    return this.initData.you.id;
  }

  create() {
    const { map, cfg } = this.app;
    const T = map.tileSize;
    this.mapRes = this.chunkRes();
    this.mapView = new MapView(this, map, this.mapRes);
    // World coordinates are relative to the fixed origin (Menara Mitraland), so bounds can be negative.
    this.cameras.main.setBounds(map.originTx * T, map.originTy * T, map.width * T, map.height * T);
    this.cameras.main.setBackgroundColor('#7cc456');

    const you = this.initData.you;
    this.pos = { x: you.x, y: you.y };
    this.dir = you.dir;
    const particles = loadPrefs().particles;
    this.me = new Avatar(this, cfg.character, this.app.items, {
      name: you.name, level: you.level, appearance: you.appearance, x: you.x, y: you.y, isSelf: true,
      cosmetics: you.cosmetics, vehicle: you.vehicle, particles, title: this.titleInfo(you.title),
    });

    this.vehicleSpeed = vehicleSpeedGrid(this.app.map, cfg.terrain);
    this.createInteractableLabels();
    this.stalls = new StallLayer(this, this.app);
    this.offs.push(this.app.store.on(() => this.stalls.sync()));
    this.me.setState(you.dir, false);
    for (const p of this.initData.players) this.addRemote(p);

    this.cameras.main.startFollow(this.me.container, true, 0.18, 0.18);
    this.cameras.main.setRoundPixels(true);
    this.cameras.main.setZoom(this.zoomFor());

    // Door lookup: the tile in front of each door, plus its neighbours.
    for (const b of map.buildings) {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!b.door) continue;
          const i = gridIndexAt(map, (b.door.frontX + dx + 0.5) * T, (b.door.frontY + dy + 0.5) * T);
          if (i < 0) continue;
          const existing = this.doorIndex.get(i);
          if (!existing || (dx === 0 && dy === 0) || (!existing.name && b.name)) this.doorIndex.set(i, b);
        }
    }

    // --- network events ---
    const sock = this.app.socket!;
    const on = <E extends keyof ServerToClientEvents>(event: E, fn: ServerToClientEvents[E]) => {
      sock.on(event, fn as never);
      this.offs.push(() => sock.off(event, fn as never));
    };
    on('player:joined', (p: PlayerPublic) => {
      if (p.id !== this.selfId) this.addRemote(p);
    });
    on('player:left', ({ id }: { id: number }) => {
      this.remotes.get(id)?.avatar.destroy();
      this.remotes.delete(id);
    });
    on('player:updated', ({ id, appearance, cosmetics, vehicle, level, title }) => {
      const av = id === this.selfId ? this.me : this.remotes.get(id)?.avatar;
      if (!av) return;
      if (level !== undefined) av.setLevel(level);
      if (title !== undefined) av.setTitle(this.titleInfo(title));
      if (cosmetics) av.setCosmetics(cosmetics);
      if (appearance) av.setAppearance(appearance);
      if (vehicle !== undefined) {
        av.setVehicle(vehicle);
        if (id === this.selfId) {
          this.app.store.riding = vehicle;
          this.selfSamples = [];
          this.app.store.emit();
        }
      }
    });
    on('snapshot', (s: SnapshotPayload) => this.onSnapshot(s));
    on('move:correct', ({ x, y }) => {
      this.selfSamples = [];
      this.pos = { x, y };
      this.me.setPosition(x, y);
      this.lastSent = { x, y, dir: this.dir, moving: false };
    });
    on('chat:msg', (m: ChatMsg) => {
      this.app.chat?.add(m);
      if (m.fromId === null) return;
      const av = m.fromId === this.selfId ? this.me : this.remotes.get(m.fromId)?.avatar;
      av?.say(m.text, cfg.chat.bubbleMs);
    });
    on('emote:played', ({ id, emote }) => {
      const av = id === this.selfId ? this.me : this.remotes.get(id)?.avatar;
      const def = cfg.chat.emotes.find((e) => e.id === emote);
      if (!av || !def) return;
      av.playEmote(emote, def, loadPrefs().particles);
      if (id === this.selfId) this.app.onOwnEmote(def.loop ? emote : null);
    });
    on('emote:stopped', ({ id }) => {
      const av = id === this.selfId ? this.me : this.remotes.get(id)?.avatar;
      av?.stopEmote();
      if (id === this.selfId) this.app.onOwnEmote(null);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.offs) off();
      this.mapView.destroy();
      this.offs = [];
      for (const r of this.remotes.values()) r.avatar.destroy();
      this.remotes.clear();
    });
    // Draw the chunks around the spawn point right away so the first frame isn't empty.
    this.cameras.main.centerOn(this.pos.x, this.pos.y);
    this.cameras.main.preRender();
    this.mapView.update(this.cameras.main.worldView, true);
    this.app.onTownReady(this);
  }

  /** A title id → the text and rarity colour drawn over a head. */
  titleInfo(id: string | null): { name: string; color: string } | null {
    const t = id ? this.app.cfg.titles.titles.find((x) => x.id === id) : undefined;
    if (!t) return null;
    return { name: t.name, color: this.app.cfg.rarities.tiers.find((r) => r.id === t.rarity)?.color ?? '#ffffff' };
  }

  private addRemote(p: PlayerPublic) {
    if (this.remotes.has(p.id)) return;
    const avatar = new Avatar(this, this.app.cfg.character, this.app.items, {
      name: p.name, level: p.level, appearance: p.appearance, x: p.x, y: p.y, isSelf: false,
      cosmetics: p.cosmetics, vehicle: p.vehicle, particles: loadPrefs().particles, title: this.titleInfo(p.title),
    });
    avatar.setState(p.dir, p.moving);
    // Someone who was already sitting/sleeping/dancing when we joined.
    const loopDef = p.emote ? this.app.cfg.chat.emotes.find((e) => e.id === p.emote && e.loop) : undefined;
    if (loopDef) avatar.playEmote(loopDef.id, loopDef, loadPrefs().particles);
    this.remotes.set(p.id, { id: p.id, name: p.name, avatar, samples: [{ t: performance.now(), x: p.x, y: p.y, dir: p.dir, moving: p.moving }] });
  }

  private onSnapshot(s: SnapshotPayload) {
    const now = performance.now();
    for (const [id, x, y, dirIdx, moving] of s.p) {
      if (id === this.selfId) {
        // As a Ronda passenger the server drives us: follow its positions like a remote player.
        if (this.isPassenger()) {
          this.selfSamples.push({ t: now, x, y, dir: DIRECTIONS[dirIdx] ?? 'down', moving: moving === 1 });
          if (this.selfSamples.length > 30) this.selfSamples.splice(0, this.selfSamples.length - 30);
        }
        continue;
      }
      const r = this.remotes.get(id);
      if (!r) continue;
      r.samples.push({ t: now, x, y, dir: DIRECTIONS[dirIdx] ?? 'down', moving: moving === 1 });
      if (r.samples.length > 30) r.samples.splice(0, r.samples.length - 30);
    }
  }

  /** Called by the HUD's interact button / E key. */
  interact() {
    if (this.nearPlot) {
      this.app.openStallAt(this.nearPlot.id);
      return;
    }
    if (this.nearInteract) {
      this.app.openInteractable(this.nearInteract);
      return;
    }
    const b = this.nearBuilding;
    if (!b) {
      toast('Nothing to interact with here.');
      return;
    }
    toast(`🚧 ${b.name ?? 'This building'}: interiors open in a later phase!`);
  }

  override update(_time: number, delta: number) {
    const { map, cfg } = this.app;
    const now = performance.now();
    const dt = Math.min(delta, 100) / 1000;

    // --- Ronda passenger: the server moves us along the route ---
    if (this.isPassenger()) {
      const p = interpolate(this.selfSamples, now - cfg.net.interpolationDelayMs);
      if (p) {
        this.pos = { x: p.x, y: p.y };
        this.dir = p.dir;
        this.me.setPosition(p.x, p.y);
        this.me.setState(p.dir, p.moving);
        this.lastSent = { x: p.x, y: p.y, dir: p.dir, moving: false };
      }
      this.me.tick(now);
      this.updateRemotes(now);
      this.stalls.update(delta);
      this.mapView.update(this.cameras.main.worldView);
      this.updateDecks(delta);
      this.slowChecks(delta);
      return;
    }

    // --- local movement (client prediction) ---
    let { x: vx, y: vy } = this.app.inputVector();
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }
    const moving = len > 0.01;
    if (moving) {
      this.dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
      const v = this.me.vehicle ? cfg.vehicles.vehicles[this.me.vehicle] : undefined;
      if (v) {
        // Riding: top speed × the terrain's vehicle multiplier (grass is slow, roads are fast).
        const i = gridIndexAt(map, this.pos.x, this.pos.y - 2);
        const mult = Math.max(v.minTerrainMult, i >= 0 ? this.vehicleSpeed[i] : 0.4);
        const speed = v.speed * mult;
        const grid = v.grid === 'drive' ? map.driveCollision : map.collision;
        this.pos = moveWithCollision(grid, this.pos.x, this.pos.y, vx * speed * dt, vy * speed * dt, v.hitbox);
      } else {
        const speed = cfg.movement.walkSpeed * this.app.mods().walk; // Kaki Lari skill (the server allows the same)
        this.pos = moveWithCollision(map.collision, this.pos.x, this.pos.y, vx * speed * dt, vy * speed * dt, cfg.movement.hitbox);
      }
      this.me.setPosition(this.pos.x, this.pos.y);
    }
    if (moving && !this.moving && this.me.currentEmote) this.app.onOwnEmote(null); // walking ends our emote
    this.moving = moving;
    this.me.setState(this.dir, moving);
    this.me.tick(now);

    // --- manifesting: show what we earn each second (the server pays it out) ---
    this.manifestAcc += delta;
    if (this.manifestAcc >= 1000) {
      this.manifestAcc = 0;
      if (this.app.ownEmote === 'manifest' && !this.moving && !this.me.vehicle) {
        const rate = manifestRateSen(cfg.upgrades, this.app.store.skills) * this.app.mods().passive;
        this.me.floatText(`+RM ${(rate / 100).toFixed(2)}`);
      }
    }

    // --- report position to the server ---
    this.sendAcc += delta;
    if (this.sendAcc >= 1000 / cfg.movement.sendRateHz) {
      this.sendAcc = 0;
      const ls = this.lastSent;
      if (ls.x !== this.pos.x || ls.y !== this.pos.y || ls.dir !== this.dir || ls.moving !== this.moving) {
        this.app.socket?.emit('move', { x: this.pos.x, y: this.pos.y, dir: this.dir, moving: this.moving, seq: ++this.seq });
        this.lastSent = { x: this.pos.x, y: this.pos.y, dir: this.dir, moving: this.moving };
      }
    }

    this.updateRemotes(now);
    this.stalls.update(delta);
    this.mapView.update(this.cameras.main.worldView);
    this.updateDecks(delta);

    this.slowChecks(delta);
  }

  /** Under a flyover the deck turns see-through; riding on it you're drawn on top. */
  private updateDecks(delta: number) {
    const onDeck = this.ridesOnDeck(this.me);
    this.me.setOnDeck(onDeck);
    this.mapView.fadeDecks(!onDeck && this.mapView.overheadAt(this.pos.x, this.pos.y - 2), delta);
  }

  /** Doors, interact prompts, the job marker, district name and the minimap (~7×/s). */
  private slowChecks(delta: number) {
    const { map, cfg } = this.app;
    // --- slower checks: doors, district, minimap ---
    this.slowAcc += delta;
    if (this.slowAcc >= 150) {
      this.slowAcc = 0;
      const tx = Math.floor(this.pos.x / map.tileSize);
      const ty = Math.floor((this.pos.y - 4) / map.tileSize);
      const b = this.doorIndex.get(gridIndexAt(map, this.pos.x, this.pos.y - 4)) ?? null;
      // Interactables (crates, Jobs Board, pawn shop) take priority over plain doors.
      const radius = cfg.economy.interactRadiusTiles - 1;
      let it: (typeof map.interactables)[number] | null = null;
      let best = radius;
      for (const c of map.interactables) {
        const d = Math.hypot(this.pos.x / map.tileSize - c.x, this.pos.y / map.tileSize - c.y);
        if (d < best) {
          best = d;
          it = c;
        }
      }
      // Stall plots: your own stall wins from further away; others when you're right there.
      const myPlot = this.app.store.stall?.plot;
      let plot = this.stalls.nearest(this.pos.x, this.pos.y, 4);
      const mine = myPlot ? map.stallPlots.find((p) => p.id === myPlot) : undefined;
      if (mine && Math.hypot(this.pos.x / map.tileSize - mine.x, this.pos.y / map.tileSize - mine.y) <= cfg.stalls.cookRadiusTiles - 1) plot = mine;
      if (plot && it && Math.hypot(this.pos.x / map.tileSize - it.x, this.pos.y / map.tileSize - it.y) < Math.hypot(this.pos.x / map.tileSize - plot.x, this.pos.y / map.tileSize - plot.y) && plot !== mine) plot = null;
      if (it !== this.nearInteract || b !== this.nearBuilding || plot !== this.nearPlot) {
        this.nearInteract = it;
        this.nearBuilding = b;
        this.nearPlot = plot;
        let prompt: string | null = null;
        if (plot) {
          const s = this.app.store.stalls.get(plot.id);
          prompt = !s ? `${cfg.stalls.tiers.find((t) => t.tier === plot.tier)?.name ?? 'Stall'} spot (free)` : plot === mine ? '🍳 Your stall' : `${s.ownerName}'s stall`;
        } else if (it) {
          const crate = it.crate ? this.app.crates.get(it.crate) : undefined;
          prompt = crate ? `${it.name} (${formatMoney(crate.priceSen)})` : it.name;
        } else if (b) prompt = `Enter ${b.name ?? (b.kind === 'terrace' || b.kind === 'semid' || b.kind === 'bungalow' ? 'house' : 'shop')}`;
        this.app.hud?.setPrompt(prompt, this.app.touch);
      }
      // Delivery target marker + objective HUD.
      const job = this.app.store.job;
      const target = job?.kind === 'delivery' ? (job.stage === 'pickup' ? job.pickup : job.dropoff) : null;
      this.updateMarker(target);
      const cam = this.cameras.main;
      const dpr = this.app.dpr; // camera numbers are in device pixels; the DOM HUD uses CSS pixels
      this.app.jobHud?.update(this.pos.x, this.pos.y, { x: cam.worldView.x, y: cam.worldView.y, zoom: cam.zoom / dpr, cx: cam.width / 2 / dpr, cy: cam.height / 2 / dpr });
      this.app.minimap?.update([
        { x: this.pos.x, y: this.pos.y, name: this.initData.you.name, self: true },
        ...(target ? [{ x: target.x * map.tileSize, y: target.y * map.tileSize, name: '🎯', target: true }] : []),
        ...(mine ? [{ x: mine.x * map.tileSize, y: mine.y * map.tileSize, name: 'Your stall', stall: true }] : []),
        ...[...this.remotes.values()].map((r) => ({ x: r.avatar.x, y: r.avatar.y, name: r.name })),
      ]);
      this.districtAcc += 150;
      if (this.districtAcc >= 600) {
        this.districtAcc = 0;
        const d = districtAt(map, tx, ty);
        if (d && d.id !== this.districtId) {
          this.app.hud?.setDistrict(d.name, this.districtId !== '');
          this.districtId = d.id;
        }
      }
    }
  }

  /** Remote players: interpolate between snapshots, a little in the past. */
  private updateRemotes(now: number) {
    const renderT = now - this.app.cfg.net.interpolationDelayMs;
    for (const r of this.remotes.values()) {
      const p = interpolate(r.samples, renderT);
      if (!p) continue;
      r.avatar.setOnDeck(this.ridesOnDeck(r.avatar));
      r.avatar.setPosition(p.x, p.y);
      r.avatar.setState(p.dir, p.moving);
      r.avatar.tick(now);
    }
  }

  /** Drive-grid vehicles (motorbike, Ronda) ride ON elevated decks; walkers and bicycles go under. */
  private ridesOnDeck(av: Avatar): boolean {
    const v = av.vehicle ? this.app.cfg.vehicles.vehicles[av.vehicle] : undefined;
    return !!v && v.grid === 'drive' && this.mapView.overheadAt(av.x, av.y - 2);
  }

  /** Riding a Ronda (someone else is driving)? */
  isPassenger(): boolean {
    const v = this.me?.vehicle;
    return !!v && !!this.app.cfg.vehicles.vehicles[v]?.passenger;
  }

  /** Camera shake for big rolls (0..1). */
  shake(intensity: number) {
    this.cameras.main.shake(250 + intensity * 450, 0.004 + intensity * 0.012);
  }

  /** Floating labels above crate machines, the Jobs Board, the pawn shop and the car wash. */
  private createInteractableLabels() {
    const T = this.app.map.tileSize;
    const icon: Record<string, string> = { jobs: '📋', pawn: '🏪', crate: '🎰', carwash: '🚿' };
    for (const it of this.app.map.interactables) {
      if (it.type === 'carwash') this.drawCarwashBay(it.x * T, it.y * T);
      const crate = it.crate ? this.app.crates.get(it.crate) : undefined;
      const label = this.add
        .text(it.x * T, it.y * T - 40, `${it.crate === 'luckybag' ? '🧧' : it.crate === 'mallbox' ? '🎁' : icon[it.type]} ${it.name}${crate ? `
${formatMoney(crate.priceSen)}` : ''}`, {
          fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#ffe066', stroke: '#11131f', strokeThickness: 4, align: 'center', resolution: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(999_000);
      this.tweens.add({ targets: label, y: label.y - 5, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  /** A roadside car wash bay: wet concrete pad, a canopy with a sign, a car waiting, a hose. */
  private drawCarwashBay(x: number, y: number) {
    const g = this.add.graphics().setDepth(-800);
    // concrete pad with drain stripes and puddles
    g.fillStyle(0x000000, 0.18).fillRoundedRect(x - 118, y - 66, 236, 104, 14);
    g.fillStyle(0xced4da, 1).fillRoundedRect(x - 120, y - 70, 236, 100, 14);
    g.fillStyle(0xadb5bd, 1);
    for (let i = -100; i < 110; i += 26) g.fillRect(x + i, y + 18, 14, 4);
    g.fillStyle(0x74c0fc, 0.45).fillEllipse(x - 60, y + 4, 54, 16).fillEllipse(x + 52, y - 10, 40, 12);
    g.fillStyle(0xffffff, 0.6).fillCircle(x - 74, y - 2, 4).fillCircle(x - 66, y + 6, 3).fillCircle(x + 44, y - 14, 3);
    // a hatchback waiting for a wash (top-down)
    g.fillStyle(0x000000, 0.2).fillRoundedRect(x - 34, y - 48, 76, 40, 10);
    g.fillStyle(0x1971c2, 1).fillRoundedRect(x - 38, y - 54, 76, 40, 11);
    g.fillStyle(0xa5d8ff, 1).fillRoundedRect(x - 18, y - 50, 16, 32, 4).fillRoundedRect(x + 14, y - 50, 12, 32, 4);
    g.fillStyle(0x1864ab, 1).fillRoundedRect(x - 2, y - 50, 16, 32, 3);
    g.fillStyle(0x7c5a3a, 0.75).fillCircle(x - 28, y - 22, 5).fillCircle(x + 30, y - 46, 4).fillCircle(x + 6, y - 20, 3);
    g.fillStyle(0xfff3bf, 1).fillRect(x - 40, y - 50, 3, 8).fillRect(x - 40, y - 26, 3, 8);
    // hose reel
    g.fillStyle(0xf59f00, 1).fillCircle(x + 92, y - 40, 10);
    g.lineStyle(3, 0x2f9e44, 1).strokeCircle(x + 92, y - 40, 7);
    g.beginPath().moveTo(x + 92, y - 32).lineTo(x + 80, y - 6).lineTo(x + 58, y + 4).strokePath();
    // canopy posts + sign (drawn above characters so you walk "under" it)
    const top = this.add.graphics().setDepth(1_000_001);
    top.fillStyle(0x495057, 1).fillRect(x - 116, y - 112, 6, 50).fillRect(x + 104, y - 112, 6, 50);
    top.fillStyle(0x1c7ed6, 0.92).fillRoundedRect(x - 124, y - 122, 240, 22, 6);
    top.fillStyle(0xffffff, 0.92);
    for (let i = 0; i < 8; i++) top.fillTriangle(x - 120 + i * 30, y - 100, x - 105 + i * 30, y - 100, x - 112 + i * 30, y - 92);
    this.add
      .text(x - 4, y - 111, '💦 KILAT CAR WASH 💦', { fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#ffffff', resolution: 2 })
      .setOrigin(0.5)
      .setDepth(1_000_002);
  }

  private updateMarker(target: { x: number; y: number } | null) {
    const T = this.app.map.tileSize;
    if (!target) {
      this.marker?.destroy();
      this.marker = null;
      return;
    }
    if (!this.marker) {
      const ring = this.add.circle(0, 0, 34, 0xffd43b, 0.18).setStrokeStyle(3, 0xffd43b, 0.9);
      const arrow = this.add.text(0, -40, '⬇', { fontSize: '28px', color: '#ffd43b', stroke: '#11131f', strokeThickness: 4 }).setOrigin(0.5, 1);
      this.marker = this.add.container(0, 0, [ring, arrow]).setDepth(999_500);
      this.tweens.add({ targets: arrow, y: -54, duration: 500, yoyo: true, repeat: -1 });
      this.tweens.add({ targets: ring, scale: 1.25, alpha: 0.5, duration: 700, yoyo: true, repeat: -1 });
    }
    this.marker.setPosition(target.x * T, target.y * T);
  }

  // --- debug/test helpers ---
  debugSelf() {
    return { id: this.selfId, x: this.pos.x, y: this.pos.y, dir: this.dir, moving: this.moving, chunks: this.mapView.chunkCount };
  }
  debugPeek(tx: number, ty: number) {
    this.cameras.main.stopFollow();
    this.cameras.main.centerOn(tx * this.app.map.tileSize, ty * this.app.map.tileSize);
  }
  debugRemotes() {
    return [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name, x: r.avatar.x, y: r.avatar.y, emote: r.avatar.currentEmote, cosmetics: r.avatar.currentCosmetics, vehicle: r.avatar.vehicle, level: r.avatar.shownLevel, title: r.avatar.shownTitle }));
  }
}

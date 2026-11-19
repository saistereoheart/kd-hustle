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
import { NpcLayer } from './npcLayer';
import { Culler } from './culler';
import { Collectors } from './collectors';
import { introReveal } from '../ui/intro';
import { ensureGlowTexture, GLOW_TEXTURE } from './lightLayer';

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
  /** Latest public state (appearance, cosmetics, level, which building they're in). */
  pub: PlayerPublic;
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
  /** Doors by the grid cells around their front tile (for walking into them). */
  private doorFronts = new Map<number, Array<{ b: BuiltBuilding; d: BuiltBuilding['doors'][number] }>>();
  /** Walking into a door works once per push (you have to stop pushing to try again). */
  private doorArmed = true;
  private doorRetryAt = 0;
  private nearBuilding: BuiltBuilding | null = null;
  private nearInteract: BuiltMap['interactables'][number] | null = null;
  private nearPlot: BuiltMap['stallPlots'][number] | null = null;
  stalls!: StallLayer;
  npcs!: NpcLayer;
  /** Ah Long's debt collectors, trailing whoever is late paying. */
  private collectors!: Collectors;
  private nearNpc: number | null = null;
  private marker: Phaser.GameObjects.Container | null = null;
  /** The errand's beacon: a light beam + big icon on the spot (or over the NPC to hand it to). */
  private beacon: { root: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text; key: string } | null = null;
  private vehicleSpeed: Float32Array = new Float32Array(0);
  private offs: Array<() => void> = [];

  constructor() {
    super('town');
  }

  init(data: { app: App; init: InitPayload }) {
    this.app = data.app;
    this.initData = data.init;
    this.remotes = new Map();
    this.insideMarks = new Map();
    this.beacon = null;
    this.doorFronts = new Map();
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
    const cam = this.cameras?.main;
    if (!cam) return; // the scene has shut down (left it, or not built yet)
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
    this.createSigns();
    this.syncHomeSigns();
    this.offs.push(this.app.store.on(() => this.syncHomeSigns()));
    this.stalls = new StallLayer(this, this.app);
    this.npcs = new NpcLayer(this, this.app);
    this.collectors = new Collectors(this, this.app);
    if (you.rebirths) this.me.setRebirths(you.rebirths);
    if (you.owesAhLong) {
      this.me.setDebt(true);
      this.collectors.set(you.id, true, you.x, you.y);
    }
    this.offs.push(this.app.store.on(() => this.stalls.sync()));
    this.me.setState(you.dir, false);
    for (const p of this.initData.players) this.addRemote(p);

    this.cameras.main.startFollow(this.me.container, true, 0.18, 0.18);
    this.cameras.main.setRoundPixels(true);
    this.cameras.main.setZoom(this.zoomFor());

    // Door lookup: the tile in front of each door, plus its neighbours.
    for (const b of map.buildings) {
      for (const d of b.doors)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const i = gridIndexAt(map, (d.frontX + dx + 0.5) * T, (d.frontY + dy + 0.5) * T);
            if (i < 0) continue;
            const existing = this.doorIndex.get(i);
            if (!existing || (dx === 0 && dy === 0) || (!existing.name && b.name)) this.doorIndex.set(i, b);
            const list = this.doorFronts.get(i) ?? [];
            list.push({ b, d });
            this.doorFronts.set(i, list);
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
      this.collectors.set(id, false, 0, 0);
    });
    on('player:updated', ({ id, appearance, cosmetics, vehicle, level, title, interior, owesAhLong, rebirths }) => {
      const av = id === this.selfId ? this.me : this.remotes.get(id)?.avatar;
      if (!av) return;
      if (rebirths !== undefined) av.setRebirths(rebirths);
      if (owesAhLong !== undefined) {
        av.setDebt(owesAhLong);
        this.collectors.set(id, owesAhLong, av.x, av.y);
        const r0 = this.remotes.get(id);
        if (r0) r0.pub.owesAhLong = owesAhLong;
      }
      const r = this.remotes.get(id);
      if (r) {
        if (appearance) r.pub.appearance = appearance;
        if (cosmetics) r.pub.cosmetics = cosmetics;
        if (level !== undefined) r.pub.level = level;
        if (interior !== undefined) {
          r.pub.interior = interior;
          r.avatar.container.setVisible(!interior); // they went inside a building
        }
      }
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
      this.npcs?.destroy();
      this.offs = [];
      for (const r of this.remotes.values()) r.avatar.destroy();
      this.remotes.clear();
      this.collectors?.destroy();
    });
    // Draw the chunks around the spawn point right away so the first frame isn't empty.
    this.cameras.main.centerOn(this.pos.x, this.pos.y);
    this.cameras.main.preRender();
    this.mapView.update(this.cameras.main.worldView, true);
    this.app.onTownReady(this);
    // First frame drawn: open the town up from the intro dot (no-op if there's no intro).
    this.events.once('postupdate', () => this.time.delayedCall(60, () => introReveal()));
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
    if (p.interior) avatar.container.setVisible(false);
    if (p.rebirths) avatar.setRebirths(p.rebirths);
    if (p.owesAhLong) {
      avatar.setDebt(true);
      this.collectors.set(p.id, true, p.x, p.y);
    }
    this.remotes.set(p.id, { id: p.id, name: p.name, avatar, pub: { ...p }, samples: [{ t: performance.now(), x: p.x, y: p.y, dir: p.dir, moving: p.moving }] });
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
    if (this.nearNpc !== null) {
      this.app.talkTo(this.nearNpc);
      return;
    }
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
    this.app.walkIntoDoor(b); // E still works at a door (keyboard players), but walking in is the way
  }

  /** Reconnected after a short drop-out: catch up with who's around without restarting. */
  resync(p: InitPayload) {
    this.initData = p;
    const ids = new Set(p.players.map((o) => o.id));
    for (const [id, r] of this.remotes) {
      if (!ids.has(id)) {
        r.avatar.destroy();
        this.remotes.delete(id);
        this.collectors.set(id, false, 0, 0);
      }
    }
    for (const o of p.players) {
      const r = this.remotes.get(o.id);
      if (!r) this.addRemote(o);
      else {
        r.pub = { ...o };
        r.avatar.container.setVisible(!o.interior);
      }
    }
    // The server is the authority on where we are (it may have moved us).
    if (Math.hypot(p.you.x - this.pos.x, p.you.y - this.pos.y) > 48) {
      this.pos = { x: p.you.x, y: p.you.y };
      this.me.setPosition(p.you.x, p.you.y);
    }
    this.lastSent = { x: NaN, y: NaN, dir: this.dir, moving: false };
  }

  /** Forget the last prompt so the next check shows it again (after leaving a building). */
  refreshPrompt() {
    this.nearNpc = null;
    this.nearInteract = null;
    this.nearBuilding = null;
    this.nearPlot = null;
    this.slowAcc = 1000;
  }

  /** Other players inside a building (shown in its interior). */
  playersInside(building: string): PlayerPublic[] {
    return [...this.remotes.values()].filter((r) => r.pub.interior === building).map((r) => r.pub);
  }

  /** Where we stand (px). */
  get position(): { x: number; y: number } {
    return this.pos;
  }

  get selfCosmetics() {
    return this.me.currentCosmetics;
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
      this.npcs.update(delta);
    this.collectors.update(delta, (id) => {
      const av = id === this.selfId ? this.me : this.remotes.get(id)?.avatar;
      return av ? { x: av.x, y: av.y, visible: av.container.visible && !(id === this.selfId && (this.app.interior || this.app.home)) } : null;
    });
      this.mapView.update(this.cameras.main.worldView);
      this.culler.update(this.cameras.main.worldView, delta);
      this.updateDecks(delta);
      this.slowChecks(delta);
      return;
    }

    // --- local movement (client prediction); none while we're inside a building ---
    let { x: vx, y: vy } = this.app.interior || this.app.home ? { x: 0, y: 0 } : this.app.inputVector();
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
    this.walkIntoDoors(moving ? vx : 0, moving ? vy : 0);
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
    this.npcs.update(delta);
    this.collectors.update(delta, (id) => {
      const av = id === this.selfId ? this.me : this.remotes.get(id)?.avatar;
      return av ? { x: av.x, y: av.y, visible: av.container.visible && !(id === this.selfId && (this.app.interior || this.app.home)) } : null;
    });
    this.followBeacon();
    this.mapView.update(this.cameras.main.worldView);
    this.culler.update(this.cameras.main.worldView, delta);
    this.updateDecks(delta);

    this.slowChecks(delta);
  }

  /** Errand beacon: where to go ("🧺 PICK UP / DROP OFF"), then over the NPC who's waiting. */
  private updateBeacon() {
    const e = this.app.store.errand;
    const key = e ? `${e.npc}|${e.stage}|${e.place.x},${e.place.y}` : '';
    if (this.beacon && this.beacon.key !== key) {
      this.tweens.killTweensOf(this.beacon.root.list);
      this.beacon.root.destroy(true);
      this.beacon = null;
    }
    if (!e || this.beacon) return;
    ensureGlowTexture(this);
    const going = e.stage === 'go';
    const col = going ? 0x69db7c : 0xffd43b;
    const beam = this.add.image(0, 6, GLOW_TEXTURE).setOrigin(0.5, 1).setDisplaySize(46, 360).setTint(col).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD);
    const ring = this.add.ellipse(0, 0, 70, 30, col, 0.22).setStrokeStyle(3, col, 0.95);
    const icon = this.add.text(0, -58, going ? '🧺' : '🧺❗', { fontSize: '34px', stroke: '#11131f', strokeThickness: 5, resolution: 2 }).setOrigin(0.5, 1);
    const label = this.add
      .text(0, -96, going ? `ERRAND · ${e.place.name.toUpperCase()}` : `HAND IT TO ${e.npcName.toUpperCase()}`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#11131f', backgroundColor: going ? '#b2f2bb' : '#ffe066', padding: { x: 7, y: 3 }, resolution: 3,
      })
      .setOrigin(0.5, 1);
    const root = this.add.container(0, 0, going ? [beam, ring, icon, label] : [ring, icon, label]).setDepth(999_400);
    this.tweens.add({ targets: icon, y: -70, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: ring, scaleX: 1.3, scaleY: 1.3, alpha: 0.4, duration: 800, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: beam, alpha: 0.3, duration: 900, yoyo: true, repeat: -1 });
    this.beacon = { root, label, key };
    this.followBeacon();
  }

  private followBeacon() {
    const b = this.beacon;
    const e = this.app.store.errand;
    if (!b || !e) return;
    const T = this.app.map.tileSize;
    if (e.stage === 'go') b.root.setPosition(e.place.x * T, e.place.y * T);
    else {
      const at = this.npcs.posOf(e.npc);
      if (at) b.root.setPosition(at.x, at.y - 52);
    }
  }

  /**
   * Doors work by walking into them: standing at a door's front and pushing towards the wall
   * goes in (or bumps a locked one, with a knock). No button needed.
   */
  private walkIntoDoors(vx: number, vy: number) {
    if (this.app.interior || this.app.home) return;
    const { map } = this.app;
    const T = map.tileSize;
    const cands = vx || vy ? this.doorFronts.get(gridIndexAt(map, this.pos.x, this.pos.y - 4)) : undefined;
    let hit: BuiltBuilding | null = null;
    if (cands) {
      const px = this.pos.x / T, py = (this.pos.y - 4) / T;
      for (const { b, d } of cands) {
        // Only right on the door mark: lined up with it (≤ ~half a tile sideways) and right in
        // front of it, pushing into the wall.
        const l = Math.hypot(d.nx, d.ny) || 1;
        const nx = d.nx / l, ny = d.ny / l;
        const into = -(vx * nx + vy * ny);
        const ox = px - d.x, oy = py - d.y; // the door mark is drawn centred on (d.x, d.y)
        const side = Math.abs(ox * ny - oy * nx), out = ox * nx + oy * ny;
        if (into > 0.55 && side < 0.55 && out > -0.2 && out < 1.5) {
          hit = b;
          break;
        }
      }
    }
    if (!hit) {
      this.doorArmed = true;
      return;
    }
    const now = performance.now();
    if (!this.doorArmed || now < this.doorRetryAt || document.querySelector('.panel, .modal-backdrop')) return;
    this.doorArmed = false;
    this.doorRetryAt = now + 900;
    if (!this.app.walkIntoDoor(hit)) this.cameras.main.shake(140, 0.0025); // bumped a locked door
  }

  /** "🚪 Ali is inside" badges over the doors of buildings other players are in. */
  private insideMarks = new Map<string, Phaser.GameObjects.Text>();
  private updateInsideMarkers() {
    const groups = new Map<string, Remote[]>();
    for (const r of this.remotes.values()) {
      const b = r.pub.interior;
      if (!b) continue;
      const g = groups.get(b) ?? [];
      g.push(r);
      groups.set(b, g);
    }
    for (const [b, t] of this.insideMarks)
      if (!groups.has(b)) {
        this.tweens.killTweensOf(t);
        t.destroy();
        this.insideMarks.delete(b);
      }
    for (const [b, rs] of groups) {
      const label = rs.length === 1 ? `🚪 ${rs[0].name} is inside` : `🚪 ${rs.length} inside: ${rs.map((r) => r.name).join(', ')}`;
      let t = this.insideMarks.get(b);
      const x = rs[0].avatar.x, y = rs[0].avatar.y - 34;
      if (!t) {
        t = this.add
          .text(x, y, label, { fontFamily: 'system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#ffffff', backgroundColor: 'rgba(25, 113, 194, 0.85)', padding: { x: 5, y: 2 }, resolution: 3 })
          .setOrigin(0.5, 1)
          .setDepth(900_000);
        this.tweens.add({ targets: t, y: y - 3, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.insideMarks.set(b, t);
      } else if (t.text !== label) t.setText(label);
    }
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
    if (this.slowAcc >= 150 && !this.app.interior && !this.app.home) {
      this.slowAcc = 0;
      const tx = Math.floor(this.pos.x / map.tileSize);
      const ty = Math.floor((this.pos.y - 4) / map.tileSize);
      const b = this.doorIndex.get(gridIndexAt(map, this.pos.x, this.pos.y - 4)) ?? null;
      // Interactables (crates, Jobs Board, pawn shop) take priority over plain doors.
      const radius = cfg.economy.interactRadiusTiles - 1;
      let it: (typeof map.interactables)[number] | null = null;
      let best = radius;
      for (const c of map.interactables) {
        if (c.building) continue; // used from inside its building
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
      if (mine && mine.tier < cfg.stalls.cashierFromTier && Math.hypot(this.pos.x / map.tileSize - mine.x, this.pos.y / map.tileSize - mine.y) <= cfg.stalls.cookRadiusTiles - 1) plot = mine;
      if (plot && it && Math.hypot(this.pos.x / map.tileSize - it.x, this.pos.y / map.tileSize - it.y) < Math.hypot(this.pos.x / map.tileSize - plot.x, this.pos.y / map.tileSize - plot.y) && plot !== mine) plot = null;
      let npc = this.me.vehicle ? null : this.npcs.nearest(this.pos.x, this.pos.y, cfg.npcs.talkRadiusTiles);
      // Your own stall beats a passer-by; otherwise the closer of an NPC or a stall wins.
      if (npc && plot) {
        const T1 = map.tileSize;
        const dn = this.npcs.distance(npc.id, this.pos.x, this.pos.y);
        const dp = Math.hypot(plot.x - this.pos.x / T1, plot.y - this.pos.y / T1);
        if (plot === mine || dp < dn) npc = null;
      }
      const npcId = npc?.id ?? null;
      if (it !== this.nearInteract || b !== this.nearBuilding || plot !== this.nearPlot || npcId !== this.nearNpc) {
        this.nearInteract = it;
        this.nearBuilding = b;
        this.nearPlot = plot;
        this.nearNpc = npcId;
        let prompt: string | null = null;
        if (npc) {
          const e = this.app.store.errand;
          prompt = e?.npc === npc.id && e.stage === 'return' ? `🧺 Hand in to ${npc.name}` : `💬 Talk to ${npc.name}`;
        } else if (plot) {
          const s = this.app.store.stalls.get(plot.id);
          prompt = !s ? `${cfg.stalls.tiers.find((t) => t.tier === plot.tier)?.name ?? 'Stall'} spot (free)` : plot === mine ? '🍳 Your stall' : `${s.ownerName}'s stall`;
        } else if (it) {
          const crate = it.crate ? this.app.crates.get(it.crate) : undefined;
          prompt = crate ? `${it.name} (${formatMoney(crate.priceSen)})` : it.name;
        }
        const walk = !prompt && !!b;
        if (walk && b) prompt = this.app.doorPrompt(b);
        this.app.hud?.setPrompt(prompt, this.app.touch, { walk });
      }
      // Delivery target marker + objective HUD.
      const job = this.app.store.job;
      const T0 = map.tileSize;
      const target = job?.kind === 'delivery' ? (job.stage === 'pickup' ? job.pickup : job.dropoff)
        : job?.kind === 'flyers' ? (job.stops.filter((s) => !s.done).sort((a, b) => Math.hypot(a.x * T0 - this.pos.x, a.y * T0 - this.pos.y) - Math.hypot(b.x * T0 - this.pos.x, b.y * T0 - this.pos.y))[0] ?? null) : null;
      this.updateMarker(target);
      const cam = this.cameras.main;
      const dpr = this.app.dpr; // camera numbers are in device pixels; the DOM HUD uses CSS pixels
      const screen = { x: cam.worldView.x, y: cam.worldView.y, zoom: cam.zoom / dpr, cx: cam.width / 2 / dpr, cy: cam.height / 2 / dpr };
      this.updateInsideMarkers();
      this.updateBeacon();
      this.app.jobHud?.update(this.pos.x, this.pos.y, screen);
      this.app.guide?.update(this.pos.x, this.pos.y, screen);
      this.app.minimap?.update([
        { x: this.pos.x, y: this.pos.y, name: this.initData.you.name, self: true },
        ...(target ? [{ x: target.x * map.tileSize, y: target.y * map.tileSize, name: '🎯', target: true }] : []),
        ...(this.beacon ? [{ x: this.beacon.root.x, y: this.beacon.root.y, name: '🧺', target: true }] : []),
        ...(mine ? [{ x: mine.x * map.tileSize, y: mine.y * map.tileSize, name: 'Your stall', stall: true }] : []),
        ...[...this.remotes.values()].map((r) => ({ x: r.avatar.x, y: r.avatar.y, name: r.pub.interior ? `🚪 ${r.name}` : r.name })),
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

  /**
   * Big signposts for the places that matter (JOBS BOARD, BUY STOCK, PASAR MALAM STALLS...),
   * colour-coded by kind and readable from far away, plus small labels for any other outdoor
   * interactable. Things inside buildings are signposted at the building's door.
   */
  private createSigns() {
    const T = this.app.map.tileSize;
    const KIND_COLOR: Record<string, number> = { work: 0x2f9e44, crate: 0x7048e8, shop: 0x1c7ed6, stall: 0xe8590c, soon: 0x868e96 };
    const pois = this.app.guide?.pois ?? [];
    for (const p of pois) {
      const x = p.x * T, y = p.y * T;
      const title = this.add.text(0, 0, `${p.icon} ${p.label}`, { fontFamily: 'system-ui, sans-serif', fontSize: '17px', fontStyle: '900', color: '#ffffff', resolution: 3 }).setOrigin(0.5, 1);
      const sub = this.add.text(0, 2, p.sub, { fontFamily: 'system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#f1f3f5', resolution: 3 }).setOrigin(0.5, 0);
      const w = Math.max(title.width, sub.width) + 22;
      const h = title.height + (p.sub ? sub.height : 0) + 10;
      const board = this.add.graphics();
      board.fillStyle(0x000000, 0.3).fillRoundedRect(-w / 2 + 3, -title.height - 5 + 4, w, h, 10);
      board.fillStyle(KIND_COLOR[p.kind] ?? 0x495057, 0.95).fillRoundedRect(-w / 2, -title.height - 5, w, h, 10);
      board.lineStyle(2, 0xffffff, 0.85).strokeRoundedRect(-w / 2, -title.height - 5, w, h, 10);
      // a pole down to the spot, with a little base
      const pole = this.add.graphics();
      pole.fillStyle(0x343a40, 1).fillRect(-2, -title.height - 5 + h, 4, 70 - (-title.height - 5 + h));
      pole.fillStyle(0x000000, 0.25).fillEllipse(0, 72, 18, 6);
      const sign = this.add.container(x, y - 72, [pole, board, title, ...(p.sub ? [sub] : [])]).setDepth(999_000 + y / 100);
      sign.setAlpha(p.kind === 'soon' ? 0.75 : 1);
      this.tweens.add({ targets: [board, title, sub], y: '-=3', duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.signs.push(sign);
      this.culler.add(sign, x, y - 72, 160);
    }
    // Any outdoor interactable without a signpost gets a small floating label.
    const signed = new Set(pois.map((p) => p.interactable).filter(Boolean));
    for (const it of this.app.map.interactables) {
      if (it.building || signed.has(it.id)) continue;
      const crate = it.crate ? this.app.crates.get(it.crate) : undefined;
      const label = this.add
        .text(it.x * T, it.y * T - 40, `⭐ ${it.name}${crate ? `
${formatMoney(crate.priceSen)}` : ''}`, {
          fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#ffe066', stroke: '#11131f', strokeThickness: 4, align: 'center', resolution: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(999_000);
      this.tweens.add({ targets: label, y: label.y - 5, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.culler.add(label, it.x * T, it.y * T - 40, 120);
    }
  }
  private signs: Phaser.GameObjects.Container[] = [];
  /** Signs and labels far off-screen are hidden (Phaser draws everything otherwise). */
  private culler = new Culler();
  /** What the home signs last showed: they're only redrawn when ownership changes. */
  private homeSignsKey = '';
  private homeSigns = new Map<string, Phaser.GameObjects.Text>();

  /** 🏷️ FOR SALE / 🏠 owner signs at every home building's door (refreshed when owners change). */
  private syncHomeSigns() {
    const T = this.app.map.tileSize;
    const me = this.selfId;
    // Called on every store change: skip unless the owners changed.
    let key = `${me}`;
    for (const [id, o] of this.app.store.props) key += `|${id}:${o.owner}:${o.ownerName}`;
    // A shoplot with a kopitiam downstairs shows the kopitiam's signboard, not the loft sign.
    const kopi = new Set<string>();
    for (const s of this.app.store.stalls.values()) {
      const p = s.tier >= this.app.cfg.stalls.cashierFromTier ? this.app.map.stallPlots.find((x) => x.id === s.plot) : undefined;
      if (p?.building) kopi.add(p.building);
    }
    key += `|k:${[...kopi].join(',')}`;
    if (key === this.homeSignsKey) return;
    this.homeSignsKey = key;
    const byBuilding = new Map<string, typeof this.app.listings>();
    for (const u of this.app.listings) byBuilding.set(u.building, [...(byBuilding.get(u.building) ?? []), u]);
    for (const [bid, units] of byBuilding) {
      const owners = units.map((u) => this.app.store.props.get(u.id));
      const free = owners.filter((o) => !o).length;
      const mine = owners.some((o) => o?.owner === me);
      const text = mine ? '🏠 YOUR HOME' : free === units.length ? (units.length > 1 ? `🏷️ FOR SALE · ${free} units` : '🏷️ FOR SALE') : free ? `🏷️ ${free} FOR SALE` : `🏠 ${owners[0]?.ownerName ?? ''}`;
      const color = mine ? '#8ce99a' : free ? '#ffe066' : '#a5d8ff';
      let t = this.homeSigns.get(bid);
      if (!t) {
        const u = units[0];
        t = this.add
          .text(u.x * T, u.y * T - 30, text, { fontFamily: 'system-ui, sans-serif', fontSize: '12px', fontStyle: '900', color, backgroundColor: 'rgba(17,19,31,0.75)', padding: { x: 6, y: 3 }, resolution: 2 })
          .setOrigin(0.5, 1)
          .setDepth(998_000);
        this.homeSigns.set(bid, t);
        this.culler.add(t, u.x * T, u.y * T - 30, 120);
      }
      // Restyling a Text re-renders it, so only when it changed.
      if (t.text !== text) t.setText(text);
      if (t.style.color !== color) t.setColor(color);
      t.setAlpha(kopi.has(bid) ? 0 : 1);
    }
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

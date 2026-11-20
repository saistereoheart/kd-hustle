// The outdoor town. The local player is predicted client-side (instant response) and
// reported to the server ~15×/s; other players are rendered ~110 ms in the past and
// interpolated between server snapshots so they move smoothly despite network jitter.
import Phaser from 'phaser';
import {
  darkness, gameTime, DIRECTIONS, districtAt, gridIndexAt, moveWithCollision, vehicleSpeedGrid, formatMoney, manifestRateSen, rideAccelSec, tireGrip, driveSpec, newDriveState, stepDrive, followDrive, shiftGear, coast, packEngine, unpackEngine,
  type DriveSpec, type DriveState,
  type BuiltBuilding, type BuiltMap, type ChatMsg, type Direction, type InitPayload, type PetPublic, type SeatInfo, type PlayerPublic, type ServerToClientEvents, type SnapshotPayload,
} from '@kh/shared';
import type { App } from '../app';
import { toast } from '../ui/dom';
import { loadPrefs, savePrefs } from '../ui/settings';
import { Avatar } from './avatar';
import { hearing, startEngine, type EngineVoice } from '../ui/engineSound';
import { dashboard } from '../ui/dashboard';
import { AVATAR_DEPTH } from './avatar';
import { isCarId, isShowroomVehicle, rearWheels } from '../items/carArt';

/** Tyre marks: on the road, under everything else. */
const SKID_DEPTH = -850;
import { ambience } from '../ui/ambience';
import { MapView } from './mapRenderer';
import { StallLayer } from './stallLayer';
import { ParkedLayer } from './parkedLayer';
import { NpcLayer } from './npcLayer';
import { Culler } from './culler';
import { Collectors } from './collectors';
import { introReveal } from '../ui/intro';
import { ensureGlowTexture, GLOW_TEXTURE } from './lightLayer';
import { governor } from '../perf/governor';

interface Sample {
  t: number;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  /** A driver's engine (revs and packed gear / throttle / limiter / wheelspin), if they sent it. */
  rpm?: number;
  eng?: number;
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
  /** You and the other players in town (world px), for the townsfolk to walk round. */
  private peopleNear(): Array<{ x: number; y: number }> {
    const out = [{ x: this.pos.x, y: this.pos.y }];
    for (const r of this.remotes.values()) if (r.avatar.container.visible) out.push({ x: r.avatar.x, y: r.avatar.y });
    return out;
  }
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
  parked!: ParkedLayer;
  private nearParked: string | null = null;
  private promptKey = '';
  npcs!: NpcLayer;
  /** Ah Long's debt collectors, trailing whoever is late paying. */
  private collectors!: Collectors;
  private nearNpc: number | null = null;
  private marker: Phaser.GameObjects.Container | null = null;
  /** The errand's beacon: a light beam + big icon on the spot (or over the NPC to hand it to). */
  private beacon: { root: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text; key: string } | null = null;
  private vehicleSpeed: Float32Array = new Float32Array(0);
  /** 🚗 Showroom vehicles: current speed (px/s; they speed up with torque), and the engines heard. */
  private rideSpeed = 0;
  private engine: { key: string; voice: EngineVoice | null } | null = null;
  /** Our gearbox while on a showroom car/bike (null otherwise), and where we were heading (to coast). */
  private drive: { key: string; spec: DriveSpec; st: DriveState } | null = null;
  private coastDir = { x: 0, y: 0 };
  private throttleHeld = false;
  private lastRpm = 0;
  private lastEng: number | undefined = undefined;
  private remoteEngines = new Map<number, { key: string; voice: EngineVoice | null; spec: DriveSpec; st: DriveState; px: number; py: number; v: number; gear: number | null }>();
  /** Tyre smoke puffs alive right now (capped). */
  private puffs = 0;
  private smokeAcc = 0;
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
      // Rebuild the stalls too (they used to stay destroyed, and every frame after that threw an
      // error: no stalls, cooks or night shading, and a stuttering game).
      this.stalls = new StallLayer(this, this.app);
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
      cosmetics: you.cosmetics, vehicle: you.vehicle, vehicleLook: you.vehicleLook, particles, title: this.titleInfo(you.title),
    });

    this.vehicleSpeed = vehicleSpeedGrid(this.app.map, cfg.terrain);
    this.createSigns();
    this.syncHomeSigns();
    this.offs.push(this.app.store.on(() => this.syncHomeSigns()));
    this.offs.push(this.app.store.on(() => this.syncVentureSigns()));
    this.syncVentureSigns();
    this.stalls = new StallLayer(this, this.app);
    this.parked = new ParkedLayer(this, (vid) => this.tapParked(vid));
    this.parked.setAll([...this.app.store.parked.values()]);
    this.npcs = new NpcLayer(this, this.app);
    this.collectors = new Collectors(this, this.app);
    if (you.rebirths) this.me.setRebirths(you.rebirths);
    if (you.owesAhLong) {
      this.me.setDebt(true);
      this.collectors.set(you.id, true, you.x, you.y);
    }
    this.offs.push(this.app.store.on(() => this.stalls.sync()));
    this.me.setState(you.dir, false);
    if (you.seat) this.me.setSeat(you.seat);
    if (you.pet) this.me.setPet(this.petDef(you.pet));
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
    on('parked:update', ({ parked }) => {
      this.app.store.parked.set(parked.vid, parked);
      this.parked.upsert(parked);
      this.slowAcc = 1000;
      this.promptKey = '';
      this.app.store.emit();
    });
    on('parked:removed', ({ vid }) => {
      this.app.store.parked.delete(vid);
      this.parked.remove(vid);
      this.promptKey = '';
      this.app.store.emit();
    });
    on('player:updated', ({ id, appearance, cosmetics, vehicle, vehicleLook, level, title, interior, owesAhLong, rebirths, seat, pet }) => {
      const av = id === this.selfId ? this.me : this.remotes.get(id)?.avatar;
      if (!av) return;
      if (pet !== undefined) av.setPet(this.petDef(pet));
      if (seat !== undefined) {
        av.setSeat(seat);
        const r1 = this.remotes.get(id);
        if (r1) r1.pub.seat = seat;
        if (id === this.selfId) {
          this.app.store.seat = seat;
          this.selfSamples = [];
          this.promptKey = '';
          this.app.store.emit();
        }
      }
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
        av.setVehicle(vehicle, vehicleLook ?? null);
        if (id === this.selfId) {
          this.app.store.riding = vehicle;
          this.selfSamples = [];
          this.app.store.emit();
        }
      }
    });
    on('snapshot', (s: SnapshotPayload) => this.onSnapshot(s));
    on('move:correct', ({ x, y, seq }) => {
      if (seq > 0) this.corrections.push(performance.now()); // the server refused a move (seq 0: it moved us)
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
      this.parked?.destroy();
      this.stopEngines();
      ambience.set(null);
    });
    ambience.set('town', () => darkness(this.app.cfg.time, gameTime(this.app.cfg.time, this.app.store.serverNow()).hourF));
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
      cosmetics: p.cosmetics, vehicle: p.vehicle, vehicleLook: p.vehicleLook, particles: loadPrefs().particles, title: this.titleInfo(p.title),
    });
    avatar.setState(p.dir, p.moving);
    // Someone who was already sitting/sleeping/dancing when we joined.
    const loopDef = p.emote ? this.app.cfg.chat.emotes.find((e) => e.id === p.emote && e.loop) : undefined;
    if (loopDef) avatar.playEmote(loopDef.id, loopDef, loadPrefs().particles);
    if (p.interior) avatar.container.setVisible(false);
    if (p.seat) avatar.setSeat(p.seat);
    if (p.pet) avatar.setPet(this.petDef(p.pet));
    if (p.rebirths) avatar.setRebirths(p.rebirths);
    if (p.owesAhLong) {
      avatar.setDebt(true);
      this.collectors.set(p.id, true, p.x, p.y);
    }
    this.remotes.set(p.id, { id: p.id, name: p.name, avatar, pub: { ...p }, samples: [{ t: performance.now(), x: p.x, y: p.y, dir: p.dir, moving: p.moving }] });
  }

  /** For the F3 overlay: when snapshots arrived (WiFi trouble shows as gaps) and snap-backs. */
  private snapTimes: number[] = [];
  private corrections: number[] = [];
  netStats(): { avgMs: number; maxGapMs: number; snapbacks: number } {
    const now = performance.now();
    const t = this.snapTimes.filter((x) => now - x < 5000);
    let max = 0;
    for (let i = 1; i < t.length; i++) max = Math.max(max, t[i] - t[i - 1]);
    if (t.length) max = Math.max(max, now - t[t.length - 1]);
    return { avgMs: t.length > 1 ? Math.round((t[t.length - 1] - t[0]) / (t.length - 1)) : 0, maxGapMs: Math.round(max), snapbacks: this.corrections.filter((x) => now - x < 30000).length };
  }

  private onSnapshot(s: SnapshotPayload) {
    const now = performance.now();
    this.snapTimes.push(now);
    if (this.snapTimes.length > 120) this.snapTimes.splice(0, this.snapTimes.length - 120);
    for (const [id, x, y, dirIdx, moving, rpm, eng] of s.p) {
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
      r.samples.push({ t: now, x, y, dir: DIRECTIONS[dirIdx] ?? 'down', moving: moving === 1, rpm, eng });
      if (r.samples.length > 30) r.samples.splice(0, r.samples.length - 30);
    }
  }

  /** Called by the HUD's interact button / E key. */
  interact() {
    // In a vehicle (riding along, or driving one we put down): E gets out.
    if (this.app.store.seat || this.drivingParked()) {
      this.app.exitVehicle();
      return;
    }
    if (this.nearParked) {
      this.app.enterVehicle(this.nearParked);
      return;
    }
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
    this.app.store.seat = p.you.seat ?? null;
    this.me.setSeat(p.you.seat ?? null);
    this.parked.setAll(p.parked ?? []);
    // The server is the authority on where we are (it may have moved us).
    if (Math.hypot(p.you.x - this.pos.x, p.you.y - this.pos.y) > 48) {
      this.pos = { x: p.you.x, y: p.you.y };
      this.me.setPosition(p.you.x, p.you.y);
    }
    this.lastSent = { x: NaN, y: NaN, dir: this.dir, moving: false };
  }

  /** A lead Teman's looks (from its item). */
  private petDef(pet: PetPublic | null) {
    const d = pet ? this.app.items.get(pet.itemId) : undefined;
    return d ? { shape: d.shape, color: d.color, color2: d.color2 } : null;
  }

  /** 🅿️ Our own vehicle that's out, if we're driving it. */
  private drivingParked(): boolean {
    const mine = this.app.store.myParked(this.selfId);
    return !!mine && mine.seats[0] === this.selfId;
  }

  /** Tapped a parked vehicle: get in if we're close enough. */
  private tapParked(vid: string) {
    const v = this.app.store.parked.get(vid);
    if (!v || this.app.store.seat || this.me.vehicle) return;
    const range = this.app.cfg.vehicles.parking.enterRangeTiles * this.app.map.tileSize;
    if (Math.hypot(v.x - this.pos.x, v.y - this.pos.y) <= range) this.app.enterVehicle(vid);
    else toast(v.ownerId === this.selfId ? 'Walk up to it to get in (or press its hotbar key to bring it here).' : `Walk up to ${v.ownerName}'s ride to get in.`);
  }

  /** X: put our vehicle away (from anywhere). */
  putAwayNearby() {
    if (this.app.store.myParked(this.selfId)) this.app.putAwayVehicle();
  }

  /** Forget the last prompt so the next check shows it again (after leaving a building). */
  refreshPrompt() {
    this.promptKey = '';
    this.nearParked = null;
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
      this.updateEngines(false); // riding along: you hear your driver's engine (and the others')
      this.stalls.update(delta);
      this.npcs.update(delta, this.peopleNear());
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
    const input = len > 0.01;
    let throttle = input;
    // 🏍️ Showroom cars and bikes run a gearbox (shared/garage/drive): speed comes from torque and
    // the gear. Let go and they roll on and slow gently; push the other way to brake. In neutral
    // (manual) the throttle just revs the engine.
    const model = this.me.vehicle && !(this.app.interior || this.app.home) ? cfg.garage.models[this.me.vehicle] : undefined;
    let coasting = false;
    if (model) {
      const v = cfg.vehicles.vehicles[this.me.vehicle!];
      const setup = this.app.store.garage?.owned[this.me.vehicle!] ?? null;
      const top = setup?.speed ?? v.speed;
      const spec = driveSpec(model, top, rideAccelSec(cfg.garage, this.me.vehicle!, setup));
      const key = `${this.me.vehicle}|${top}|${spec.accel}`;
      if (!this.drive || this.drive.key !== key) {
        const keep = this.drive?.st;
        this.drive = { key, spec, st: newDriveState(spec, !loadPrefs().manualGears) };
        if (keep) Object.assign(this.drive.st, { speed: Math.min(keep.speed, top), gear: Math.min(keep.gear, spec.gearTop.length - 1), rpm: keep.rpm });
      }
      this.drive.st.auto = !loadPrefs().manualGears;
      const st = this.drive.st;
      // Pushing against the way we're rolling = brakes (not a U-turn at full speed).
      const braking = input && st.speed > 30 && vx * this.coastDir.x + vy * this.coastDir.y < -0.5;
      if (braking) throttle = false;
      const i = gridIndexAt(map, this.pos.x, this.pos.y - 2);
      const terrain = i >= 0 ? this.vehicleSpeed[i] : 0.4;
      const cap = top * Math.max(v.minTerrainMult, tireGrip(cfg.garage, terrain, setup));
      const ev = stepDrive(spec, st, { throttle, cap, bounce: loadPrefs().revLimiter }, dt);
      const driven = throttle && st.gear >= 0;
      if (!driven && st.speed > 0) coast(spec, st, dt, { brake: braking, coastSec: cfg.garage.driving.coastSec, brakeSec: cfg.garage.driving.brakeSec });
      if (ev) this.onShift(ev);
      this.rideSpeed = st.speed;
      if (input && !braking && st.speed > 0.5) this.coastDir = { x: vx, y: vy };
      else if (st.speed > 0.5) {
        coasting = true;
        vx = this.coastDir.x;
        vy = this.coastDir.y;
      }
      if (input && !braking && st.speed <= 0.5) {
        // Revving on the spot (neutral, or the first instant of a launch): just turn to face the way.
        this.coastDir = { x: vx, y: vy };
        this.dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
        throttle = false;
      } else if (!input) throttle = false;
    } else if (this.drive) {
      this.drive = null;
      this.rideSpeed = 0;
    }
    this.throttleHeld = input;
    const moving = throttle || coasting;
    if (moving) {
      this.dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
      const v = this.me.vehicle ? cfg.vehicles.vehicles[this.me.vehicle] : undefined;
      if (v) {
        // Riding: top speed × the terrain's vehicle multiplier (grass is slow, roads are fast).
        let speed: number;
        if (this.drive) speed = this.drive.st.speed;
        else {
          const i = gridIndexAt(map, this.pos.x, this.pos.y - 2);
          const terrain = i >= 0 ? this.vehicleSpeed[i] : 0.4;
          speed = v.speed * Math.max(v.minTerrainMult, terrain);
        }
        const grid = v.grid === 'drive' ? map.driveCollision : map.collision;
        const before = this.pos;
        this.pos = moveWithCollision(grid, this.pos.x, this.pos.y, vx * speed * dt, vy * speed * dt, v.hitbox);
        // Ran into a wall: stop.
        if (this.drive && Math.hypot(this.pos.x - before.x, this.pos.y - before.y) < speed * dt * 0.2) this.drive.st.speed *= 0.5;
      } else {
        const speed = cfg.movement.walkSpeed * this.app.mods().walk; // Kaki Lari skill (the server allows the same)
        this.pos = moveWithCollision(map.collision, this.pos.x, this.pos.y, vx * speed * dt, vy * speed * dt, cfg.movement.hitbox);
      }
      this.me.setPosition(this.pos.x, this.pos.y);
    }
    if (!moving) this.rideSpeed = Math.max(0, this.rideSpeed - 900 * dt);
    this.updateEngines(this.throttleHeld && !!this.drive && this.drive.st.load > 0);
    this.tyreSmoke(dt);
    this.updateDashboard();
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
      // Driving a showroom vehicle: our revs and gear go along, so others hear the real engine.
      const d = this.drive;
      const rpm = d ? Math.round(d.st.rpm / 50) * 50 : undefined;
      const eng = d ? packEngine(d.st.gear, this.throttleHeld && d.st.load > 0, d.st.limiter, d.st.slip > 0.35) : undefined;
      if (ls.x !== this.pos.x || ls.y !== this.pos.y || ls.dir !== this.dir || ls.moving !== this.moving || (d && (Math.abs((rpm ?? 0) - this.lastRpm) >= 150 || eng !== this.lastEng))) {
        this.app.socket?.emit('move', { x: this.pos.x, y: this.pos.y, dir: this.dir, moving: this.moving, seq: ++this.seq, rpm, eng });
        this.lastSent = { x: this.pos.x, y: this.pos.y, dir: this.dir, moving: this.moving };
        this.lastRpm = rpm ?? 0;
        this.lastEng = eng;
      }
    }

    this.updateRemotes(now);
    this.stalls.update(delta);
    this.npcs.update(delta, this.peopleNear());
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
      // 🅿️ In a vehicle: E gets out. Next to one: E gets in (yours to drive, others' to ride along).
      const st = this.app.store;
      const mineOut = st.myParked(this.selfId);
      const inside = !!st.seat || this.drivingParked();
      const range = cfg.vehicles.parking.enterRangeTiles * map.tileSize;
      const pv = inside || this.me.vehicle ? null : this.parked.nearest(this.pos.x, this.pos.y, range);
      const parkedId = pv?.vid ?? null;
      const pkey = `${inside}|${parkedId}|${pv?.seats.join(',')}|${mineOut?.vid ?? ''}`;
      const npcId = npc?.id ?? null;
      if (it !== this.nearInteract || b !== this.nearBuilding || plot !== this.nearPlot || npcId !== this.nearNpc || parkedId !== this.nearParked || pkey !== this.promptKey) {
        this.nearInteract = it;
        this.nearBuilding = b;
        this.nearPlot = plot;
        this.nearNpc = npcId;
        this.nearParked = parkedId;
        this.promptKey = pkey;
        const putAway = { label: 'Put away', key: 'X', onTap: () => this.app.putAwayVehicle() };
        if (inside || pv) {
          let text: string;
          const name = (id: string) => cfg.vehicles.vehicles[id]?.name ?? 'ride';
          if (inside) text = st.seat ? `🚪 Get out of ${name(st.seat.vehicle)}` : `🅿️ Park and get out`;
          else if (pv!.ownerId === this.selfId) text = pv!.seats[0] === null ? `🔑 Drive your ${name(pv!.vehicle)}` : `🚪 Get in`;
          else text = pv!.seats.slice(1).some((s) => s === null) ? `🚗 Ride with ${pv!.ownerName}` : `${pv!.ownerName}'s ${name(pv!.vehicle)} (full)`;
          const showAlt = !!mineOut && (inside ? this.drivingParked() : pv!.ownerId === this.selfId);
          this.app.hud?.setPrompt(text, this.app.touch, showAlt ? { alt: putAway } : {});
          if (pv && pv.ownerId !== this.selfId && !pv.seats.slice(1).some((s) => s === null)) this.nearParked = null;
        } else {
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
      this.app.pointers?.update(cam.worldView, this.pos);
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

  /** 🏍️ Manual gear change (R / F or the dashboard). Switches to manual if the automatic was on. */
  shift(dir: 1 | -1) {
    const d = this.drive;
    if (!d) return;
    if (d.st.auto) this.toggleGearbox();
    const ev = shiftGear(d.spec, d.st, dir);
    if (ev) this.onShift(ev);
    else if ((dir < 0 && d.st.gear > 0) || (dir > 0 && d.st.gear < 0)) toast('Too fast for that gear: it would over-rev.', 'bad', 1500);
  }

  /** Automatic ⇄ manual (remembered on this device). */
  toggleGearbox() {
    const p = loadPrefs();
    p.manualGears = !p.manualGears;
    savePrefs(p);
    if (this.drive) this.drive.st.auto = !p.manualGears;
    toast(p.manualGears ? '🕹️ Manual gears: R = up, F = down (or the dashboard buttons). Below 1st is N: rev it, then drop into 1st.' : '🅰️ Automatic gearbox.', 'good', 3500);
  }

  private onShift(ev: 'up' | 'down') {
    try {
      this.engine?.voice?.shift(ev);
    } catch {
      /* sound is optional */
    }
  }

  /** The big speedo / rev counter, bottom right, while on a showroom car or bike. */
  private updateDashboard() {
    const d = this.drive;
    const id = this.me?.vehicle;
    const m = d && id ? this.app.cfg.garage.models[id] : undefined;
    if (!d || !m || this.app.interior || this.app.home) return dashboard.hide();
    dashboard.show(
      { kmh: (d.st.speed / 16) * 3.6, rpm: d.st.rpm, redline: d.spec.redline, idle: d.spec.idle, gear: d.st.gear, gears: d.spec.gearTop.length, auto: d.st.auto, limiter: d.st.limiter, shiftAt: d.spec.upAt, name: `${m.maker} ${m.model}` },
      { up: () => this.shift(1), down: () => this.shift(-1), toggle: () => this.toggleGearbox() },
    );
  }

  /** Tyre smoke off the rear wheels (a car makes a proper cloud) and black marks on the road that
   *  fade after a few seconds: hard launches from a stop and wheelspin on grass (ours and others'). */
  private tyreSmoke(dt: number) {
    this.smokeAcc += dt;
    if (this.smokeAcc < 0.05) return;
    this.smokeAcc = 0;
    const particles = loadPrefs().particles && !governor.lite;
    if (particles) ensureGlowTexture(this);
    const burn = (id: number, av: Avatar, slip: number) => {
      const v = av.vehicle;
      if (!v || !isShowroomVehicle(v) || slip < 0.08 || !av.container.visible) {
        this.markFrom.delete(id);
        return;
      }
      const car = isCarId(v);
      const { view, flip } = av.vehicleView();
      const wheels = rearWheels(v, view).map((o) => ({ x: av.x + (flip ? -o.x : o.x), y: av.y + 2 + o.y }));
      // Rubber on the road (only while the tyres really spin).
      const last = this.markFrom.get(id);
      this.markFrom.set(id, wheels);
      if (slip > 0.35 && last && last.length === wheels.length) wheels.forEach((w, i) => this.skidMark(last[i], w, car));
      if (!particles) return;
      for (const w of wheels) {
        if (this.puffs > 90 || Math.random() > slip) continue;
        const img = this.add.image(w.x + (Math.random() - 0.5) * 4, w.y - 1, GLOW_TEXTURE);
        const big = car ? 1.6 : 1;
        img.setTint(0xe3e3e3).setAlpha((0.32 * slip + 0.1) * (car ? 1.2 : 1)).setScale(0.13 * big).setDepth(AVATAR_DEPTH + av.y + (view === 'back' || view === 'dback' ? 3 : -3));
        this.puffs++;
        this.tweens.add({
          targets: img,
          x: img.x + (Math.random() - 0.5) * 20 * big,
          y: img.y - (8 + Math.random() * 10) * big,
          scale: (0.42 + Math.random() * 0.3) * big,
          alpha: 0,
          duration: (750 + Math.random() * 450) * (car ? 1.5 : 1),
          onComplete: () => {
            img.destroy();
            this.puffs--;
          },
        });
      }
    };
    if (this.drive && this.me) burn(this.selfId, this.me, this.drive.st.slip);
    for (const [rid, e] of this.remoteEngines) {
      const r = this.remotes.get(rid);
      if (r) burn(rid, r.avatar, e.st.slip);
    }
  }

  private markFrom = new Map<number, Array<{ x: number; y: number }>>();
  private marks = 0;
  /** One short black stripe of rubber from a to b, fading out over `driving.skidMarkSec`. */
  private skidMark(a: { x: number; y: number }, b: { x: number; y: number }, car: boolean) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.3 || len > 48 || this.marks > 400) return;
    const w = car ? 2.4 : 1.6;
    const m = this.add.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len + w * 0.6, w, 0x141414, 0.5).setRotation(Math.atan2(dy, dx)).setDepth(SKID_DEPTH);
    this.marks++;
    this.tweens.add({
      targets: m,
      alpha: 0,
      delay: this.app.cfg.garage.driving.skidMarkSec * 400,
      duration: this.app.cfg.garage.driving.skidMarkSec * 600,
      onComplete: () => {
        m.destroy();
        this.marks--;
      },
    });
  }

  /** 🚗 Engine sounds: ours (from our gearbox) and the nearest riders' (their speed → gear → revs). Louder exhausts carry further. */
  private updateEngines(throttleOn: boolean) {
    const g = this.app.cfg.garage;
    const inside = !!(this.app.interior || this.app.home);
    const dt = Math.min(0.1, this.game.loop.delta / 1000);
    // Ours
    const id = this.me?.vehicle;
    const m = id && !inside ? g.models[id] : undefined;
    const look = this.me?.vehicleLook;
    const key = m ? `${id}|${look?.exhaust ?? 'stock'}` : '';
    // (Sounds were off when it started and are on now: start it again.)
    if (this.engine && (this.engine.key !== key || (!this.engine.voice && loadPrefs().engineSound))) {
      this.engine.voice?.stop();
      this.engine = null;
    }
    if (m && !this.engine) this.engine = { key, voice: startEngine(g, id!, look?.exhaust ?? 'stock') };
    if (m && this.engine?.voice && this.drive) {
      const st = this.drive.st;
      try {
        this.engine.voice.set(st.rpm, throttleOn ? st.load : 0, 1, { pan: 0, limiter: st.limiter && throttleOn && loadPrefs().revLimiter });
      } catch {
        /* sound is optional */
      }
    }
    // Nearby riders: as far as their exhaust carries (a straight pipe reaches much further).
    const near = inside ? [] : [...this.remotes.values()]
      .filter((r) => r.avatar.vehicle && g.models[r.avatar.vehicle] && r.avatar.container.visible)
      .map((r) => {
        const d = Math.hypot(r.avatar.x - this.pos.x, r.avatar.y - this.pos.y);
        return { r, d, level: hearing(g, r.avatar.vehicleLook?.exhaust ?? 'stock', d, this.app.map.tileSize) };
      })
      .filter((x) => x.level > 0.01)
      .sort((a, b) => b.level - a.level)
      .slice(0, 4);
    const keep = new Set(near.map((x) => x.r.id));
    for (const [rid, e] of this.remoteEngines) {
      if (!keep.has(rid)) {
        e.voice?.stop();
        this.remoteEngines.delete(rid);
      }
    }
    for (const { r, level } of near) {
      const vid = r.avatar.vehicle!;
      const rm = g.models[vid];
      const rk = `${vid}|${r.avatar.vehicleLook?.exhaust ?? 'stock'}`;
      let e = this.remoteEngines.get(r.id);
      if (e && e.key !== rk) {
        e.voice?.stop();
        e = undefined;
      }
      if (!e) {
        const vdef = this.app.cfg.vehicles.vehicles[vid];
        const top = (vdef?.speed ?? 500) * 1.3; // they may have tuned it (we don't know by how much)
        const spec = driveSpec(rm, top, rm.accelSec);
        e = { key: rk, voice: startEngine(g, vid, r.avatar.vehicleLook?.exhaust ?? 'stock'), spec, st: newDriveState(spec, true), px: r.avatar.x, py: r.avatar.y, v: 0, gear: null };
        this.remoteEngines.set(r.id, e);
      }
      // Their speed from how far they moved this frame (smoothed).
      const inst = dt > 0 ? Math.hypot(r.avatar.x - e.px, r.avatar.y - e.py) / dt : 0;
      e.px = r.avatar.x;
      e.py = r.avatar.y;
      e.v += (Math.min(inst, e.spec.top) - e.v) * 0.12;
      let ev: 'up' | 'down' | null = null;
      let limiter = false;
      const smp = this.engineSample(r);
      if (smp) {
        // The driver's real engine (revs, gear, throttle) as they sent it: smoothed, not guessed.
        const en = unpackEngine(smp.eng!);
        e.st.rpm += (smp.rpm! - e.st.rpm) * Math.min(1, dt * 14);
        if (e.gear !== null && en.gear !== e.gear && en.gear >= 0 && e.gear >= 0) ev = en.gear > e.gear ? 'up' : 'down';
        e.gear = en.gear;
        e.st.load = en.throttle ? 1 : 0;
        e.st.slip = en.slip ? 0.85 : 0;
        limiter = en.limiter;
      } else ev = followDrive(e.spec, e.st, r.avatar.moving ? e.v : e.v * 0.9, r.avatar.moving, dt);
      try {
        if (ev) e.voice?.shift(ev);
        e.voice?.set(e.st.rpm, e.st.load, level, { pan: (r.avatar.x - this.pos.x) / 320, limiter });
      } catch {
        /* sound is optional */
      }
    }
  }

  /** The engine state a remote driver sent, as of the moment we're drawing them (a little in the past). */
  private engineSample(r: Remote): Sample | null {
    const t = performance.now() - this.app.cfg.net.interpolationDelayMs;
    let pick: Sample | null = null;
    for (const smp of r.samples) {
      if (smp.t <= t) pick = smp;
      else break;
    }
    pick ??= r.samples[0] ?? null;
    return pick && pick.rpm !== undefined && pick.eng !== undefined ? pick : null;
  }

  private stopEngines() {
    dashboard.hide();
    this.engine?.voice?.stop();
    this.engine = null;
    for (const e of this.remoteEngines.values()) e.voice?.stop();
    this.remoteEngines.clear();
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
    this.pinPassengers();
  }

  /** The avatar driving the vehicle this seat is in (us or another player), if anyone is. */
  private driverOf(seat: SeatInfo): Avatar | null {
    const d = this.app.store.parked.get(seat.vid)?.seats[0];
    if (d === null || d === undefined) return null;
    return d === this.selfId ? this.me : (this.remotes.get(d)?.avatar ?? null);
  }

  /**
   * Passengers ride WITH their driver's sprite, exactly where it's drawn (like a Ronda rider on the
   * same bike). Following their own copy of the position would trail behind: the driver you see is
   * either you (drawn instantly) or drawn from the same snapshots a moment later.
   */
  private pinPassengers() {
    for (const r of this.remotes.values()) {
      const s = r.avatar.seated;
      const d = s ? this.driverOf(s) : null;
      if (!d) continue;
      r.avatar.setPosition(d.x, d.y);
      r.avatar.setState(d.dir, d.moving);
    }
    const mine = this.app.store.seat;
    const d = mine ? this.driverOf(mine) : null;
    if (d) {
      this.pos = { x: d.x, y: d.y };
      this.dir = d.dir;
      this.me.setPosition(d.x, d.y);
      this.me.setState(d.dir, d.moving);
    }
  }

  /** Drive-grid vehicles (motorbike, Ronda) ride ON elevated decks; walkers and bicycles go under. */
  private ridesOnDeck(av: Avatar): boolean {
    const v = av.vehicle ? this.app.cfg.vehicles.vehicles[av.vehicle] : undefined;
    return !!v && v.grid === 'drive' && this.mapView.overheadAt(av.x, av.y - 2);
  }

  /** Riding a Ronda (someone else is driving)? */
  isPassenger(): boolean {
    if (this.app.store.seat) return true; // riding along in someone's vehicle
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
  /** Gold "YOUR …" signs over the buildings of the Ventures you own. */
  private ventureSigns = new Map<string, Phaser.GameObjects.Text>();
  private ventureKey = '';
  private syncVentureSigns() {
    const mine = this.app.myVentures();
    this.syncOtherShopSigns();
    const key = mine.map((v) => `${v.id}@${v.spot.building}`).join(',');
    if (key === this.ventureKey) return;
    this.ventureKey = key;
    const T = this.app.map.tileSize;
    // (Rebuilt when one moves: the sign goes with it.)
    for (const t of this.ventureSigns.values()) t.destroy();
    this.ventureSigns.clear();
    for (const v of mine) {
      if (this.ventureSigns.has(v.id)) continue;
      const x = v.spot.x * T, y = v.spot.y * T - 56;
      const t = this.add
        .text(x, y, `${v.icon} YOUR ${v.name.toUpperCase()}`, { fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontStyle: '900', color: '#1b1300', backgroundColor: 'rgba(245,159,0,0.95)', padding: { x: 9, y: 5 }, resolution: 2 })
        .setOrigin(0.5, 1)
        .setDepth(998_700);
      this.tweens.add({ targets: t, y: y - 4, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.culler.add(t, x, y, 140);
      this.ventureSigns.set(v.id, t);
    }
  }
  /** 🏪 Other players' Ventures: their name over the shoplot's door. */
  private otherShopKey = '';
  private otherShopSigns: Phaser.GameObjects.Text[] = [];
  private syncOtherShopSigns() {
    const others = this.app.store.shoplots.filter((s) => s.ownerId !== this.selfId);
    const key = others.map((s) => `${s.building}:${s.ref}:${s.ownerName}`).join('|');
    if (key === this.otherShopKey) return;
    this.otherShopKey = key;
    for (const t of this.otherShopSigns) t.destroy();
    this.otherShopSigns = [];
    const T = this.app.map.tileSize;
    for (const s of others) {
      const spot = this.app.shoplotSpot(s.building);
      const def = this.app.cfg.businesses.types.find((t) => t.id === s.ref);
      if (!spot || !def) continue;
      const x = spot.x * T, y = spot.y * T - 52; // above the lofts' FOR SALE sign
      const t = this.add
        .text(x, y, `${def.icon} ${s.ownerName}'s ${def.name}`, { fontFamily: 'system-ui, sans-serif', fontSize: '12px', fontStyle: '800', color: '#ffffff', backgroundColor: 'rgba(17,19,31,0.78)', padding: { x: 7, y: 3 }, resolution: 2 })
        .setOrigin(0.5, 1)
        .setDepth(998_600);
      this.culler.add(t, x, y, 140);
      this.otherShopSigns.push(t);
    }
  }
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
      // Yours stands out: a bigger green sign, drawn above the FOR SALE signs around it.
      const look = mine ? 'mine' : 'other';
      if (t.getData('look') !== look) {
        t.setData('look', look);
        t.setFontSize(mine ? 16 : 12);
        t.setBackgroundColor(mine ? 'rgba(43,138,62,0.95)' : 'rgba(17,19,31,0.75)');
        t.setPadding(mine ? 9 : 6, mine ? 5 : 3);
        t.setDepth(mine ? 998_600 : 998_000);
      }
      const want = mine ? '#ffffff' : color;
      if (t.style.color !== want) t.setColor(want);
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

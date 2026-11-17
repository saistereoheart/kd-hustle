// The outdoor town. The local player is predicted client-side (instant response) and
// reported to the server ~15×/s; other players are rendered ~110 ms in the past and
// interpolated between server snapshots so they move smoothly despite network jitter.
import Phaser from 'phaser';
import {
  DIRECTIONS, districtAt, gridIndexAt, moveWithCollision, TERRAIN_NAMES, formatMoney, manifestRateSen,
  type BuiltBuilding, type BuiltMap, type ChatMsg, type Direction, type InitPayload, type PlayerPublic, type ServerToClientEvents, type SnapshotPayload,
} from '@kh/shared';
import type { App } from '../app';
import { toast } from '../ui/dom';
import { loadPrefs } from '../ui/settings';
import { Avatar } from './avatar';
import { MapView } from './mapRenderer';

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

export class TownScene extends Phaser.Scene {
  private app!: App;
  private initData!: InitPayload;
  private me!: Avatar;
  private remotes = new Map<number, Remote>();
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
  private marker: Phaser.GameObjects.Container | null = null;
  private vehicleSpeedByTerrain: number[] = [];
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

  /** Camera zoom for the current screen size. */
  private zoomFor() {
    return Phaser.Math.Clamp(Math.min(this.scale.width, this.scale.height) / 620, 0.6, 1.4);
  }

  get selfId() {
    return this.initData.you.id;
  }

  create() {
    const { map, cfg } = this.app;
    const T = map.tileSize;
    // Render chunks sharper on high-DPI screens / zoomed-in cameras, capped at 2x for memory.
    const res = Math.min(2, Math.max(1, Math.round((window.devicePixelRatio || 1) * this.zoomFor() * 2) / 2));
    this.mapView = new MapView(this, map, res);
    // World coordinates are relative to the fixed origin (Menara Mitraland), so bounds can be negative.
    this.cameras.main.setBounds(map.originTx * T, map.originTy * T, map.width * T, map.height * T);
    this.cameras.main.setBackgroundColor('#7cc456');

    const you = this.initData.you;
    this.pos = { x: you.x, y: you.y };
    this.dir = you.dir;
    const particles = loadPrefs().particles;
    this.me = new Avatar(this, cfg.character, this.app.items, {
      name: you.name, level: you.level, appearance: you.appearance, x: you.x, y: you.y, isSelf: true,
      cosmetics: you.cosmetics, vehicle: you.vehicle, particles,
    });

    this.vehicleSpeedByTerrain = TERRAIN_NAMES.map((n) => cfg.terrain.terrains[n]?.vehicle ?? 0);
    this.createInteractableLabels();
    this.me.setState(you.dir, false);
    for (const p of this.initData.players) this.addRemote(p);

    this.cameras.main.startFollow(this.me.container, true, 0.18, 0.18);
    this.cameras.main.setRoundPixels(true);
    const applyZoom = () => this.cameras.main.setZoom(this.zoomFor());
    applyZoom();
    this.scale.on('resize', applyZoom);
    this.offs.push(() => this.scale.off('resize', applyZoom));

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
    on('player:updated', ({ id, appearance, cosmetics, vehicle }) => {
      const av = id === this.selfId ? this.me : this.remotes.get(id)?.avatar;
      if (!av) return;
      if (cosmetics) av.setCosmetics(cosmetics);
      if (appearance) av.setAppearance(appearance);
      if (vehicle !== undefined) av.setVehicle(vehicle);
    });
    on('snapshot', (s: SnapshotPayload) => this.onSnapshot(s));
    on('move:correct', ({ x, y }) => {
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

  private addRemote(p: PlayerPublic) {
    if (this.remotes.has(p.id)) return;
    const avatar = new Avatar(this, this.app.cfg.character, this.app.items, {
      name: p.name, level: p.level, appearance: p.appearance, x: p.x, y: p.y, isSelf: false,
      cosmetics: p.cosmetics, vehicle: p.vehicle, particles: loadPrefs().particles,
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
      if (id === this.selfId) continue;
      const r = this.remotes.get(id);
      if (!r) continue;
      r.samples.push({ t: now, x, y, dir: DIRECTIONS[dirIdx] ?? 'down', moving: moving === 1 });
      if (r.samples.length > 30) r.samples.splice(0, r.samples.length - 30);
    }
  }

  /** Called by the HUD's interact button / E key. */
  interact() {
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
        // Riding: road speed × the terrain's vehicle multiplier (grass is slow, roads are fast).
        const i = gridIndexAt(map, this.pos.x, this.pos.y - 2);
        const mult = i >= 0 ? Math.max(0.2, this.vehicleSpeedByTerrain[map.terrain[i]] ?? 0.4) : 0.4;
        const speed = v.speed * mult;
        this.pos = moveWithCollision(map.driveCollision, this.pos.x, this.pos.y, vx * speed * dt, vy * speed * dt, v.hitbox);
      } else {
        const speed = cfg.movement.walkSpeed;
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
      if (this.app.ownEmote === 'manifest' && !this.moving) {
        const rate = manifestRateSen(cfg.skills, this.app.store.skills.manifest ?? 1);
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

    // --- remote players: interpolate in the past ---
    const renderT = now - cfg.net.interpolationDelayMs;
    for (const r of this.remotes.values()) {
      const s = r.samples;
      while (s.length >= 2 && s[1].t <= renderT) s.shift();
      let x = s[0].x;
      let y = s[0].y;
      let dir = s[0].dir;
      let mv = s[0].moving;
      if (s.length >= 2 && s[0].t <= renderT) {
        const k = (renderT - s[0].t) / Math.max(1, s[1].t - s[0].t);
        x = s[0].x + (s[1].x - s[0].x) * k;
        y = s[0].y + (s[1].y - s[0].y) * k;
        dir = s[1].dir;
        mv = s[1].moving || s[0].moving;
      }
      r.avatar.setPosition(x, y);
      r.avatar.setState(dir, mv);
      r.avatar.tick(now);
    }

    this.mapView.update(this.cameras.main.worldView);

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
      if (it !== this.nearInteract || b !== this.nearBuilding) {
        this.nearInteract = it;
        this.nearBuilding = b;
        let prompt: string | null = null;
        if (it) {
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
      this.app.jobHud?.update(this.pos.x, this.pos.y, { x: cam.worldView.x, y: cam.worldView.y, zoom: cam.zoom, cx: cam.width / 2, cy: cam.height / 2 });
      this.app.minimap?.update([
        { x: this.pos.x, y: this.pos.y, name: this.initData.you.name, self: true },
        ...(target ? [{ x: target.x * map.tileSize, y: target.y * map.tileSize, name: '🎯', target: true }] : []),
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

  /** Camera shake for big rolls (0..1). */
  shake(intensity: number) {
    this.cameras.main.shake(250 + intensity * 450, 0.004 + intensity * 0.012);
  }

  /** Floating labels above crate machines, the Jobs Board and the pawn shop. */
  private createInteractableLabels() {
    const T = this.app.map.tileSize;
    const icon: Record<string, string> = { jobs: '📋', pawn: '🏪', crate: '🎰' };
    for (const it of this.app.map.interactables) {
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
    return [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name, x: r.avatar.x, y: r.avatar.y, emote: r.avatar.currentEmote, cosmetics: r.avatar.currentCosmetics, vehicle: r.avatar.vehicle }));
  }
}

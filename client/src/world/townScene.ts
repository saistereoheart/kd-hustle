// The outdoor town. The local player is predicted client-side (instant response) and
// reported to the server ~15×/s; other players are rendered ~110 ms in the past and
// interpolated between server snapshots so they move smoothly despite network jitter.
import Phaser from 'phaser';
import {
  DIRECTIONS, districtAt, gridIndexAt, moveWithCollision,
  type BuiltBuilding, type ChatMsg, type Direction, type InitPayload, type PlayerPublic, type ServerToClientEvents, type SnapshotPayload,
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
  private districtId = '';
  private doorIndex = new Map<number, BuiltBuilding>();
  private nearBuilding: BuiltBuilding | null = null;
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
    this.me = new Avatar(this, cfg.character, { name: you.name, level: you.level, appearance: you.appearance, x: you.x, y: you.y, isSelf: true });
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
    on('player:updated', ({ id, appearance }) => {
      if (id === this.selfId) this.me.setAppearance(appearance);
      else this.remotes.get(id)?.avatar.setAppearance(appearance);
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
    const avatar = new Avatar(this, this.app.cfg.character, { name: p.name, level: p.level, appearance: p.appearance, x: p.x, y: p.y, isSelf: false });
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
      const speed = cfg.movement.walkSpeed;
      this.pos = moveWithCollision(map, this.pos.x, this.pos.y, vx * speed * dt, vy * speed * dt, cfg.movement.hitbox);
      this.me.setPosition(this.pos.x, this.pos.y);
    }
    if (moving && !this.moving && this.me.currentEmote) this.app.onOwnEmote(null); // walking ends our emote
    this.moving = moving;
    this.me.setState(this.dir, moving);
    this.me.tick(now);

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
      if (b !== this.nearBuilding) {
        this.nearBuilding = b;
        this.app.hud?.setPrompt(b ? `Enter ${b.name ?? (b.kind === 'terrace' || b.kind === 'semid' || b.kind === 'bungalow' ? 'house' : 'shop')}` : null, this.app.touch);
      }
      this.app.minimap?.update([
        { x: this.pos.x, y: this.pos.y, name: this.initData.you.name, self: true },
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

  // --- debug/test helpers ---
  debugSelf() {
    return { id: this.selfId, x: this.pos.x, y: this.pos.y, dir: this.dir, moving: this.moving, chunks: this.mapView.chunkCount };
  }
  debugPeek(tx: number, ty: number) {
    this.cameras.main.stopFollow();
    this.cameras.main.centerOn(tx * this.app.map.tileSize, ty * this.app.map.tileSize);
  }
  debugRemotes() {
    return [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name, x: r.avatar.x, y: r.avatar.y, emote: r.avatar.currentEmote }));
  }
}

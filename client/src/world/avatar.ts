// A character in the world: baked spritesheet + nameplate + speech bubble + emotes.
import Phaser from 'phaser';
import { appearanceKey, type Appearance, type CharacterConfig, type Cosmetics, type Direction, type ItemDef } from '@kh/shared';
import { EMOTE_FRAMES, FRAME_COUNT, FRAME_PX_H, FRAME_PX_W, COLS, idleFrames, ORIGIN_Y, RES, renderSheet, walkFrames } from '../character/sheet';
import type { View, WornCosmetics } from '../character/draw';
import { ensureBikeTextures } from '../items/vehicleArt';

/** Turns equipped cosmetics into what the character renderer needs. */
export function wornFrom(cos: Cosmetics, items: Map<string, ItemDef>): WornCosmetics {
  const worn: WornCosmetics = {};
  for (const slot of ['hat', 'face', 'back'] as const) {
    const ref = cos[slot];
    const def = ref ? items.get(ref.itemId) : undefined;
    if (ref && def) worn[slot] = { shape: def.shape, paint: { c1: def.color, c2: def.color2 ?? def.color, variant: ref.variant } };
  }
  return worn;
}

const VIEW_OF: Record<Direction, View> = { down: 'front', up: 'back', left: 'side', right: 'side' };

/** Creates (once) the texture + animations for an appearance. Returns the texture key. */
export function ensureCharacterTexture(scene: Phaser.Scene, a: Appearance, cfg: CharacterConfig, worn: WornCosmetics = {}): string {
  const wornKey = [worn.hat, worn.face, worn.back].map((w) => (w ? `${w.shape}.${w.paint.c1}.${w.paint.variant}` : '-')).join('|');
  const key = `char_${appearanceKey(a)}_${appearanceKey({ wornKey } as unknown as Appearance)}`;
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.addCanvas(key, renderSheet(a, cfg, worn))!;
  for (let i = 0; i < FRAME_COUNT; i++) {
    tex.add(i, 0, (i % COLS) * FRAME_PX_W, Math.floor(i / COLS) * FRAME_PX_H, FRAME_PX_W, FRAME_PX_H);
  }
  const mk = (name: string, frames: number[], frameRate: number, repeat = -1) =>
    scene.anims.create({ key: `${key}:${name}`, frames: frames.map((f) => ({ key, frame: f })), frameRate, repeat });
  for (const view of ['front', 'back', 'side'] as View[]) {
    mk(`idle_${view}`, idleFrames(view), 2);
    mk(`walk_${view}`, walkFrames(view), 9);
  }
  const EMOTE_FPS: Record<string, number> = { manifest: 3, dance: 6, cry: 4, sit: 1.5, sleep: 1.5, clap: 8, cheer: 6, wave: 6, laugh: 7, flex: 4, salam: 3 };
  for (const [id, frames] of Object.entries(EMOTE_FRAMES)) mk(`emote_${id}`, frames, EMOTE_FPS[id] ?? 5);
  return key;
}

const TEXT_BASE = { fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', resolution: 2 } as const;

export class Avatar {
  readonly container: Phaser.GameObjects.Container;
  private sprite: Phaser.GameObjects.Sprite;
  private nameText: Phaser.GameObjects.Text;
  private badge: Phaser.GameObjects.Text;
  private bubble: Phaser.GameObjects.Container | null = null;
  private bubbleTimer: Phaser.Time.TimerEvent | null = null;
  private texKey = '';
  private emoteUntil = 0;
  private emoteId = '';
  private emoteLoopFx: Phaser.Time.TimerEvent | null = null;
  private fxAlive = 0;
  private appearance: Appearance;
  private cosmetics: Cosmetics = {};
  private bike: Phaser.GameObjects.Image | null = null;
  private auraFx: Phaser.Time.TimerEvent | null = null;
  private auraGlow: Phaser.GameObjects.Ellipse | null = null;
  private rainbowName = false;
  private baseNameColor: string;
  vehicle: string | null = null;
  dir: Direction = 'down';
  moving = false;

  constructor(
    private scene: Phaser.Scene,
    private cfg: CharacterConfig,
    private items: Map<string, ItemDef>,
    opts: {
      name: string; level: number; appearance: Appearance; x: number; y: number; isSelf: boolean;
      cosmetics?: Cosmetics; vehicle?: string | null; particles?: boolean;
    },
  ) {
    this.appearance = opts.appearance;
    this.baseNameColor = opts.isSelf ? '#ffe066' : '#ffffff';
    this.particles = opts.particles ?? true;
    this.sprite = scene.add.sprite(0, 0, '__DEFAULT').setOrigin(0.5, ORIGIN_Y).setScale(1 / RES);
    this.nameText = scene.add
      .text(0, -66, opts.name, { ...TEXT_BASE, fontSize: '12px', fontStyle: 'bold', color: opts.isSelf ? '#ffe066' : '#ffffff', stroke: '#11131f', strokeThickness: 3 })
      .setOrigin(0.5, 1);
    this.badge = scene.add
      .text(0, -66, `${opts.level}`, { ...TEXT_BASE, fontSize: '10px', fontStyle: 'bold', color: '#1b1300', backgroundColor: '#f59f00', padding: { x: 4, y: 1 } })
      .setOrigin(1, 1);
    this.container = scene.add.container(opts.x, opts.y, [this.sprite, this.badge, this.nameText]);
    this.layoutNameplate();
    this.cosmetics = opts.cosmetics ?? {};
    this.setAppearance(opts.appearance);
    this.applyCosmeticExtras();
    this.setVehicle(opts.vehicle ?? null);
    this.setPosition(opts.x, opts.y);
  }

  private particles: boolean;

  /** Equip changes: rebake the sprite (hat/face/back) and restart aura/name colour. */
  setCosmetics(cos: Cosmetics) {
    this.cosmetics = cos;
    this.setAppearance(this.appearance);
    this.applyCosmeticExtras();
  }

  private applyCosmeticExtras() {
    // Name colour
    const nc = this.cosmetics.namecolor ? this.items.get(this.cosmetics.namecolor.itemId) : undefined;
    this.rainbowName = !!nc && (nc.id === 'rainbow_name' || this.cosmetics.namecolor?.variant === 'rainbow');
    const color = !nc ? this.baseNameColor : this.cosmetics.namecolor?.variant === 'golden' ? '#fcc419' : nc.color;
    this.nameText.setColor(color);
    // Aura
    this.auraFx?.remove();
    this.auraFx = null;
    this.auraGlow?.destroy();
    this.auraGlow = null;
    const aura = this.cosmetics.aura ? this.items.get(this.cosmetics.aura.itemId) : undefined;
    if (!aura) return;
    const variant = this.cosmetics.aura!.variant;
    const col = Phaser.Display.Color.HexStringToColor(variant === 'golden' ? '#fcc419' : aura.color).color;
    this.auraGlow = this.scene.add.ellipse(0, -2, 46, 16, col, 0.35);
    this.container.addAt(this.auraGlow, 0);
    this.scene.tweens.add({ targets: this.auraGlow, alpha: { from: 0.2, to: 0.5 }, scaleX: { from: 0.9, to: 1.1 }, duration: 900, yoyo: true, repeat: -1 });
    if (!this.particles) return;
    this.auraFx = this.scene.time.addEvent({ delay: aura.shape === 'flame' ? 160 : 320, loop: true, callback: () => this.auraParticle(aura, variant) });
  }

  private auraParticle(aura: ItemDef, variant: string) {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const hue = variant === 'rainbow' ? Phaser.Display.Color.HSVToRGB(Math.random(), 0.7, 1).color : undefined;
    const col = hue ?? Phaser.Display.Color.HexStringToColor(variant === 'golden' ? '#fcc419' : aura.color).color;
    const col2 = aura.color2 ? Phaser.Display.Color.HexStringToColor(aura.color2).color : 0xffffff;
    switch (aura.shape) {
      case 'bubbles': {
        const b = this.scene.add.circle(rnd(-16, 16), rnd(-10, 0), rnd(2, 4), col, 0.25).setStrokeStyle(1, 0xffffff, 0.8);
        this.fx(b, { y: rnd(-60, -40), alpha: { from: 0.9, to: 0 }, duration: 1600, ease: 'Sine.easeOut' });
        break;
      }
      case 'flame': {
        const f = this.scene.add.triangle(rnd(-14, 14), 0, 0, 8, 4, 0, 8, 8, Math.random() < 0.5 ? col : 0xffd43b, 0.85);
        this.fx(f, { y: rnd(-36, -24), scaleY: 1.8, alpha: { from: 0.9, to: 0 }, duration: 700 });
        break;
      }
      case 'hearts': {
        const h = this.glyph('♥', '#' + col.toString(16).padStart(6, '0'), rnd(-16, 16), rnd(-30, -10), 11);
        this.fx(h, { y: '-=26', alpha: { from: 1, to: 0 }, duration: 1300 });
        break;
      }
      case 'naga': {
        const a0 = Math.random() * Math.PI * 2;
        const d = this.scene.add.circle(Math.cos(a0) * 20, -20 + Math.sin(a0) * 8, 2.5, Math.random() < 0.5 ? col : col2, 0.95);
        this.fx(d, { x: Math.cos(a0 + 2) * 20, y: -34 + Math.sin(a0 + 2) * 8, alpha: { from: 1, to: 0 }, duration: 1100 });
        break;
      }
      case 'sparkle': {
        const g = this.glyph('✦', '#fff3bf', rnd(-20, 20), rnd(-56, -6), 10);
        this.fx(g, { scale: { from: 0.4, to: 1.3 }, alpha: { from: 1, to: 0 }, duration: 900 });
        break;
      }
      default: {
        const g = this.scene.add.circle(rnd(-18, 18), rnd(-40, -4), 1.6, col, 0.9);
        this.fx(g, { y: '-=14', alpha: { from: 0.9, to: 0 }, duration: 1000 });
      }
    }
  }

  /** Hop on/off a vehicle (the delivery motorbike). */
  setVehicle(v: string | null) {
    this.vehicle = v;
    this.bike?.destroy();
    this.bike = null;
    if (v) {
      ensureBikeTextures(this.scene);
      this.bike = this.scene.add.image(0, 2, 'bike_side').setOrigin(0.5, 36 / 40).setScale(0.5);
      this.container.addAt(this.bike, this.auraGlow ? 1 : 0);
    }
    this.sprite.setY(v ? -9 : 0);
    this.applyAnim(true);
  }

  private layoutNameplate() {
    const w = this.nameText.width + this.badge.width + 4;
    this.badge.setX(-w / 2 + this.badge.width);
    this.nameText.setX(-w / 2 + this.badge.width + 4 + this.nameText.width / 2);
  }

  setAppearance(a: Appearance) {
    this.appearance = a;
    this.texKey = ensureCharacterTexture(this.scene, a, this.cfg, wornFrom(this.cosmetics, this.items));
    this.sprite.setTexture(this.texKey, 0);
    this.emoteUntil = 0;
    this.applyAnim(true);
  }

  setPosition(x: number, y: number) {
    this.container.setPosition(x, y);
    this.container.setDepth(y);
  }

  get x() {
    return this.container.x;
  }
  get y() {
    return this.container.y;
  }

  setState(dir: Direction, moving: boolean) {
    const changed = dir !== this.dir || moving !== this.moving;
    this.dir = dir;
    this.moving = moving;
    if (moving && this.emoteUntil) {
      this.stopEmote(); // walking cancels an emote
      return;
    }
    if (changed) this.applyAnim();
  }

  /** Called every frame: ends emotes when their time is up. */
  tick(now: number) {
    if (this.emoteUntil && now > this.emoteUntil) this.stopEmote();
    if (this.rainbowName) {
      const c = Phaser.Display.Color.HSVToRGB((now / 2500) % 1, 0.65, 1) as Phaser.Types.Display.ColorObject;
      this.nameText.setColor(Phaser.Display.Color.RGBToString(c.r, c.g, c.b));
    }
  }

  private applyAnim(force = false) {
    let key: string;
    if (this.emoteUntil && !this.vehicle) key = `${this.texKey}:emote_${this.emoteId}`;
    // On a bike the legs don't walk: use the idle frames for the riding pose.
    else key = `${this.texKey}:${this.moving && !this.vehicle ? 'walk' : 'idle'}_${VIEW_OF[this.dir]}`;
    this.sprite.setFlipX(!this.emoteUntil && this.dir === 'right');
    if (this.bike) {
      const view = VIEW_OF[this.dir];
      this.bike.setTexture(view === 'side' ? 'bike_side' : view === 'front' ? 'bike_front' : 'bike_back');
      this.bike.setFlipX(this.dir === 'right');
      // Seen from behind, the bike is in front of the rider.
      this.container.moveTo(this.bike, view === 'back' ? this.container.getIndex(this.sprite) + 1 : this.auraGlow ? 1 : 0);
    }
    if (force || this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key, true);
  }

  get currentCosmetics() {
    return this.cosmetics;
  }

  get currentEmote() {
    return this.emoteUntil ? this.emoteId : null;
  }

  /** Play (or restart, if spammed) an emote. Continuous emotes run until stopEmote(). */
  playEmote(id: string, def: { emoji: string; loop: boolean; durationMs: number }, particles: boolean) {
    if (!EMOTE_FRAMES[id]) return;
    const sameLoop = def.loop && this.emoteUntil === Infinity && this.emoteId === id;
    this.emoteLoopFx?.remove();
    this.emoteLoopFx = null;
    this.emoteId = id;
    this.emoteUntil = def.loop ? Infinity : performance.now() + def.durationMs;
    if (!sameLoop) this.applyAnim(true);
    this.popEmoji(def.emoji);
    if (!particles) return;
    this.burst(id);
    const loopFx: Record<string, [number, () => void]> = {
      dance: [450, () => this.note()],
      cry: [260, () => this.tear()],
      sleep: [900, () => this.zzz()],
      manifest: [380, () => this.manifestFx()],
    };
    const fx = loopFx[id];
    if (fx) {
      if (def.loop) this.emoteLoopFx = this.scene.time.addEvent({ delay: fx[0], loop: true, callback: fx[1] });
      else fx[1]();
    }
  }

  stopEmote() {
    this.emoteLoopFx?.remove();
    this.emoteLoopFx = null;
    if (!this.emoteUntil) return;
    this.emoteUntil = 0;
    this.applyAnim(true);
  }

  // ---------------------------------------------------------------- emote effects
  /** Adds a short-lived effect object to the avatar (capped so spamming can't flood the scene). */
  private fx<T extends Phaser.GameObjects.GameObject>(obj: T, tween: Omit<Phaser.Types.Tweens.TweenBuilderConfig, 'targets'>): T | null {
    if (this.fxAlive > 40) {
      obj.destroy();
      return null;
    }
    this.fxAlive++;
    this.container.add(obj);
    this.scene.tweens.add({
      ...tween,
      targets: obj,
      onComplete: () => {
        this.fxAlive--;
        obj.destroy();
      },
    });
    return obj;
  }

  private popEmoji(emoji: string) {
    const t = this.scene.add.text(0, -84, emoji, { ...TEXT_BASE, fontSize: '22px' }).setOrigin(0.5, 1).setScale(0.4);
    this.fx(t, { y: -114, scale: 1.1, alpha: { from: 1, to: 0 }, duration: 1500, ease: 'Back.easeOut' });
  }

  private glyph(text: string, color: string, x: number, y: number, size = 14) {
    return this.scene.add.text(x, y, text, { ...TEXT_BASE, fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#11131f', strokeThickness: 3 }).setOrigin(0.5);
  }

  private note() {
    const side = Math.random() < 0.5 ? -1 : 1;
    const g = this.glyph(Math.random() < 0.5 ? '♪' : '♫', ['#ffd43b', '#ff8787', '#74c0fc', '#b197fc'][Math.floor(Math.random() * 4)], side * 14, -50, 16);
    this.fx(g, { x: side * (26 + Math.random() * 14), y: -84 - Math.random() * 14, angle: side * 25, alpha: { from: 1, to: 0 }, duration: 1300, ease: 'Sine.easeOut' });
  }

  private tear() {
    const side = Math.random() < 0.5 ? -1 : 1;
    const d = this.scene.add.ellipse(side * 6, -40, 4, 6, 0x5aaaff, 0.9);
    this.fx(d, { x: side * (16 + Math.random() * 10), y: -14, alpha: { from: 0.9, to: 0 }, duration: 650, ease: 'Quad.easeIn' });
  }

  private manifestFx() {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const g = Math.random() < 0.6 ? this.glyph('✦', '#fcc419', rnd(-22, 22), rnd(-30, -6), 11) : this.glyph('💰', '#fcc419', rnd(-18, 18), -10, 12);
    this.fx(g, { y: '-=40', alpha: { from: 1, to: 0 }, scale: { from: 0.6, to: 1.2 }, duration: 1500, ease: 'Sine.easeOut' });
  }

  /** A small floating text above the head (e.g. manifest earnings). */
  floatText(text: string, color = '#8ce99a') {
    const t = this.glyph(text, color, 0, -92, 11);
    this.fx(t, { y: -118, alpha: { from: 1, to: 0 }, duration: 1100, ease: 'Sine.easeOut' });
  }

  private zzz() {
    const z = this.glyph('Z', '#d0ebff', 10, -50, 12);
    this.fx(z, { x: 26, y: -86, scale: { from: 0.7, to: 1.5 }, alpha: { from: 1, to: 0 }, duration: 1800, ease: 'Sine.easeOut' });
  }

  private burst(id: string) {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    if (id === 'cheer') {
      const colors = [0xff6b6b, 0xffd43b, 0x69db7c, 0x4dabf7, 0xda77f2, 0xffa94d];
      for (let i = 0; i < 18; i++) {
        const r = this.scene.add.rectangle(0, -60, 4, 7, colors[i % colors.length]);
        this.fx(r, { x: rnd(-40, 40), y: rnd(-20, 10), angle: rnd(-360, 360), alpha: { from: 1, to: 0 }, duration: rnd(900, 1400), ease: 'Quad.easeOut' });
      }
    } else if (id === 'flex' || id === 'salam') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const g = this.glyph('✦', id === 'flex' ? '#ffd43b' : '#c3fae8', Math.cos(a) * 10, -40 + Math.sin(a) * 10, 12);
        this.fx(g, { x: Math.cos(a) * 30, y: -40 + Math.sin(a) * 26, alpha: { from: 1, to: 0 }, scale: { from: 0.6, to: 1.3 }, duration: 900 });
      }
    } else if (id === 'clap') {
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.45;
        const l = this.scene.add.rectangle(0, -38, 2, 6, 0xffe066).setRotation(a + Math.PI / 2);
        this.fx(l, { x: Math.cos(a) * 18, y: -38 + Math.sin(a) * 18, alpha: { from: 1, to: 0 }, duration: 400 });
      }
    } else if (id === 'laugh') {
      for (const [i, side] of [[0, -1], [1, 1]] as const) {
        const g = this.glyph('HA', '#ffe066', side * 20, -56 - i * 6, 12);
        this.fx(g, { y: -84 - i * 6, x: side * 30, alpha: { from: 1, to: 0 }, duration: 1100, delay: i * 180 });
      }
    } else if (id === 'wave') {
      const g = this.glyph('Hi!', '#ffffff', 22, -60, 12);
      this.fx(g, { y: -76, alpha: { from: 1, to: 0 }, duration: 1200 });
    }
  }

  say(text: string, ms: number) {
    this.bubble?.destroy();
    this.bubbleTimer?.remove();
    const label = this.scene.add
      .text(0, 0, text.length > 90 ? `${text.slice(0, 88)}…` : text, {
        ...TEXT_BASE,
        fontSize: '12px',
        color: '#1d2133',
        wordWrap: { width: 150, useAdvancedWrap: true },
        align: 'center',
      })
      .setOrigin(0.5, 1);
    const w = label.width + 14;
    const h = label.height + 10;
    const g = this.scene.add.graphics();
    g.fillStyle(0xffffff, 0.96).fillRoundedRect(-w / 2, -h, w, h, 8);
    g.fillTriangle(-5, 0, 5, 0, 0, 6);
    g.lineStyle(1, 0x1d2133, 0.25).strokeRoundedRect(-w / 2, -h, w, h, 8);
    label.setY(-5);
    this.bubble = this.scene.add.container(0, -82, [g, label]);
    this.container.add(this.bubble);
    this.bubbleTimer = this.scene.time.delayedCall(ms, () => {
      this.bubble?.destroy();
      this.bubble = null;
    });
  }

  destroy() {
    this.emoteLoopFx?.remove();
    this.auraFx?.remove();
    this.bubbleTimer?.remove();
    this.container.destroy(true);
  }
}

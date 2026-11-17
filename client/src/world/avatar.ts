// A character in the world: baked spritesheet + nameplate + speech bubble + emotes.
import Phaser from 'phaser';
import { appearanceKey, type Appearance, type CharacterConfig, type Direction } from '@kh/shared';
import { EMOTE_FRAMES, FRAME_COUNT, FRAME_PX_H, FRAME_PX_W, COLS, idleFrames, ORIGIN_Y, RES, renderSheet, walkFrames } from '../character/sheet';
import type { View } from '../character/draw';

const VIEW_OF: Record<Direction, View> = { down: 'front', up: 'back', left: 'side', right: 'side' };

/** Creates (once) the texture + animations for an appearance. Returns the texture key. */
export function ensureCharacterTexture(scene: Phaser.Scene, a: Appearance, cfg: CharacterConfig): string {
  const key = `char_${appearanceKey(a)}`;
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.addCanvas(key, renderSheet(a, cfg))!;
  for (let i = 0; i < FRAME_COUNT; i++) {
    tex.add(i, 0, (i % COLS) * FRAME_PX_W, Math.floor(i / COLS) * FRAME_PX_H, FRAME_PX_W, FRAME_PX_H);
  }
  const mk = (name: string, frames: number[], frameRate: number, repeat = -1) =>
    scene.anims.create({ key: `${key}:${name}`, frames: frames.map((f) => ({ key, frame: f })), frameRate, repeat });
  for (const view of ['front', 'back', 'side'] as View[]) {
    mk(`idle_${view}`, idleFrames(view), 2);
    mk(`walk_${view}`, walkFrames(view), 9);
  }
  const EMOTE_FPS: Record<string, number> = { dance: 6, cry: 4, sit: 1.5, sleep: 1.5, clap: 8, cheer: 6, wave: 6, laugh: 7, flex: 4, salam: 3 };
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
  dir: Direction = 'down';
  moving = false;

  constructor(
    private scene: Phaser.Scene,
    private cfg: CharacterConfig,
    opts: { name: string; level: number; appearance: Appearance; x: number; y: number; isSelf: boolean },
  ) {
    this.sprite = scene.add.sprite(0, 0, '__DEFAULT').setOrigin(0.5, ORIGIN_Y).setScale(1 / RES);
    this.nameText = scene.add
      .text(0, -66, opts.name, { ...TEXT_BASE, fontSize: '12px', fontStyle: 'bold', color: opts.isSelf ? '#ffe066' : '#ffffff', stroke: '#11131f', strokeThickness: 3 })
      .setOrigin(0.5, 1);
    this.badge = scene.add
      .text(0, -66, `${opts.level}`, { ...TEXT_BASE, fontSize: '10px', fontStyle: 'bold', color: '#1b1300', backgroundColor: '#f59f00', padding: { x: 4, y: 1 } })
      .setOrigin(1, 1);
    this.container = scene.add.container(opts.x, opts.y, [this.sprite, this.badge, this.nameText]);
    this.layoutNameplate();
    this.setAppearance(opts.appearance);
    this.setPosition(opts.x, opts.y);
  }

  private layoutNameplate() {
    const w = this.nameText.width + this.badge.width + 4;
    this.badge.setX(-w / 2 + this.badge.width);
    this.nameText.setX(-w / 2 + this.badge.width + 4 + this.nameText.width / 2);
  }

  setAppearance(a: Appearance) {
    this.texKey = ensureCharacterTexture(this.scene, a, this.cfg);
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
  }

  private applyAnim(force = false) {
    let key: string;
    if (this.emoteUntil) key = `${this.texKey}:emote_${this.emoteId}`;
    else key = `${this.texKey}:${this.moving ? 'walk' : 'idle'}_${VIEW_OF[this.dir]}`;
    this.sprite.setFlipX(!this.emoteUntil && this.dir === 'right');
    if (force || this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key, true);
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
    this.bubbleTimer?.remove();
    this.container.destroy(true);
  }
}

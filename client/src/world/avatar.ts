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
  for (const [id, frames] of Object.entries(EMOTE_FRAMES)) mk(`emote_${id}`, frames, id === 'dance' ? 4 : 5);
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
    if (moving && this.emoteUntil) this.emoteUntil = 0; // walking cancels an emote
    if (changed) this.applyAnim();
  }

  /** Called every frame: ends emotes when their time is up. */
  tick(now: number) {
    if (this.emoteUntil && now > this.emoteUntil) {
      this.emoteUntil = 0;
      this.applyAnim(true);
    }
  }

  private applyAnim(force = false) {
    let key: string;
    if (this.emoteUntil) key = `${this.texKey}:emote_${this.emoteId}`;
    else key = `${this.texKey}:${this.moving ? 'walk' : 'idle'}_${VIEW_OF[this.dir]}`;
    this.sprite.setFlipX(!this.emoteUntil && this.dir === 'right');
    if (force || this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key, true);
  }

  playEmote(id: string, emoji: string) {
    if (!EMOTE_FRAMES[id]) return;
    this.emoteId = id;
    this.emoteUntil = performance.now() + 2600;
    this.applyAnim(true);
    const t = this.scene.add.text(0, -86, emoji, { ...TEXT_BASE, fontSize: '24px' }).setOrigin(0.5, 1);
    this.container.add(t);
    this.scene.tweens.add({ targets: t, y: -112, alpha: 0, duration: 1800, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
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
    this.bubbleTimer?.remove();
    this.container.destroy(true);
  }
}

// Bakes a character into a spritesheet canvas, drawn at 2× for sharp phones.
// Frame layout:
//   0-5   front: idle0 idle1 walk0..3      6-11 back      12-17 side (faces left)
//   18+   emotes (front view), 4 frames each, in EMOTE_ORDER
//   then  riding: front, back, side (hands forward on the handlebar / holding the rider)
import type { Appearance, CharacterConfig } from '@kh/shared';
import { drawCharacter, FRAME_H, FRAME_W, type Pose, type View, type WornCosmetics } from './draw';

export const RES = 2;
export const COLS = 8;
export const FRAME_PX_W = FRAME_W * RES;
export const FRAME_PX_H = FRAME_H * RES;
/** Feet position inside a frame (0..1), for sprite origins. */
export const ORIGIN_Y = 68 / 72;

const VIEWS: View[] = ['front', 'back', 'side'];
const F = 'front' as const;

/** Four poses per emote. Arm angles are radians from hanging down; a negative bend folds
 *  the forearm inward (towards the face/chest). */
const EMOTE_POSES: Record<string, Pose[]> = {
  wave: [
    { view: F, armR: 1.9, bendR: 0.85, mouth: 'smile' },
    { view: F, armR: 1.95, bendR: 0.35, mouth: 'smile', tilt: 0.03 },
    { view: F, armR: 1.9, bendR: 0.85, mouth: 'grin' },
    { view: F, armR: 1.95, bendR: 0.35, mouth: 'smile', tilt: 0.03, bob: -0.5 },
  ],
  dance: [
    { view: F, tilt: -0.14, armL: 2.4, armR: 0.5, bendR: -1.4, legL: 1, bob: -1.5, mouth: 'grin', eyes: 'happy' },
    { view: F, armL: 1.3, armR: 1.3, bendL: 0.6, bendR: 0.6, bob: 0, mouth: 'open' },
    { view: F, tilt: 0.14, armR: 2.4, armL: 0.5, bendL: -1.4, legR: 1, bob: -1.5, mouth: 'grin', eyes: 'happy' },
    { view: F, armL: 0.5, armR: 0.5, bendL: -1.9, bendR: -1.9, bob: 0.5, mouth: 'smile' },
  ],
  laugh: [
    { view: F, eyes: 'happy', mouth: 'laugh', armL: 0.25, bendL: -1.7, tilt: -0.04 },
    { view: F, eyes: 'happy', mouth: 'laugh', armL: 0.3, bendL: -1.8, bob: -1.5, tilt: 0.05 },
    { view: F, eyes: 'happy', mouth: 'laugh', armL: 0.25, bendL: -1.7, armR: 0.25, bendR: -1.7, tilt: -0.05 },
    { view: F, eyes: 'happy', mouth: 'laugh', armL: 0.3, bendL: -1.8, bob: -1.5, tilt: 0.04 },
  ],
  cry: [
    { view: F, eyes: 'closed', mouth: 'cry', tears: 1, armL: 0.45, bendL: -2.5, armR: 0.45, bendR: -2.5 },
    { view: F, eyes: 'closed', mouth: 'cry', tears: 2, armL: 0.5, bendL: -2.6, armR: 0.5, bendR: -2.6, tilt: 0.03, bob: 0.4 },
    { view: F, eyes: 'closed', mouth: 'cry', tears: 1, armL: 0.45, bendL: -2.5, armR: 0.45, bendR: -2.5, tilt: -0.03 },
    { view: F, eyes: 'closed', mouth: 'open', tears: 2, armL: 0.5, bendL: -2.6, armR: 0.5, bendR: -2.6, bob: 0.6 },
  ],
  flex: [
    { view: F, armL: 1.1, armR: 1.1, bendL: 0.8, bendR: 0.8, mouth: 'smile' },
    { view: F, armL: 1.5, bendL: 1.65, armR: 1.5, bendR: 1.65, mouth: 'grin' },
    { view: F, armL: 1.65, bendL: 1.85, armR: 1.65, bendR: 1.85, mouth: 'grin', bob: -0.8, eyes: 'happy' },
    { view: F, armL: 1.55, bendL: 1.75, armR: 1.55, bendR: 1.75, mouth: 'grin', tilt: 0.04 },
  ],
  clap: [
    { view: F, armL: 0.55, bendL: -1.2, armR: 0.55, bendR: -1.2, mouth: 'smile' },
    { view: F, armL: 0.35, bendL: -1.75, armR: 0.35, bendR: -1.75, mouth: 'open', eyes: 'happy' },
    { view: F, armL: 0.55, bendL: -1.2, armR: 0.55, bendR: -1.2, mouth: 'smile', bob: -0.4 },
    { view: F, armL: 0.35, bendL: -1.75, armR: 0.35, bendR: -1.75, mouth: 'grin', eyes: 'happy' },
  ],
  cheer: [
    { view: F, armL: 1.6, armR: 1.6, bendL: 0.6, bendR: 0.6, bob: 0.8, mouth: 'open' },
    { view: F, armL: 2.8, armR: 2.8, legL: 1, legR: 1, bob: -4, mouth: 'laugh', eyes: 'happy' },
    { view: F, armL: 2.95, armR: 2.95, legL: 0.6, legR: 0.6, bob: -6, mouth: 'laugh', eyes: 'happy' },
    { view: F, armL: 2.6, armR: 2.6, bob: -2, mouth: 'grin', eyes: 'happy' },
  ],
  salam: [
    { view: F, armL: 0.3, bendL: -1.4, armR: 0.3, bendR: -1.4, mouth: 'smile' },
    { view: F, armL: 0.25, bendL: -1.95, armR: 0.25, bendR: -1.95, mouth: 'smile', eyes: 'happy' },
    { view: F, armL: 0.25, bendL: -1.95, armR: 0.25, bendR: -1.95, mouth: 'smile', eyes: 'happy', bob: 0.8 },
    { view: F, armL: 0.25, bendL: -1.95, armR: 0.25, bendR: -1.95, mouth: 'smile', eyes: 'happy', bob: 0.4 },
  ],
  /** Sitting on a chair seen from the side (faces left; flipped to face right). */
  sitside: [
    { view: 'side', sit: true, armL: 0.75, bendL: 0.55, armR: 0.6, bendR: 0.5, mouth: 'smile' },
    { view: 'side', sit: true, armL: 0.75, bendL: 0.55, armR: 0.6, bendR: 0.5, mouth: 'smile', bob: 0.4 },
    { view: 'side', sit: true, armL: 0.8, bendL: 0.7, armR: 0.6, bendR: 0.5, mouth: 'smile' },
    { view: 'side', sit: true, armL: 0.75, bendL: 0.55, armR: 0.6, bendR: 0.5, mouth: 'neutral', bob: 0.4 },
  ],
  sit: [
    { view: F, sit: true, armL: 0.35, armR: 0.35, bendL: -0.6, bendR: -0.6, mouth: 'smile' },
    { view: F, sit: true, armL: 0.35, armR: 0.35, bendL: -0.6, bendR: -0.6, mouth: 'smile', bob: 0.4 },
    { view: F, sit: true, armL: 0.35, armR: 0.35, bendL: -0.6, bendR: -0.6, mouth: 'smile' },
    { view: F, sit: true, armL: 0.35, armR: 0.35, bendL: -0.6, bendR: -0.6, mouth: 'neutral', eyes: 'happy', bob: 0.4 },
  ],
  // Cross-legged, eyes closed, hands together, gently levitating while wealth flows in.
  manifest: [
    { view: F, sit: true, eyes: 'closed', mouth: 'smile', armL: 0.3, bendL: -1.95, armR: 0.3, bendR: -1.95, bob: -3 },
    { view: F, sit: true, eyes: 'closed', mouth: 'smile', armL: 0.3, bendL: -1.95, armR: 0.3, bendR: -1.95, bob: -4.5 },
    { view: F, sit: true, eyes: 'closed', mouth: 'smile', armL: 0.3, bendL: -1.95, armR: 0.3, bendR: -1.95, bob: -5.5 },
    { view: F, sit: true, eyes: 'closed', mouth: 'smile', armL: 0.3, bendL: -1.95, armR: 0.3, bendR: -1.95, bob: -4.5 },
  ],
  sleep: [
    { view: F, sit: true, eyes: 'closed', mouth: 'neutral', tilt: 0.1, armL: 0.3, armR: 0.3, bendL: -0.8, bendR: -0.8 },
    { view: F, sit: true, eyes: 'closed', mouth: 'open', tilt: 0.11, armL: 0.3, armR: 0.3, bendL: -0.8, bendR: -0.8, bob: 0.5 },
    { view: F, sit: true, eyes: 'closed', mouth: 'open', tilt: 0.12, armL: 0.3, armR: 0.3, bendL: -0.8, bendR: -0.8, bob: 0.8 },
    { view: F, sit: true, eyes: 'closed', mouth: 'neutral', tilt: 0.11, armL: 0.3, armR: 0.3, bendL: -0.8, bendR: -0.8, bob: 0.4 },
  ],
};
export const EMOTE_ORDER = Object.keys(EMOTE_POSES);
const RIDE_BASE = 18 + EMOTE_ORDER.length * 4;
/** On a bike: both hands reach forward to the handlebar (side view: arms forward, elbows bent a
 *  little; front/back: arms out to the grips either side, forearms angled in). */
const RIDE_POSES: Record<View, Pose> = {
  front: { view: 'front', armL: 0.38, armR: 0.38, bendL: -0.35, bendR: -0.35 },
  back: { view: 'back', armL: 0.38, armR: 0.38, bendL: -0.35, bendR: -0.35 },
  side: { view: 'side', armL: 0.95, bendL: 0.45, armR: -0.95, bendR: -0.45 },
};
export const FRAME_COUNT = RIDE_BASE + 3;
export const EMOTE_FRAMES: Record<string, number[]> = Object.fromEntries(
  EMOTE_ORDER.map((id, e) => [id, [0, 1, 2, 3].map((k) => 18 + e * 4 + k)]),
);

export function viewIndex(view: View) {
  return VIEWS.indexOf(view);
}
export const idleFrames = (view: View) => [viewIndex(view) * 6, viewIndex(view) * 6 + 1];
export const walkFrames = (view: View) => [2, 3, 4, 5].map((k) => viewIndex(view) * 6 + k);
export const rideFrames = (view: View) => [RIDE_BASE + viewIndex(view)];

export function poseForFrame(i: number): Pose {
  if (i < 18) {
    const view = VIEWS[Math.floor(i / 6)];
    const k = i % 6;
    if (k < 2) return { view, bob: k === 1 ? 0.6 : 0 };
    const s = [1, 0, -1, 0][k - 2];
    const bob = [0, -1, 0, -1][k - 2];
    if (view === 'side') return { view, bob, legL: s, legR: -s, armL: -0.55 * s, armR: 0.55 * s };
    return { view, bob, legL: Math.max(0, s), legR: Math.max(0, -s), armL: 0.12 * s, armR: -0.12 * s };
  }
  if (i >= RIDE_BASE) return RIDE_POSES[VIEWS[i - RIDE_BASE]] ?? { view: 'front' };
  const e = Math.floor((i - 18) / 4);
  return EMOTE_POSES[EMOTE_ORDER[e]]?.[(i - 18) % 4] ?? { view: 'front' };
}

export function renderSheet(a: Appearance, cfg: CharacterConfig, worn?: WornCosmetics): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * FRAME_PX_W;
  canvas.height = Math.ceil(FRAME_COUNT / COLS) * FRAME_PX_H;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < FRAME_COUNT; i++) {
    ctx.save();
    ctx.translate((i % COLS) * FRAME_PX_W, Math.floor(i / COLS) * FRAME_PX_H);
    ctx.scale(RES, RES);
    ctx.beginPath();
    ctx.rect(0, 0, FRAME_W, FRAME_H);
    ctx.clip();
    drawCharacter(ctx, a, cfg, poseForFrame(i), worn);
    ctx.restore();
  }
  return canvas;
}

/** Draws a single pose onto a canvas (character creator preview). */
export function renderPreview(canvas: HTMLCanvasElement, a: Appearance, cfg: CharacterConfig, pose: Pose, flip = false) {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / FRAME_W, canvas.height / FRAME_H);
  ctx.translate((canvas.width - FRAME_W * scale) / 2, (canvas.height - FRAME_H * scale) / 2);
  if (flip) {
    ctx.translate(FRAME_W * scale, 0);
    ctx.scale(-1, 1);
  }
  ctx.scale(scale, scale);
  drawCharacter(ctx, a, cfg, pose);
}

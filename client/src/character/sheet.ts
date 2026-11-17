// Bakes a character into a spritesheet canvas (28 frames), drawn at 2× for sharp phones.
// Frame layout:
//   0-5   front: idle0 idle1 walk0..3      6-11 back      12-17 side (faces left)
//   18-27 emotes (front): wave dance cry flex laugh (2 frames each)
import type { Appearance, CharacterConfig } from '@kh/shared';
import { drawCharacter, FRAME_H, FRAME_W, type Pose, type View } from './draw';

export const RES = 2;
export const COLS = 7;
export const FRAME_COUNT = 28;
export const FRAME_PX_W = FRAME_W * RES;
export const FRAME_PX_H = FRAME_H * RES;
/** Feet position inside a frame (0..1), for sprite origins. */
export const ORIGIN_Y = 68 / 72;

const VIEWS: View[] = ['front', 'back', 'side'];

export const EMOTE_FRAMES: Record<string, number[]> = {
  wave: [18, 19],
  dance: [20, 21],
  cry: [22, 23],
  flex: [24, 25],
  laugh: [26, 27],
};

export function viewIndex(view: View) {
  return VIEWS.indexOf(view);
}
export const idleFrames = (view: View) => [viewIndex(view) * 6, viewIndex(view) * 6 + 1];
export const walkFrames = (view: View) => [2, 3, 4, 5].map((k) => viewIndex(view) * 6 + k);

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
  const front = 'front' as const;
  switch (i) {
    case 18: return { view: front, armR: 2.55, bendR: 0.35, mouth: 'smile' };
    case 19: return { view: front, armR: 2.9, bendR: -0.15, mouth: 'smile', bob: -0.5 };
    case 20: return { view: front, tilt: -0.12, armL: 2.3, armR: 0.6, legL: 1, bob: -1, mouth: 'grin' };
    case 21: return { view: front, tilt: 0.12, armL: 0.6, armR: 2.3, legR: 1, bob: -1, mouth: 'grin' };
    case 22: return { view: front, eyes: 'closed', mouth: 'cry', tears: 1, armL: 0.25, armR: 0.25 };
    case 23: return { view: front, eyes: 'closed', mouth: 'cry', tears: 2, bob: 0.6, armL: 0.25, armR: 0.25 };
    case 24: return { view: front, armL: 1.5, bendL: 1.65, armR: 1.5, bendR: 1.65, mouth: 'grin' };
    case 25: return { view: front, armL: 1.65, bendL: 1.8, armR: 1.65, bendR: 1.8, mouth: 'grin', bob: -0.8 };
    case 26: return { view: front, eyes: 'happy', mouth: 'laugh', tilt: -0.05 };
    default: return { view: front, eyes: 'happy', mouth: 'laugh', tilt: 0.05, bob: -1.5 };
  }
}

export function renderSheet(a: Appearance, cfg: CharacterConfig): HTMLCanvasElement {
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
    drawCharacter(ctx, a, cfg, poseForFrame(i));
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

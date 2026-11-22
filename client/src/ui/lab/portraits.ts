// ⚔️ Portraits for the flat (2D) Labirin fight cards, instead of just an emoji: you are drawn with the
// game's own character painter (your hair, face and outfit) in three poses (ready, swinging, hurt);
// monsters are pictures of their 3D models. The cards then fake the 3D with CSS: a soft shadow,
// a back-light rim, a slow turn-and-breathe, a lunge when they attack, a flash and recoil when hit.
// All made once and kept for the session (a few small images).
import type { Appearance, CharacterConfig } from '@kh/shared';
import { appearanceKey } from '@kh/shared';
import { drawCharacter, FRAME_H, FRAME_W, type Pose } from '../../character/draw';

export interface PlayerPics {
  idle: string;
  act: string;
  hurt: string;
}

const players = new Map<string, PlayerPics>();
const monsters = new Map<string, string>();
const pending = new Set<string>();

const POSES: Record<keyof PlayerPics, Pose> = {
  idle: { view: 'front', armR: 0.35, bendR: 0.3, mouth: 'smile' },
  act: { view: 'front', armR: 2.5, bendR: 0.5, legL: 0.6, mouth: 'open', tilt: 0.06 },
  hurt: { view: 'front', eyes: 'closed', mouth: 'open', tilt: -0.12, armL: 0.6, armR: 0.6, bob: 1 },
};

export function playerPics(a: Appearance, cfg: CharacterConfig): PlayerPics {
  const k = appearanceKey(a);
  let p = players.get(k);
  if (p) return p;
  const R = 3;
  const draw = (pose: Pose) => {
    const c = document.createElement('canvas');
    c.width = FRAME_W * R;
    c.height = FRAME_H * R;
    const x = c.getContext('2d')!;
    x.scale(R, R);
    drawCharacter(x, a, cfg, pose);
    return c.toDataURL('image/png');
  };
  p = { idle: draw(POSES.idle), act: draw(POSES.act), hurt: draw(POSES.hurt) };
  players.set(k, p);
  return p;
}

export const monsterKey = (kind?: string, icon?: string, boss?: boolean, size = 200) => `${kind ?? icon ?? '?'}${boss ? '|boss' : ''}@${size}`;

/** A monster's picture (`size` px; small sizes are rendered without smoothing: pixel art). */
export function monsterPic(kind?: string, icon?: string, boss?: boolean, size = 200): string | undefined {
  return monsters.get(monsterKey(kind, icon, boss, size));
}

/** Render the monsters we don't have pictures of yet (once), then call `done`. */
/** A monster's posed pictures for the pixel-art stage (idle0, idle1, windup, strike, hurt), if made. */
export function monsterPoses(kind?: string, icon?: string, boss?: boolean): Record<string, string> | undefined {
  const k = monsterKey(kind, icon, boss, POSE_SIZE);
  const idle = monsters.get(`${k}#idle0`);
  if (!idle) return undefined;
  const out: Record<string, string> = {};
  for (const p of ['idle0', 'idle1', 'windup', 'strike', 'hurt']) out[p] = monsters.get(`${k}#${p}`) ?? idle;
  return out;
}
const POSE_SIZE = 240;

/** Render the posed pictures of monsters we don't have yet (once), then call `done`. */
export async function loadMonsterPoses(list: Array<{ kind?: string; icon?: string; boss?: boolean }>, done: () => void) {
  const todo = list
    .map((f) => ({ ...f, key: monsterKey(f.kind, f.icon, f.boss, POSE_SIZE) }))
    .filter((f, i, all) => !monsters.has(`${f.key}#idle0`) && !pending.has(f.key) && all.findIndex((g) => g.key === f.key) === i);
  if (!todo.length) return;
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
  for (const t of todo) pending.add(t.key);
  try {
    const { snapshotMonsters } = await import('./battle3d/snapshot');
    for (const [k, url] of await snapshotMonsters(todo, POSE_SIZE, true)) monsters.set(k, url);
    done();
  } catch (err) {
    console.warn('[lab] monster pictures unavailable', err);
  } finally {
    for (const t of todo) pending.delete(t.key);
  }
}

export async function loadMonsterPics(list: Array<{ kind?: string; icon?: string; boss?: boolean }>, done: () => void, size = 200) {
  const todo = list
    .map((f) => ({ ...f, key: monsterKey(f.kind, f.icon, f.boss, size) }))
    .filter((f, i, all) => !monsters.has(f.key) && !pending.has(f.key) && all.findIndex((g) => g.key === f.key) === i);
  if (!todo.length) return;
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return; // no 3D at all: the emoji stays
  for (const t of todo) pending.add(t.key);
  try {
    const { snapshotMonsters } = await import('./battle3d/snapshot');
    for (const [k, url] of await snapshotMonsters(todo, size)) monsters.set(k, url);
    done();
  } catch (err) {
    console.warn('[lab] monster pictures unavailable', err);
  } finally {
    for (const t of todo) pending.delete(t.key);
  }
}

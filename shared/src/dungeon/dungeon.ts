// ⚔️ Gua Gelap: the dungeon (a player idea from the 🐞 inbox). A cave under Kota Damansara, one
// enemy per floor, a boss every few floors. Each turn is two taps the server grades:
//  - STRIKE: a marker sweeps across a bar; tap while it's in the zone (closer to the middle =
//    more damage, Perfect = a critical hit).
//  - BLOCK: the enemy winds up and swings; tap as it lands (Perfect = parry, no damage).
// Clear a floor and you choose: cash out with the loot so far, or go deeper. Fall, and half the
// loot is lost. Loot is money (scaled to your wealth stage), XP, and shards from bosses.
// Everything here is pure (no clock, no randomness of its own): the server owns the run.
import { z } from 'zod';
import type { RandInt } from '../luck';

const grade = z.object({ perfect: z.number(), great: z.number(), good: z.number() });

export const dungeonConfigSchema = z.object({
  name: z.string(),
  runsPerDay: z.number().int().positive(),
  /** Loot kept when you fall (the rest is lost). */
  deathKeep: z.number().min(0).max(1),
  /** Share of max HP healed after each cleared floor. */
  healPerFloor: z.number().min(0).max(1),
  bossEvery: z.number().int().positive(),
  player: z.object({ hpBase: z.number().positive(), hpPerLevel: z.number().nonnegative(), atkBase: z.number().positive(), atkPerLevel: z.number().nonnegative() }),
  /** Enemy stats at floor 1 for a player of `level`: (base + perLevel × level) × the enemy's own mult × growth^(floor-1). */
  enemyScale: z.object({
    hpBase: z.number().positive(), hpPerLevel: z.number().nonnegative(), hpGrowth: z.number().min(1),
    atkBase: z.number().positive(), atkPerLevel: z.number().nonnegative(), atkGrowth: z.number().min(1),
    bossHp: z.number().positive(), bossAtk: z.number().positive(),
  }),
  enemies: z.array(z.object({
    id: z.string(), name: z.string(), icon: z.string(), color: z.string(),
    hp: z.number().positive(), atk: z.number().positive(),
    /** Floors it can appear on (inclusive; null = no upper bound). */
    floors: z.tuple([z.number().int().positive(), z.number().int().positive().nullable()]),
    boss: z.boolean().default(false),
    line: z.string().default(''),
  })).min(2),
  strike: z.object({
    /** One sweep of the marker across the bar (ms) at floor 1, then faster by perFloorMs, never under minMs. */
    sweepMs: z.number().positive(), perFloorMs: z.number().nonnegative(), minMs: z.number().positive(),
    /** Distance from the zone's middle (share of the bar) for each grade. */
    zone: grade,
    /** Damage × your attack for each grade (miss = outside the good zone). */
    mult: grade.extend({ miss: z.number() }),
    /** Tap within this long or it's a miss (ms). */
    timeoutMs: z.number().positive(),
  }),
  block: z.object({
    /** The enemy's wind-up after your strike (ms), picked between these. */
    windupMs: z.tuple([z.number().positive(), z.number().positive()]),
    /** Pause between your strike and the wind-up starting (ms). */
    gapMs: z.number().nonnegative(),
    /** How far off (ms) each grade allows. */
    windowMs: grade,
    /** Share of the enemy's hit you still take. */
    taken: grade.extend({ miss: z.number() }),
  }),
  /** Money per cleared floor at each wealth stage (sen), × (1 + perFloor × (floor − 1)), × boss. */
  reward: z.object({
    floorSen: z.array(z.number().nonnegative()).min(1),
    perFloor: z.number().nonnegative(),
    bossMult: z.number().positive(),
    xpBase: z.number().nonnegative(), xpPerFloor: z.number().nonnegative(),
    bossShards: z.number().nonnegative(),
  }),
});
export type DungeonConfig = z.infer<typeof dungeonConfigSchema>;
export type DungeonEnemyDef = DungeonConfig['enemies'][number];
export type HitGrade = 'perfect' | 'great' | 'good' | 'miss';

export interface DungeonEnemy {
  id: string;
  name: string;
  icon: string;
  boss: boolean;
  hp: number;
  maxHp: number;
  atk: number;
}

/** What the client needs to play one turn (the server keeps when it was issued). */
export interface DungeonTurn {
  nonce: number;
  /** One sweep across the bar (ms); the marker goes 0 → 1 → 0 … */
  sweepMs: number;
  /** Middle of the strike zone (0..1). */
  zone: number;
  /** The enemy's wind-up (ms after gapMs after your strike). */
  windupMs: number;
}

export interface DungeonLoot {
  sen: number;
  shards: number;
  xp: number;
}

export interface DungeonRun {
  floor: number;
  hp: number;
  maxHp: number;
  atk: number;
  enemy: DungeonEnemy;
  /** fight: a turn is ready; cleared: choose deeper or cash out; dead: it's over. */
  phase: 'fight' | 'cleared' | 'dead';
  loot: DungeonLoot;
  turn: DungeonTurn | null;
}

export interface DungeonView {
  name: string;
  runsLeft: number;
  runsPerDay: number;
  best: number;
  run: DungeonRun | null;
}

export interface TurnResult {
  strike: HitGrade;
  block: HitGrade | null;
  dealt: number;
  taken: number;
  crit: boolean;
  parried: boolean;
  killed: boolean;
  dead: boolean;
  /** Loot for this floor (when killed). */
  floorLoot: DungeonLoot | null;
}

export function isBossFloor(cfg: DungeonConfig, floor: number): boolean {
  return floor % cfg.bossEvery === 0;
}

export function playerStats(cfg: DungeonConfig, level: number): { hp: number; atk: number } {
  const p = cfg.player;
  return { hp: Math.round(p.hpBase + p.hpPerLevel * level), atk: Math.round(p.atkBase + p.atkPerLevel * level) };
}

/** The enemy on this floor (a boss on boss floors). */
export function enemyFor(cfg: DungeonConfig, floor: number, level: number, rand: RandInt): DungeonEnemy {
  const boss = isBossFloor(cfg, floor);
  const fits = (e: DungeonEnemyDef) => e.boss === boss && floor >= e.floors[0] && (e.floors[1] === null || floor <= e.floors[1]);
  let pool = cfg.enemies.filter(fits);
  // Deeper than anything is set for: the deepest ones of the right kind.
  if (!pool.length) {
    const kind = cfg.enemies.filter((e) => e.boss === boss);
    const top = Math.max(...kind.map((e) => e.floors[0]));
    pool = kind.filter((e) => e.floors[0] === top);
  }
  const def = pool[rand(pool.length)];
  const s = cfg.enemyScale;
  const hp = Math.round((s.hpBase + s.hpPerLevel * level) * def.hp * s.hpGrowth ** (floor - 1) * (boss ? s.bossHp : 1));
  const atk = Math.round((s.atkBase + s.atkPerLevel * level) * def.atk * s.atkGrowth ** (floor - 1) * (boss ? s.bossAtk : 1));
  return { id: def.id, name: def.name, icon: def.icon, boss, hp, maxHp: hp, atk };
}

/** A new turn's parameters (nonce from the caller). */
export function makeTurn(cfg: DungeonConfig, floor: number, nonce: number, rand: RandInt): DungeonTurn {
  const st = cfg.strike;
  const sweepMs = Math.max(st.minMs, st.sweepMs - st.perFloorMs * (floor - 1));
  const zone = 0.2 + rand(601) / 1000; // 0.2 … 0.8
  const [w0, w1] = cfg.block.windupMs;
  return { nonce, sweepMs, zone, windupMs: Math.round(w0 + (rand(1001) / 1000) * (w1 - w0)) };
}

/** Where the strike marker is (0..1) `ms` into the turn: it bounces 0 → 1 → 0 … */
export function markerAt(sweepMs: number, ms: number): number {
  const t = Math.max(0, ms) / sweepMs;
  const k = t % 2;
  return k <= 1 ? k : 2 - k;
}

export function gradeStrike(cfg: DungeonConfig, turn: Pick<DungeonTurn, 'sweepMs' | 'zone'>, strikeMs: number | null): HitGrade {
  if (strikeMs === null || strikeMs > cfg.strike.timeoutMs) return 'miss';
  const d = Math.abs(markerAt(turn.sweepMs, strikeMs) - turn.zone);
  const z = cfg.strike.zone;
  return d <= z.perfect ? 'perfect' : d <= z.great ? 'great' : d <= z.good ? 'good' : 'miss';
}

/** When the enemy's hit lands (ms into the turn), given when you struck. */
export function hitLandsAt(cfg: DungeonConfig, turn: Pick<DungeonTurn, 'windupMs'>, strikeMs: number): number {
  return Math.min(strikeMs, cfg.strike.timeoutMs) + cfg.block.gapMs + turn.windupMs;
}

export function gradeBlock(cfg: DungeonConfig, turn: Pick<DungeonTurn, 'windupMs'>, strikeMs: number | null, blockMs: number | null): HitGrade {
  if (blockMs === null) return 'miss';
  const lands = hitLandsAt(cfg, turn, strikeMs ?? cfg.strike.timeoutMs);
  const d = Math.abs(blockMs - lands);
  const w = cfg.block.windowMs;
  return d <= w.perfect ? 'perfect' : d <= w.great ? 'great' : d <= w.good ? 'good' : 'miss';
}

/** Money, XP and shards for clearing `floor` at wealth stage `stage`. */
export function floorLoot(cfg: DungeonConfig, stage: number, floor: number): DungeonLoot {
  const r = cfg.reward;
  const base = r.floorSen[Math.min(r.floorSen.length - 1, Math.max(0, stage - 1))];
  const boss = isBossFloor(cfg, floor);
  return {
    sen: Math.round(base * (1 + r.perFloor * (floor - 1)) * (boss ? r.bossMult : 1)),
    shards: boss ? Math.round(r.bossShards * (floor / cfg.bossEvery)) : 0,
    xp: Math.round(r.xpBase + r.xpPerFloor * floor),
  };
}

/**
 * One turn: your strike, then (if the enemy is still up) its hit, reduced by your block. Mutates
 * `run` (HP, phase, loot).
 */
export function resolveTurn(cfg: DungeonConfig, run: DungeonRun, turn: DungeonTurn, strikeMs: number | null, blockMs: number | null, stage: number): TurnResult {
  const strike = gradeStrike(cfg, turn, strikeMs);
  const dealt = Math.max(strike === 'miss' ? 0 : 1, Math.round(run.atk * cfg.strike.mult[strike]));
  run.enemy.hp = Math.max(0, run.enemy.hp - dealt);
  const res: TurnResult = { strike, block: null, dealt, taken: 0, crit: strike === 'perfect', parried: false, killed: false, dead: false, floorLoot: null };
  if (run.enemy.hp <= 0) {
    res.killed = true;
    const loot = floorLoot(cfg, stage, run.floor);
    run.loot = { sen: run.loot.sen + loot.sen, shards: run.loot.shards + loot.shards, xp: run.loot.xp + loot.xp };
    res.floorLoot = loot;
    run.phase = 'cleared';
    return res;
  }
  const block = gradeBlock(cfg, turn, strikeMs, blockMs);
  res.block = block;
  res.parried = block === 'perfect';
  res.taken = Math.round(run.enemy.atk * cfg.block.taken[block]);
  run.hp = Math.max(0, run.hp - res.taken);
  if (run.hp <= 0) {
    res.dead = true;
    run.phase = 'dead';
  }
  return res;
}

/** Loot you keep when you fall. */
export function deathLoot(cfg: DungeonConfig, loot: DungeonLoot): DungeonLoot {
  return { sen: Math.floor(loot.sen * cfg.deathKeep), shards: Math.floor(loot.shards * cfg.deathKeep), xp: Math.floor(loot.xp * cfg.deathKeep) };
}

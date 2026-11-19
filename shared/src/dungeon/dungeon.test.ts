import { describe, expect, it } from 'vitest';
import dungeonJson from '../../config/dungeon.json';
import {
  deathLoot, dungeonConfigSchema, enemyFor, floorLoot, gradeBlock, gradeStrike, hitLandsAt, isBossFloor, makeTurn, markerAt, playerStats, resolveTurn,
  type DungeonRun, type HitGrade,
} from './dungeon';

const cfg = dungeonConfigSchema.parse(dungeonJson);

function seeded(seed: number) {
  let a = seed >>> 0;
  return (max: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
  };
}

/** When the marker is exactly in the zone's middle (first pass). */
const perfectStrikeMs = (sweepMs: number, zone: number) => zone * sweepMs;

describe('dungeon: the timing', () => {
  it('the marker bounces 0 → 1 → 0', () => {
    expect(markerAt(1000, 0)).toBe(0);
    expect(markerAt(1000, 500)).toBeCloseTo(0.5);
    expect(markerAt(1000, 1000)).toBeCloseTo(1);
    expect(markerAt(1000, 1500)).toBeCloseTo(0.5);
    expect(markerAt(1000, 2000)).toBeCloseTo(0);
  });

  it('strikes and blocks are graded by how close they are', () => {
    const turn = { sweepMs: 1000, zone: 0.5, windupMs: 1000 };
    expect(gradeStrike(cfg, turn, 500)).toBe('perfect');
    expect(gradeStrike(cfg, turn, 500 + cfg.strike.zone.great * 1000 - 5)).toBe('great');
    expect(gradeStrike(cfg, turn, 500 + cfg.strike.zone.good * 1000 - 5)).toBe('good');
    expect(gradeStrike(cfg, turn, 100)).toBe('miss');
    expect(gradeStrike(cfg, turn, null)).toBe('miss');
    expect(gradeStrike(cfg, turn, cfg.strike.timeoutMs + 1)).toBe('miss');
    const lands = hitLandsAt(cfg, turn, 500);
    expect(gradeBlock(cfg, turn, 500, lands + 10)).toBe('perfect');
    expect(gradeBlock(cfg, turn, 500, lands - cfg.block.windowMs.great + 5)).toBe('great');
    expect(gradeBlock(cfg, turn, 500, lands + cfg.block.windowMs.good - 5)).toBe('good');
    expect(gradeBlock(cfg, turn, 500, lands + 2000)).toBe('miss');
    expect(gradeBlock(cfg, turn, 500, null)).toBe('miss');
  });
});

describe('dungeon: floors, enemies, loot', () => {
  it('bosses on every bossEvery-th floor; enemies get tougher deeper', () => {
    const r = seeded(1);
    expect(isBossFloor(cfg, cfg.bossEvery)).toBe(true);
    expect(enemyFor(cfg, cfg.bossEvery, 10, r).boss).toBe(true);
    expect(enemyFor(cfg, 1, 10, r).boss).toBe(false);
    const avg = (floor: number) => {
      let hp = 0;
      for (let i = 0; i < 50; i++) hp += enemyFor(cfg, floor, 10, r).maxHp;
      return hp / 50;
    };
    expect(avg(9)).toBeGreaterThan(avg(1) * 1.5);
    // Way past the last configured floor still works (the deepest ones).
    expect(enemyFor(cfg, 60, 10, r).hp).toBeGreaterThan(0);
    expect(enemyFor(cfg, 60, 10, r).boss).toBe(true);
  });

  it('loot scales with the wealth stage and the floor; bosses pay more and give shards', () => {
    expect(floorLoot(cfg, 3, 1).sen).toBeGreaterThan(floorLoot(cfg, 1, 1).sen * 10);
    expect(floorLoot(cfg, 1, 4).sen).toBeGreaterThan(floorLoot(cfg, 1, 1).sen);
    const boss = floorLoot(cfg, 1, cfg.bossEvery);
    expect(boss.sen).toBeGreaterThan(floorLoot(cfg, 1, cfg.bossEvery - 1).sen * 2);
    expect(boss.shards).toBeGreaterThan(0);
    expect(floorLoot(cfg, 1, 1).shards).toBe(0);
    expect(floorLoot(cfg, 99, 1).sen).toBe(floorLoot(cfg, cfg.reward.floorSen.length, 1).sen); // capped
    expect(deathLoot(cfg, { sen: 1001, shards: 9, xp: 7 })).toEqual({ sen: 500, shards: 4, xp: 3 });
  });

  it('a turn: your hit, then theirs (blocked or not); a kill banks the floor loot', () => {
    const r = seeded(2);
    const st = playerStats(cfg, 10);
    const enemy = enemyFor(cfg, 1, 10, r);
    const run: DungeonRun = { floor: 1, hp: st.hp, maxHp: st.hp, atk: st.atk, enemy, phase: 'fight', loot: { sen: 0, shards: 0, xp: 0 }, turn: null };
    const turn = makeTurn(cfg, 1, 1, r);
    const sMs = perfectStrikeMs(turn.sweepMs, turn.zone);
    const res = resolveTurn(cfg, run, turn, sMs, hitLandsAt(cfg, turn, sMs), 1);
    expect(res.strike).toBe('perfect');
    expect(res.crit).toBe(true);
    expect(res.dealt).toBe(Math.round(st.atk * cfg.strike.mult.perfect));
    if (!res.killed) {
      expect(res.parried).toBe(true);
      expect(res.taken).toBe(0);
    }
    // Hit until it drops.
    while (run.phase === 'fight') {
      const t = makeTurn(cfg, 1, 2, r);
      resolveTurn(cfg, run, t, perfectStrikeMs(t.sweepMs, t.zone), null, 1);
    }
    expect(run.phase).toBe('cleared');
    expect(run.loot.sen).toBe(floorLoot(cfg, 1, 1).sen);
  });
});

describe('dungeon: balance', () => {
  /** How deep a player gets, playing every turn at these grades. */
  function depth(level: number, strike: HitGrade, block: HitGrade, seed: number): number {
    const r = seeded(seed);
    const st = playerStats(cfg, level);
    let floor = 1;
    const run: DungeonRun = { floor, hp: st.hp, maxHp: st.hp, atk: st.atk, enemy: enemyFor(cfg, 1, level, r), phase: 'fight', loot: { sen: 0, shards: 0, xp: 0 }, turn: null };
    for (let turns = 0; turns < 2000; turns++) {
      const t = makeTurn(cfg, floor, turns, r);
      const off = { perfect: 0, great: (cfg.strike.zone.perfect + cfg.strike.zone.great) / 2, good: (cfg.strike.zone.great + cfg.strike.zone.good) / 2, miss: 0.45 }[strike];
      const sMs = Math.max(0, (t.zone + (t.zone > 0.5 ? -off : off)) * t.sweepMs);
      const lands = hitLandsAt(cfg, t, sMs);
      const bOff = { perfect: 0, great: (cfg.block.windowMs.perfect + cfg.block.windowMs.great) / 2, good: (cfg.block.windowMs.great + cfg.block.windowMs.good) / 2, miss: 2000 }[block];
      resolveTurn(cfg, run, t, sMs, lands + bOff, 1);
      if (run.phase === 'dead') return floor;
      if (run.phase === 'cleared') {
        floor++;
        run.floor = floor;
        run.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * cfg.healPerFloor));
        run.enemy = enemyFor(cfg, floor, level, r);
        run.phase = 'fight';
      }
    }
    return floor;
  }

  it('sloppy play falls early, good play reaches a boss, great play goes deep (at any level)', () => {
    for (const level of [5, 30]) {
      const avg = (s: HitGrade, b: HitGrade) => [1, 2, 3, 4, 5].reduce((a, k) => a + depth(level, s, b, k), 0) / 5;
      const sloppy = avg('good', 'miss');
      const good = avg('great', 'good');
      const great = avg('perfect', 'great');
      expect(sloppy).toBeLessThan(cfg.bossEvery + 1);
      expect(good).toBeGreaterThanOrEqual(cfg.bossEvery);
      expect(great).toBeGreaterThan(good);
      expect(great).toBeLessThan(60); // not endless
    }
  });
});

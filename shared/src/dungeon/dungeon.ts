// ⚔️ Gua Gelap: the dungeon, fought with your Teman (pets, see ../pets). A cave under Kota
// Damansara, one enemy per floor, a boss every few floors. Battles are turn-based: each round you
// pick ⚔️ Attack, ⚡ Charge (more points, and you take less damage) or 🌟 Ultimate (spends points),
// or let Auto pick, or Skip to the end. Clear a floor and choose: cash out with the loot so far,
// or go deeper (your team patches up a little). If the whole team falls, half the loot is lost.
// Everything here is pure: the server owns the run.
import { z } from 'zod';
import type { RandInt } from '../luck';
import type { BattleEvent, Fighter } from '../pets/pets';

export const dungeonConfigSchema = z.object({
  name: z.string(),
  runsPerDay: z.number().int().positive(),
  /** Loot kept when your team falls (the rest is lost). */
  deathKeep: z.number().min(0).max(1),
  /** Share of max HP your pets heal after each cleared floor (0: HP carries over; heal in rest rooms). */
  healPerFloor: z.number().min(0).max(1),
  /**
   * Rest rooms between floors (every `every` floors, plus a `chance` after any other floor): pick one
   * of 🍲 heal (standing Teman +heal × max HP, fainted ones back at revive × max HP), 💪 a buff for
   * the rest of the run (+buffAtk attack, +buffDef defence), or 🩸 sacrifice (each standing Teman
   * loses sacrificeHp × max HP, never below 1, for sacrificeFloors × this floor's money).
   */
  rest: z.object({
    every: z.number().int().positive(),
    chance: z.number().min(0).max(1),
    heal: z.number().min(0).max(1),
    revive: z.number().min(0).max(1),
    buffAtk: z.number().min(0),
    buffDef: z.number().min(0),
    sacrificeHp: z.number().min(0).max(0.9),
    sacrificeFloors: z.number().min(0),
  }).default({ every: 4, chance: 0.15, heal: 0.5, revive: 0.25, buffAtk: 0.2, buffDef: 0.15, sacrificeHp: 0.3, sacrificeFloors: 2 }),
  bossEvery: z.number().int().positive(),
  /** Enemy stats on floor 1 (× the enemy's own mults), growing per floor. */
  enemyScale: z.object({
    hp: z.number().positive(), atk: z.number().positive(), def: z.number().positive(), spd: z.number().positive(),
    growth: z.object({ hp: z.number().min(1), atk: z.number().min(1), def: z.number().min(1), spd: z.number().min(1) }),
    bossHp: z.number().positive(), bossAtk: z.number().positive(),
  }),
  enemies: z.array(z.object({
    id: z.string(), name: z.string(), icon: z.string(), color: z.string(),
    hp: z.number().positive(), atk: z.number().positive(), def: z.number().positive().default(1), spd: z.number().positive().default(1),
    /** Floors it can appear on (inclusive; null = no upper bound). */
    floors: z.tuple([z.number().int().positive(), z.number().int().positive().nullable()]),
    boss: z.boolean().default(false),
    line: z.string().default(''),
    move: z.string().default('Serang'),
    ultimate: z.string().default('Serangan Maut'),
    /** Things it says in battle. */
    taunts: z.array(z.string()).default([]),
  })).min(2),
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

export interface DungeonLoot {
  sen: number;
  shards: number;
  /** Player XP. */
  xp: number;
  /** Pet XP (each pet on the team gets this). */
  petXp: number;
}

export interface DungeonRun {
  floor: number;
  /** Your team (in battle order); `active` is the one fighting. */
  team: Fighter[];
  active: number;
  enemy: Fighter;
  /** The enemy's lines (said when it shows up / goes for its ultimate). */
  enemyLine: string;
  /** fight: your move; cleared: choose deeper or cash out; rest: a rest room (pick one); dead: it's over. */
  phase: 'fight' | 'cleared' | 'rest' | 'dead';
  loot: DungeonLoot;
  round: number;
  /** A rest room comes before the next floor. */
  restNext: boolean;
  /** Rest-room buffs taken this run (each one stacks). */
  buffs: number;
}

export type RestChoice = 'heal' | 'buff' | 'sacrifice' | 'skip';

/** What a rest room offers right now (for the buttons): HP healed, money for a sacrifice. */
export function restOffer(cfg: DungeonConfig, run: Pick<DungeonRun, 'floor' | 'team'>, stage: number): { healHp: number; revives: number; sacrificeSen: number; sacrificeHp: number } {
  const rc = cfg.rest;
  let healHp = 0, revives = 0, sacrificeHp = 0;
  for (const f of run.team) {
    if (f.hp <= 0) {
      revives++;
      healHp += Math.round(f.maxHp * rc.revive);
    } else {
      healHp += Math.min(f.maxHp - f.hp, Math.round(f.maxHp * rc.heal));
      sacrificeHp += Math.min(f.hp - 1, Math.round(f.maxHp * rc.sacrificeHp));
    }
  }
  return { healHp, revives, sacrificeHp, sacrificeSen: Math.round(floorLoot(cfg, stage, run.floor).sen * rc.sacrificeFloors) };
}

/** Applies a rest-room choice to the team (and loot). */
export function applyRest(cfg: DungeonConfig, run: DungeonRun, choice: RestChoice, stage: number): void {
  const rc = cfg.rest;
  if (choice === 'heal') {
    for (const f of run.team) f.hp = f.hp <= 0 ? Math.max(1, Math.round(f.maxHp * rc.revive)) : Math.min(f.maxHp, f.hp + Math.round(f.maxHp * rc.heal));
  } else if (choice === 'buff') {
    for (const f of run.team) {
      f.atk = Math.round(f.atk * (1 + rc.buffAtk));
      f.def = Math.round(f.def * (1 + rc.buffDef));
    }
    run.buffs++;
  } else if (choice === 'sacrifice') {
    const sen = restOffer(cfg, run, stage).sacrificeSen;
    for (const f of run.team) if (f.hp > 0) f.hp = Math.max(1, f.hp - Math.round(f.maxHp * rc.sacrificeHp));
    run.loot = { ...run.loot, sen: run.loot.sen + sen };
  }
}

/** Is there a rest room after this floor? (`roll` 0..1 decides the random ones.) */
export function restAfter(cfg: DungeonConfig, floor: number, roll: number): boolean {
  return floor % cfg.rest.every === 0 || roll < cfg.rest.chance;
}

export interface DungeonView {
  name: string;
  runsLeft: number;
  runsPerDay: number;
  best: number;
  run: DungeonRun | null;
}

export interface RoundResult {
  events: BattleEvent[];
  /** Loot for this floor (when won). */
  floorLoot: DungeonLoot | null;
}

export function isBossFloor(cfg: DungeonConfig, floor: number): boolean {
  return floor % cfg.bossEvery === 0;
}

/** The enemy on this floor (a boss on boss floors). */
export function enemyFor(cfg: DungeonConfig, floor: number, rand: RandInt): { fighter: Fighter; def: DungeonEnemyDef } {
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
  const g = (k: 'hp' | 'atk' | 'def' | 'spd') => s.growth[k] ** (floor - 1);
  const hp = Math.round(s.hp * def.hp * g('hp') * (boss ? s.bossHp : 1));
  return {
    def,
    fighter: {
      side: 'enemy', id: def.id, name: def.name, boss,
      hp, maxHp: hp,
      atk: Math.round(s.atk * def.atk * g('atk') * (boss ? s.bossAtk : 1)),
      def: Math.round(s.def * def.def * g('def')),
      spd: Math.round(s.spd * def.spd * g('spd')),
      points: 0, move: def.move, ultimate: def.ultimate,
    },
  };
}

/** Money, XP and shards for clearing `floor` at wealth stage `stage` (`petXp` from pets.json). */
export function floorLoot(cfg: DungeonConfig, stage: number, floor: number, petXpPerFloor = 0, petBossMult = 1): DungeonLoot {
  const r = cfg.reward;
  const base = r.floorSen[Math.min(r.floorSen.length - 1, Math.max(0, stage - 1))];
  const boss = isBossFloor(cfg, floor);
  return {
    sen: Math.round(base * (1 + r.perFloor * (floor - 1)) * (boss ? r.bossMult : 1)),
    shards: boss ? Math.round(r.bossShards * (floor / cfg.bossEvery)) : 0,
    xp: Math.round(r.xpBase + r.xpPerFloor * floor),
    petXp: Math.round(petXpPerFloor * (1 + 0.15 * (floor - 1)) * (boss ? petBossMult : 1)),
  };
}

/** Loot you keep when your team falls. */
export function deathLoot(cfg: DungeonConfig, loot: DungeonLoot): DungeonLoot {
  const k = cfg.deathKeep;
  return { sen: Math.floor(loot.sen * k), shards: Math.floor(loot.shards * k), xp: Math.floor(loot.xp * k), petXp: Math.floor(loot.petXp * k) };
}

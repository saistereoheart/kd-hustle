// 🐾 Teman (pets): creatures you collect (buy a starter, or roll a Telur Teman egg), level up
// (battles or paid training), upgrade (HP / ATK / DEF / SPD) and kit out with one piece of pet
// gear. They fight for you in Gua Gelap. A pet is an inventory item (type "pet"), so its tier and
// variant come from the forge like any item; its progress lives on the server per item (iid).
import { z } from 'zod';

export const PET_STATS = ['hp', 'atk', 'def', 'spd'] as const;
export type PetStat = (typeof PET_STATS)[number];

const statBoosts = z.object({ hp: z.number().optional(), atk: z.number().optional(), def: z.number().optional(), spd: z.number().optional() });

export const petsConfigSchema = z.object({
  /** Starters you can buy outright (the rest come from the egg). */
  starters: z.object({ ids: z.array(z.string()).min(1), priceSen: z.number().int().positive() }),
  species: z.record(z.string(), z.object({
    hp: z.number().positive(), atk: z.number().positive(), def: z.number().positive(), spd: z.number().positive(),
    /** Its everyday attack and its ultimate (shown in battle). */
    move: z.string(), ultimate: z.string(),
    /** What it says when it comes out. */
    cry: z.string(),
  })),
  /** Pet gear: stat boosts (share, at common rarity; rarer gear boosts more). */
  gear: z.record(z.string(), statBoosts),
  /** Stats × this per rarity. */
  rarityMult: z.record(z.string(), z.number().positive()),
  /** +this share of base stats per level above 1. */
  levelGrowth: z.number().nonnegative(),
  maxLevel: z.number().int().positive(),
  xp: z.object({ base: z.number().positive(), growth: z.number().min(1), perFloor: z.number().nonnegative(), bossMult: z.number().positive() }),
  /** Training: pay to go up a level now. */
  train: z.object({ baseSen: z.number().int().positive(), growth: z.number().min(1) }),
  /** Stat upgrades: +perLevel of the stat per upgrade level. */
  upgrade: z.object({ perLevel: z.number().positive(), maxLevel: z.number().int().positive(), baseSen: z.number().int().positive(), growth: z.number().min(1) }),
  battle: z.object({
    attackPower: z.number().positive(),
    attackPoints: z.number().int().nonnegative(),
    chargePoints: z.number().int().positive(),
    /** Damage taken while charging (share). */
    chargeGuard: z.number().min(0).max(1),
    ultimateCost: z.number().int().positive(),
    ultimatePower: z.number().positive(),
    critChance: z.number().min(0).max(1),
    critMult: z.number().min(1),
    /** ± random spread on damage. */
    spread: z.number().min(0).max(0.5),
    /** A fight longer than this many rounds ends: the enemy runs off (no loot). */
    maxRounds: z.number().int().positive(),
    teamSize: z.number().int().positive(),
  }),
});
export type PetsConfig = z.infer<typeof petsConfigSchema>;

export interface PetProgress {
  level: number;
  xp: number;
  up: Record<PetStat, number>;
  /** The pet gear it wears (inventory iid), if any. */
  gear: number | null;
}

export interface PetsState {
  /** Battle order (pet iids), up to teamSize. */
  team: number[];
  /** Keyed by the pet's iid. */
  pets: Record<string, PetProgress>;
}

export function emptyPets(): PetsState {
  return { team: [], pets: {} };
}

export function newProgress(): PetProgress {
  return { level: 1, xp: 0, up: { hp: 0, atk: 0, def: 0, spd: 0 }, gear: null };
}

/** XP needed to go from `level` to the next. */
export function petXpToNext(cfg: PetsConfig, level: number): number {
  return Math.round(cfg.xp.base * cfg.xp.growth ** (level - 1));
}

/** Adds XP (mutates); returns how many levels it went up. */
export function addPetXp(cfg: PetsConfig, p: PetProgress, xp: number): number {
  let ups = 0;
  if (p.level >= cfg.maxLevel) return 0;
  p.xp += Math.max(0, Math.round(xp));
  while (p.level < cfg.maxLevel && p.xp >= petXpToNext(cfg, p.level)) {
    p.xp -= petXpToNext(cfg, p.level);
    p.level++;
    ups++;
  }
  if (p.level >= cfg.maxLevel) p.xp = 0;
  return ups;
}

export function trainCostSen(cfg: PetsConfig, level: number): number {
  return Math.round(cfg.train.baseSen * cfg.train.growth ** (level - 1));
}

export function petUpgradeCostSen(cfg: PetsConfig, current: number): number {
  return Math.round(cfg.upgrade.baseSen * cfg.upgrade.growth ** current);
}

/**
 * A pet's battle stats: its species' base × rarity × level × upgrades, then tier and variant
 * (dampened: a Shiny pet is a bit stronger, not twice as strong), then its gear.
 */
export function petStats(
  cfg: PetsConfig,
  pet: { id: string; rarity: string; gradeMult: number; variantMult: number },
  prog: PetProgress,
  gear?: { id: string; rarity: string; gradeMult: number } | null,
): Record<PetStat, number> {
  const sp = cfg.species[pet.id];
  const out = { hp: 1, atk: 1, def: 1, spd: 1 } as Record<PetStat, number>;
  if (!sp) return out;
  const r = cfg.rarityMult[pet.rarity] ?? 1;
  const lvl = 1 + cfg.levelGrowth * (prog.level - 1);
  const look = Math.sqrt(pet.gradeMult) * Math.pow(pet.variantMult, 0.25);
  const g = gear ? cfg.gear[gear.id] : undefined;
  const gearMult = gear ? Math.sqrt(cfg.rarityMult[gear.rarity] ?? 1) * Math.sqrt(gear.gradeMult) : 0;
  for (const s of PET_STATS) {
    const base = sp[s] * r * lvl * (1 + cfg.upgrade.perLevel * (prog.up[s] ?? 0)) * look;
    out[s] = Math.max(1, Math.round(base * (1 + (g?.[s] ?? 0) * gearMult)));
  }
  return out;
}

// ------------------------------------------------------------------ battle
export type BattleAction = 'attack' | 'charge' | 'ultimate';

export interface Fighter {
  side: 'pet' | 'enemy';
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  points: number;
  move: string;
  ultimate: string;
  /** Pets: the item. */
  iid?: number;
  boss?: boolean;
}

export interface BattleEvent {
  kind: 'act' | 'say' | 'faint' | 'switch' | 'win' | 'lose' | 'flee';
  side: 'pet' | 'enemy';
  /** Who (display name). */
  name: string;
  action?: BattleAction;
  /** The move's name (or "Charge"). */
  move?: string;
  dmg?: number;
  crit?: boolean;
  /** Damage softened by a charge. */
  guarded?: boolean;
  /** Points after acting. */
  points?: number;
  /** Target HP after the hit. */
  targetHp?: number;
  /** Dialogue. */
  text?: string;
  /** Switch: the pet that comes in (team index). */
  index?: number;
}

type Rand = (max: number) => number;
const r01 = (rand: Rand) => rand(1_000_000) / 1_000_000;

/** What the enemy does: its ultimate when it can, sometimes a charge, else attack. */
export function enemyChoice(cfg: PetsConfig, f: Fighter, rand: Rand): BattleAction {
  if (f.points >= cfg.battle.ultimateCost) return 'ultimate';
  return r01(rand) < (f.boss ? 0.3 : 0.2) ? 'charge' : 'attack';
}

/** Auto-battle: ultimate when ready, charge when it'd make the ultimate ready next turn and
 *  you're not in danger, else attack. */
export function autoChoice(cfg: PetsConfig, me: Fighter, foe: Fighter): BattleAction {
  const b = cfg.battle;
  if (me.points >= b.ultimateCost) return 'ultimate';
  const lowFoe = foe.hp <= me.atk * b.attackPower;
  if (!lowFoe && me.points + b.chargePoints >= b.ultimateCost && me.hp > me.maxHp * 0.35) return 'charge';
  return 'attack';
}

/** Damage of one hit (before a charge's guard). */
export function hitDamage(cfg: PetsConfig, atk: number, def: number, power: number, rand: Rand): { dmg: number; crit: boolean } {
  const b = cfg.battle;
  const crit = r01(rand) < b.critChance;
  const spread = 1 - b.spread + r01(rand) * b.spread * 2;
  const dmg = Math.max(1, Math.round(atk * power * (50 / (50 + def)) * spread * (crit ? b.critMult : 1)));
  return { dmg, crit };
}

/**
 * One round: both sides pick (the pet's choice is given), the faster acts first; a charge guards
 * for the whole round. Mutates the fighters. If your pet falls, the next one in the team comes
 * out (its turn waits for the next round). Returns what happened, the active pet, and whether the
 * fight is over.
 */
export function resolveRound(
  cfg: PetsConfig,
  team: Fighter[],
  active: number,
  enemy: Fighter,
  petAction: BattleAction,
  rand: Rand,
  taunts: string[] = [],
): { events: BattleEvent[]; active: number; over: 'win' | 'lose' | null } {
  const b = cfg.battle;
  const events: BattleEvent[] = [];
  let pet = team[active];
  if (petAction === 'ultimate' && pet.points < b.ultimateCost) petAction = 'attack';
  const foeAction = enemyChoice(cfg, enemy, rand);
  const guard = { pet: petAction === 'charge', enemy: foeAction === 'charge' };
  const petFirst = pet.spd > enemy.spd || (pet.spd === enemy.spd && rand(2) === 0);
  const order: Array<'pet' | 'enemy'> = petFirst ? ['pet', 'enemy'] : ['enemy', 'pet'];
  if (foeAction === 'ultimate' && taunts.length && rand(2) === 0) events.push({ kind: 'say', side: 'enemy', name: enemy.name, text: taunts[rand(taunts.length)] });
  for (const who of order) {
    const me = who === 'pet' ? pet : enemy;
    const foe = who === 'pet' ? enemy : pet;
    const act = who === 'pet' ? petAction : foeAction;
    if (me.hp <= 0 || foe.hp <= 0) continue;
    if (act === 'charge') {
      me.points += b.chargePoints;
      events.push({ kind: 'act', side: who, name: me.name, action: 'charge', move: 'Charge', points: me.points });
      continue;
    }
    const power = act === 'ultimate' ? b.ultimatePower : b.attackPower;
    if (act === 'ultimate') me.points -= b.ultimateCost;
    else me.points += b.attackPoints;
    const h = hitDamage(cfg, me.atk, foe.def, power, rand);
    const guarded = who === 'pet' ? guard.enemy : guard.pet;
    const dmg = Math.max(1, Math.round(h.dmg * (guarded ? b.chargeGuard : 1)));
    foe.hp = Math.max(0, foe.hp - dmg);
    events.push({ kind: 'act', side: who, name: me.name, action: act, move: act === 'ultimate' ? me.ultimate : me.move, dmg, crit: h.crit, guarded, points: me.points, targetHp: foe.hp });
    if (foe.hp <= 0) events.push({ kind: 'faint', side: foe.side, name: foe.name });
  }
  if (enemy.hp <= 0) {
    events.push({ kind: 'win', side: 'pet', name: pet.name });
    return { events, active, over: 'win' };
  }
  if (pet.hp <= 0) {
    const next = team.findIndex((f, i) => i !== active && f.hp > 0);
    if (next < 0) {
      events.push({ kind: 'lose', side: 'enemy', name: enemy.name });
      return { events, active, over: 'lose' };
    }
    active = next;
    pet = team[active];
    events.push({ kind: 'switch', side: 'pet', name: pet.name, index: active });
  }
  return { events, active, over: null };
}

/** One of your pets, for the 📱 Teman app. */
export interface PetCard {
  iid: number;
  itemId: string;
  level: number;
  xp: number;
  xpNext: number;
  up: Record<PetStat, number>;
  gear: number | null;
  stats: Record<PetStat, number>;
  /** Cost of the next training (null at the max level) and of each stat's next upgrade. */
  trainSen: number | null;
  upgradeSen: Record<PetStat, number | null>;
}

export interface PetsView {
  team: number[];
  teamSize: number;
  starters: { ids: string[]; priceSen: number };
  pets: PetCard[];
}

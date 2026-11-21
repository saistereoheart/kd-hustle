// 🗝️ Labirin Purba battles (docs/LABYRINTH.md §4): your party against a monster group, Pokémon
// style. Each round every player picks ⚔️ Attack / 💥 Skill / 🛡️ Guard / 🏃 Run (🧪 items come with the
// merchant); monsters pick their own. Then everyone acts, fastest first. Pure: the server owns it.
import type { LabConfig } from './config';

export type LabSide = 'party' | 'foe';

export interface LabFighter {
  /** `p<playerId>` or `m<index>`. */
  id: string;
  side: LabSide;
  name: string;
  /** Monsters: their emoji (players are drawn from their character). */
  icon?: string;
  /** Monsters: the config id. */
  kind?: string;
  move: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  focus: number;
  /** Out of the fight (fainted, or ran away). */
  out: boolean;
  /** Ran away (as opposed to fainted). */
  fled?: boolean;
}

export type LabAction =
  | { kind: 'attack'; target?: string }
  | { kind: 'skill'; target?: string }
  | { kind: 'guard' }
  | { kind: 'run' };

export interface LabEvent {
  kind: 'hit' | 'guard' | 'faint' | 'run' | 'runfail' | 'win' | 'wipe';
  actor: string;
  target?: string;
  dmg?: number;
  crit?: boolean;
  skill?: boolean;
  /** The target's HP after the hit. */
  hp?: number;
  text: string;
}

export type LabOutcome = 'win' | 'wipe' | 'fled' | null;

export type Rand01 = () => number;

/** A player's fighting stats: the labyrinth's base × (1 + their lead Teman's tiny boost). */
export function labPlayerStats(cfg: LabConfig, temanBoost: number) {
  const p = cfg.player;
  const k = 1 + Math.max(0, Math.min(cfg.teman.max, temanBoost));
  return { hp: Math.round(p.hp * k), atk: Math.round(p.atk * k * 10) / 10, def: Math.round(p.def * k * 10) / 10, spd: p.spd };
}

/** The lead Teman's boost (0..max): rarity's share × tier and variant multipliers, softened. */
export function temanBoost(cfg: LabConfig, rarity: string, tierMult: number, variantMult: number): number {
  const t = cfg.teman;
  const base = t.rarity[rarity] ?? 0;
  return Math.min(t.max, base * Math.pow(tierMult, t.soften) * Math.pow(variantMult, t.soften));
}

/** A monster group for a room on this floor (bigger groups deeper and with more players). */
export function rollGroup(cfg: LabConfig, floor: number, partySize: number, rand: Rand01): LabFighter[] {
  const pool = cfg.monsters.filter((m) => floor >= m.floors[0] && floor <= m.floors[1]);
  const list = pool.length ? pool : cfg.monsters;
  const extraCap = Math.min(cfg.battle.extraMax, Math.floor(floor / 2) + 1);
  const n = 1 + Math.min(extraCap, Math.floor(rand() * (extraCap + 1)) + Math.max(0, partySize - 1));
  const g = (k: keyof LabConfig['scale']) => Math.pow(cfg.scale[k], floor);
  const out: LabFighter[] = [];
  for (let i = 0; i < Math.min(4, n); i++) {
    const m = list[Math.floor(rand() * list.length)];
    const hp = Math.round(m.hp * g('hp'));
    out.push({ id: `m${i}`, side: 'foe', name: m.name, icon: m.icon, kind: m.id, move: m.move, hp, maxHp: hp, atk: Math.round(m.atk * g('atk') * 10) / 10, def: Math.round(m.def * g('def') * 10) / 10, spd: Math.round(m.spd * g('spd') * 10) / 10, focus: 0, out: false });
  }
  // Same names get a letter (Kelawar Gua A, B).
  const count = new Map<string, number>();
  for (const f of out) count.set(f.name, (count.get(f.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const f of out) {
    if ((count.get(f.name) ?? 0) < 2) continue;
    const k = seen.get(f.name) ?? 0;
    seen.set(f.name, k + 1);
    f.name = `${f.name} ${'ABCD'[k]}`;
  }
  return out;
}

/** Syiling for beating these monsters on this floor. */
export function groupCoins(cfg: LabConfig, floor: number, foes: LabFighter[]): number {
  let sum = 0;
  for (const f of foes) sum += cfg.monsters.find((m) => m.id === f.kind)?.coins ?? 0;
  return Math.round(sum * (1 + cfg.coins.perFloor * floor));
}

function damage(cfg: LabConfig, atk: number, def: number, power: number, rand: Rand01, critChance: number): { dmg: number; crit: boolean } {
  const a = atk * power;
  const base = (a * a) / (a + def); // defence matters more against weak hits
  const v = 1 - cfg.battle.variance + rand() * cfg.battle.variance * 2;
  const crit = rand() < critChance;
  return { dmg: Math.max(1, Math.round(base * v * (crit ? cfg.player.critMult : 1))), crit };
}

const alive = (fs: LabFighter[], side: LabSide) => fs.filter((f) => f.side === side && !f.out);

/** What a monster does: attack someone (the weakest, often), a skill when its focus is full. */
export function foeAction(cfg: LabConfig, me: LabFighter, fighters: LabFighter[], rand: Rand01): LabAction {
  const party = alive(fighters, 'party');
  if (!party.length) return { kind: 'guard' };
  const weakest = [...party].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  const target = rand() < 0.45 ? weakest : party[Math.floor(rand() * party.length)];
  if (me.focus >= cfg.player.skillCost && rand() < 0.6) return { kind: 'skill', target: target.id };
  return { kind: 'attack', target: target.id };
}

/**
 * One round. `actions` = what each party fighter (by id) picked; missing ones ⚔️ Attack. Fighters
 * are changed in place. Returns what happened, in order, and how the battle stands.
 */
export function resolveLabRound(cfg: LabConfig, fighters: LabFighter[], actions: Record<string, LabAction>, rand: Rand01): { events: LabEvent[]; outcome: LabOutcome } {
  const pc = cfg.player;
  const events: LabEvent[] = [];
  const picks = new Map<string, LabAction>();
  for (const f of fighters) {
    if (f.out) continue;
    picks.set(f.id, f.side === 'party' ? (actions[f.id] ?? { kind: 'attack' }) : foeAction(cfg, f, fighters, rand));
  }
  // Guards first (they protect for the whole round), then by speed (a little random on ties).
  const guarding = new Set<string>();
  for (const [id, a] of picks) {
    if (a.kind !== 'guard') continue;
    guarding.add(id);
    const f = fighters.find((x) => x.id === id)!;
    events.push({ kind: 'guard', actor: id, text: `${f.name} braces behind their guard.` });
  }
  const order = fighters.filter((f) => !f.out && picks.get(f.id)?.kind !== 'guard').sort((a, b) => b.spd + rand() - (a.spd + rand()));
  for (const f of order) {
    if (f.out) continue;
    const a = picks.get(f.id)!;
    if (a.kind === 'run') {
      if (rand() < cfg.battle.runChance) {
        f.out = true;
        f.fled = true;
        events.push({ kind: 'run', actor: f.id, text: `${f.name} got away!` });
      } else events.push({ kind: 'runfail', actor: f.id, text: `${f.name} tried to run, but couldn't get away!` });
      continue;
    }
    if (a.kind !== 'attack' && a.kind !== 'skill') continue;
    const foes = alive(fighters, f.side === 'party' ? 'foe' : 'party');
    if (!foes.length) break;
    const target = foes.find((x) => x.id === a.target) ?? foes[0];
    const skill = a.kind === 'skill' && f.focus >= pc.skillCost;
    if (skill) f.focus -= pc.skillCost;
    const r = damage(cfg, f.atk, target.def, skill ? pc.skillPower : 1, rand, f.side === 'party' ? pc.crit : pc.crit / 2);
    const dmg = guarding.has(target.id) ? Math.max(1, Math.round(r.dmg * pc.guardCut)) : r.dmg;
    target.hp = Math.max(0, target.hp - dmg);
    const how = skill ? `uses ${f.move || 'a skill'}` : f.side === 'foe' ? `uses ${f.move}` : 'attacks';
    events.push({ kind: 'hit', actor: f.id, target: target.id, dmg, crit: r.crit, skill, hp: target.hp, text: `${f.name} ${how}! ${target.name} −${dmg}${r.crit ? ' (critical!)' : ''}` });
    if (target.hp <= 0) {
      target.out = true;
      events.push({ kind: 'faint', actor: target.id, text: target.side === 'foe' ? `${target.name} is defeated!` : `${target.name} fainted!` });
    }
  }
  // Focus builds up each round.
  for (const f of fighters) if (!f.out) f.focus = Math.min(pc.focusMax, f.focus + 1);
  const foesLeft = alive(fighters, 'foe').length;
  const partyLeft = alive(fighters, 'party').length;
  let outcome: LabOutcome = null;
  if (!foesLeft) {
    outcome = 'win';
    events.push({ kind: 'win', actor: '', text: 'Victory!' });
  } else if (!partyLeft) {
    // Nobody standing: if anyone got away it's a getaway, otherwise a wipe.
    const anyFainted = fighters.some((f) => f.side === 'party' && f.out && !f.fled);
    outcome = anyFainted ? 'wipe' : 'fled';
    if (anyFainted) events.push({ kind: 'wipe', actor: '', text: 'Your party has fallen…' });
  }
  return { events, outcome };
}

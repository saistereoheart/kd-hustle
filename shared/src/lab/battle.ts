// 🗝️ Labirin Purba battles (docs/LABYRINTH.md §4): your party against a monster group, Pokémon
// style. Each round every player picks ⚔️ Attack / 💥 Skill / 🛡️ Guard / 🧪 Item / 🏃 Run; monsters
// pick their own. Guards and items first, then everyone acts, fastest first. Pure: the server owns it.
import type { LabConfig } from './config';
import { labPotion, type LabGearBonus } from './gear';
import { labElement, labSpell } from './progress';

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
  /** Players: crit chance (base + gear) and the chance to block a hit (shield). */
  crit?: number;
  block?: number;
  /** 🌶️ ATK multiplier for the rest of the fight (Sambal Semangat). */
  buff?: number;
  /** 👹 A floor boss. */
  boss?: boolean;
  /** Players: 📜 the spell book worn (its ultimate), and skill bonuses to 💥 Skill / 📜 spell power. */
  spell?: string;
  skillUp?: number;
  spellUp?: number;
  /** Players: 🔷 mana (💥 skills cost it) and the element whose skill is equipped. */
  mana?: number;
  maxMana?: number;
  element?: string;
  /** 🔥 Burning: `dmg` at the end of each of the next `left` rounds. */
  burn?: { dmg: number; left: number };
}

export type LabAction =
  | { kind: 'attack'; target?: string }
  | { kind: 'skill'; target?: string }
  /** 📜 The worn spell book's ultimate: every monster (or every friend, for a heal). */
  | { kind: 'ultimate' }
  | { kind: 'guard' }
  | { kind: 'run' }
  /** A potion (`target`: who it's for; yourself if left out). */
  | { kind: 'item'; item: string; target?: string };

export interface LabEvent {
  /** 'cast': a 💥 skill that hits every monster is let loose (its 'hit's follow, aoe). */
  kind: 'hit' | 'guard' | 'faint' | 'run' | 'runfail' | 'win' | 'wipe' | 'item' | 'spell' | 'cast';
  actor: string;
  target?: string;
  dmg?: number;
  crit?: boolean;
  skill?: boolean;
  /** The target's HP after the hit (or the heal). */
  hp?: number;
  /** A shield blocked half of it. */
  blocked?: boolean;
  /** 🧪 The potion used. */
  item?: string;
  /** A fallen fighter got back up (Air Penawar). */
  revived?: boolean;
  /** 📜 The spell cast ('spell': the cast; 'hit' / 'item' that follow: its effect on each one). */
  spell?: string;
  /** One of several hits from one ultimate (no lunge: they all land together). */
  aoe?: boolean;
  /** The spell's colour (for the effects). */
  color?: string;
  /** 🔥 The element behind a skill / ultimate (each has its own effects on screen). */
  element?: string;
  /** 🔥 A burn ticking (not a new hit). */
  burn?: boolean;
  /** 🔷 Someone's mana after this (a skill spent it, a potion gave it back): `actor`'s, or `target`'s for a potion. */
  mana?: number;
  text: string;
}

export type LabOutcome = 'win' | 'wipe' | 'fled' | null;

export type Rand01 = () => number;

/** A player's fighting stats: (the labyrinth's base + their gear) × (1 + their lead Teman's tiny boost). */
export function labPlayerStats(cfg: LabConfig, temanBoost: number, gear?: LabGearBonus) {
  const p = cfg.player;
  const k = 1 + Math.max(0, Math.min(cfg.teman.max, temanBoost));
  const g = gear ?? { atk: 0, def: 0, hp: 0, spd: 0, crit: 0, block: 0 };
  return {
    hp: Math.round((p.hp + g.hp) * k),
    atk: Math.round((p.atk + g.atk) * k * 10) / 10,
    def: Math.round((p.def + g.def) * k * 10) / 10,
    spd: p.spd + g.spd,
    crit: Math.min(0.5, p.crit + g.crit),
    block: Math.min(0.5, g.block),
  };
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

/** 👹 A floor's boss (and, deeper down, its minions): more HP with more players. */
export function rollBoss(cfg: LabConfig, floor: number, partySize: number, rand: Rand01): LabFighter[] {
  // Each boss has its own stats (tuned per floor: see labyrinth.json); only HP grows with the party.
  const b = cfg.bosses[Math.min(floor, cfg.bosses.length - 1)];
  const hp = Math.round(b.hp * (1 + cfg.boss.partyHp * Math.max(0, partySize - 1)));
  const boss: LabFighter = {
    id: 'b0', side: 'foe', name: b.name, icon: b.icon, kind: `boss:${floor}`, move: b.move, boss: true,
    hp, maxHp: hp, atk: b.atk, def: b.def, spd: b.spd, focus: 0, out: false,
  };
  const out = [boss];
  if (floor >= cfg.boss.minionsFrom) {
    const minions = rollGroup(cfg, floor, 1, rand).slice(0, Math.min(3, partySize));
    minions.forEach((m, i) => (m.id = `m${i}`));
    out.push(...minions);
  }
  return out;
}

/** Syiling for beating these monsters on this floor (a boss pays its own, once). */
export function groupCoins(cfg: LabConfig, floor: number, foes: LabFighter[]): number {
  let sum = 0;
  let boss = 0;
  for (const f of foes) {
    if (f.boss) boss += cfg.bosses[Math.min(floor, cfg.bosses.length - 1)].coins;
    else sum += cfg.monsters.find((m) => m.id === f.kind)?.coins ?? 0;
  }
  return Math.round(sum * (1 + cfg.coins.perFloor * floor)) + boss;
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

/** 💥 Can this party fighter pay for their equipped element's skill? (No mana kept: the old focus rule.) */
export function canSkill(cfg: LabConfig, f: LabFighter): boolean {
  if (f.side !== 'party' || f.mana === undefined) return f.focus >= cfg.player.skillCost;
  return f.mana >= labElement(cfg, f.element).skill.mana;
}

/**
 * One round. `actions` = what each party fighter (by id) picked; missing ones ⚔️ Attack. Fighters
 * are changed in place. Returns what happened, in order, and how the battle stands.
 */
export function resolveLabRound(
  cfg: LabConfig,
  fighters: LabFighter[],
  actions: Record<string, LabAction>,
  rand: Rand01,
  opts: { noEscape?: boolean } = {},
): { events: LabEvent[]; outcome: LabOutcome; used: Array<{ actor: string; item: string }> } {
  /** Potions actually drunk / thrown this round (the server takes them out of the bags). */
  const used: Array<{ actor: string; item: string }> = [];
  const pc = cfg.player;
  const events: LabEvent[] = [];
  const picks = new Map<string, LabAction>();
  for (const f of fighters) {
    if (f.out) continue;
    picks.set(f.id, f.side === 'party' ? (actions[f.id] ?? { kind: 'attack' }) : foeAction(cfg, f, fighters, rand));
  }
  /** A player's element skill this round (if they picked 💥 and use mana). */
  const skillOf = (f: LabFighter) => (f.side === 'party' && f.mana !== undefined && picks.get(f.id)?.kind === 'skill' ? labElement(cfg, f.element) : undefined);
  // Guards first (they protect for the whole round), then by speed (a little random on ties).
  const guarding = new Set<string>();
  /** 🪨 Turned to stone this round: id → share of damage taken off. */
  const stone = new Map<string, number>();
  /** Skills already paid for (🪨 pays as it hardens, at the start). */
  const paid = new Set<string>();
  for (const [id, a] of picks) {
    const f = fighters.find((x) => x.id === id)!;
    if (a.kind === 'guard') {
      guarding.add(id);
      events.push({ kind: 'guard', actor: id, text: `${f.name} braces behind their guard.` });
      continue;
    }
    const el = skillOf(f);
    if (el?.skill.shield && f.mana! >= el.skill.mana) {
      f.mana! -= el.skill.mana;
      paid.add(id);
      stone.set(id, el.skill.shield);
      events.push({ kind: 'guard', actor: id, element: el.id, color: el.color, mana: f.mana, text: `${f.name} turns to stone! ${el.icon}` });
    }
  }
  /** Damage after 🛡️ guard and 🪨 stone. */
  const cut = (t: LabFighter, dmg: number) => {
    let d = guarding.has(t.id) ? dmg * pc.guardCut : dmg;
    const st = stone.get(t.id);
    if (st) d *= 1 - st;
    return Math.max(1, Math.round(d));
  };
  const faint = (t: LabFighter) => {
    if (t.hp > 0 || t.out) return;
    t.out = true;
    t.burn = undefined;
    events.push({ kind: 'faint', actor: t.id, text: t.side === 'foe' ? `${t.name} is defeated!` : `${t.name} fainted!` });
  };
  /** 🔥 Set it burning (a stronger burn replaces a weaker one). */
  const ignite = (t: LabFighter, hit: number, share: number | undefined, rounds: number | undefined) => {
    if (!share || t.out) return;
    const dmg = Math.max(1, Math.round(hit * share));
    const n = rounds ?? 2;
    if (!t.burn || t.burn.dmg * t.burn.left < dmg * n) t.burn = { dmg, left: n };
  };
  /** 💧 Heal the attacker a share of what they dealt. */
  const drink = (f: LabFighter, dealt: number, share: number | undefined, el?: { id: string; color: string; icon: string }) => {
    if (!share || f.out || dealt <= 0) return;
    const before = f.hp;
    f.hp = Math.min(f.maxHp, Math.round(f.hp + dealt * share));
    if (f.hp > before) events.push({ kind: 'item', actor: f.id, target: f.id, hp: f.hp, element: el?.id, color: el?.color, text: `${el?.icon ?? '💧'} ${f.name} +${f.hp - before} HP` });
  };
  // 🧪 Potions next (before anyone swings), fastest first.
  const drinkers = fighters.filter((f) => !f.out && picks.get(f.id)?.kind === 'item').sort((a, b) => b.spd - a.spd);
  for (const f of drinkers) {
    const a = picks.get(f.id) as Extract<LabAction, { kind: 'item' }>;
    const pot = labPotion(cfg, a.item);
    if (!pot) continue;
    const party = fighters.filter((x) => x.side === f.side);
    const target = party.find((x) => x.id === a.target) ?? f;
    if (pot.revive) {
      const down = target.out && !target.fled ? target : party.find((x) => x.out && !x.fled);
      if (!down) {
        events.push({ kind: 'item', actor: f.id, item: pot.id, text: `${f.name} holds up the ${pot.name}, but nobody needs it.` });
        continue;
      }
      down.out = false;
      down.hp = Math.max(1, Math.round(down.maxHp * pot.revive));
      used.push({ actor: f.id, item: pot.id });
      events.push({ kind: 'item', actor: f.id, target: down.id, item: pot.id, hp: down.hp, revived: true, text: `${f.name} uses ${pot.name}! ${down.name} gets back up.` });
    } else if (pot.heal) {
      const t = target.out ? f : target;
      const before = t.hp;
      t.hp = Math.min(t.maxHp, Math.round(t.hp + t.maxHp * pot.heal));
      used.push({ actor: f.id, item: pot.id });
      events.push({ kind: 'item', actor: f.id, target: t.id, item: pot.id, hp: t.hp, text: `${f.name} drinks ${pot.name}. ${t.name} +${t.hp - before} HP` });
    } else if (pot.mana) {
      const t = target.out || target.maxMana === undefined ? f : target;
      const max = t.maxMana ?? 0;
      const before = t.mana ?? 0;
      t.mana = Math.min(max, Math.round(before + max * pot.mana));
      used.push({ actor: f.id, item: pot.id });
      events.push({ kind: 'item', actor: f.id, target: t.id, item: pot.id, mana: t.mana, text: `${f.name} drinks ${pot.name}. ${t.name} +${t.mana - before} 🔷 mana` });
    } else if (pot.escape) {
      used.push({ actor: f.id, item: pot.id });
      if (opts.noEscape) {
        events.push({ kind: 'runfail', actor: f.id, item: pot.id, text: `${f.name} throws ${pot.name}, but there's no escaping this one!` });
        continue;
      }
      f.out = true;
      f.fled = true;
      events.push({ kind: 'run', actor: f.id, item: pot.id, text: `${f.name} vanishes in a puff of ${pot.name}!` });
    } else if (pot.atkBuff) {
      f.buff = Math.max(f.buff ?? 1, 1 + pot.atkBuff);
      used.push({ actor: f.id, item: pot.id });
      events.push({ kind: 'item', actor: f.id, target: f.id, item: pot.id, text: `${f.name} eats ${pot.name}. 🔥 ATK up!` });
    }
  }
  // Everyone else, fastest first (someone just revived has no pick yet: they act from the next round).
  // ⚡ Some skills go before everyone, 🪨 some after.
  const speed = (f: LabFighter) => {
    const sk = skillOf(f)?.skill;
    return f.spd + rand() + (sk?.first ? 1e4 : sk?.last ? -1e4 : 0);
  };
  const order = fighters
    .filter((f) => !f.out && picks.has(f.id) && picks.get(f.id)!.kind !== 'guard' && picks.get(f.id)!.kind !== 'item')
    .map((f) => ({ f, s: speed(f) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.f);
  for (const f of order) {
    if (f.out) continue;
    const a = picks.get(f.id)!;
    if (a.kind === 'run') {
      if (opts.noEscape) {
        events.push({ kind: 'runfail', actor: f.id, text: `${f.name} tries to run, but there's no running from this one!` });
        continue;
      }
      if (rand() < cfg.battle.runChance) {
        f.out = true;
        f.fled = true;
        events.push({ kind: 'run', actor: f.id, text: `${f.name} got away!` });
      } else events.push({ kind: 'runfail', actor: f.id, text: `${f.name} tried to run, but couldn't get away!` });
      continue;
    }
    if (a.kind === 'ultimate') {
      const sp = labSpell(cfg, f.spell);
      if (!sp || f.focus < cfg.spells.focus) continue;
      f.focus -= cfg.spells.focus;
      const mult = 1 + (f.spellUp ?? 0);
      const el = sp.element ? labElement(cfg, sp.element) : undefined;
      events.push({ kind: 'spell', actor: f.id, spell: sp.id, color: sp.color, element: el?.id, text: `${f.name} casts ${sp.icon} ${sp.move}!` });
      if (sp.heal) {
        for (const t of alive(fighters, f.side)) {
          const before = t.hp;
          t.hp = Math.min(t.maxHp, Math.round(t.hp + t.maxHp * sp.heal * mult));
          events.push({ kind: 'item', actor: f.id, target: t.id, spell: sp.id, color: sp.color, element: el?.id, aoe: true, hp: t.hp, text: `${t.name} +${t.hp - before} HP` });
        }
      }
      if (sp.power) {
        let dealt = 0;
        for (const t of alive(fighters, f.side === 'party' ? 'foe' : 'party')) {
          const r = damage(cfg, f.atk * (f.buff ?? 1), t.def * (1 - (sp.pierce ?? 0)), sp.power * mult, rand, Math.min(0.9, (f.crit ?? pc.crit) + (sp.crit ?? 0)));
          const dmg = cut(t, r.dmg);
          t.hp = Math.max(0, t.hp - dmg);
          dealt += dmg;
          events.push({ kind: 'hit', actor: f.id, target: t.id, dmg, crit: r.crit, spell: sp.id, color: sp.color, element: el?.id, aoe: true, hp: t.hp, text: `${sp.icon} ${t.name} −${dmg}${r.crit ? ' (critical!)' : ''}` });
          ignite(t, dmg, sp.burn, sp.burnRounds);
          faint(t);
        }
        drink(f, dealt, sp.drain, el);
      }
      continue;
    }
    if (a.kind !== 'attack' && a.kind !== 'skill') continue;
    const foes = alive(fighters, f.side === 'party' ? 'foe' : 'party');
    if (!foes.length) break;
    // 💥 A player's element skill (mana). Short of mana (the server checks first): a plain attack.
    const el = a.kind === 'skill' ? skillOf(f) : undefined;
    if (el && !paid.has(f.id) && f.mana! >= el.skill.mana) {
      f.mana! -= el.skill.mana;
      paid.add(f.id);
    }
    if (el && paid.has(f.id)) {
      const sk = el.skill;
      const power = (sk.power ?? 1) * (1 + (f.skillUp ?? 0));
      const crit = Math.min(0.9, (f.crit ?? pc.crit) + (sk.crit ?? 0));
      const targets = sk.all ? foes : [sk.random ? foes[Math.floor(rand() * foes.length)] : (foes.find((x) => x.id === a.target) ?? foes[0])];
      if (sk.all) events.push({ kind: 'cast', actor: f.id, element: el.id, color: el.color, mana: f.mana, text: `${f.name} uses ${el.icon} ${sk.name}!` });
      let dealt = 0;
      for (const t of targets) {
        const r = damage(cfg, f.atk * (f.buff ?? 1), t.def * (1 - (sk.pierce ?? 0)), power, rand, crit);
        let dmg = cut(t, r.dmg);
        const blocked = !!t.block && rand() < t.block;
        if (blocked) dmg = Math.max(1, Math.round(dmg / 2));
        t.hp = Math.max(0, t.hp - dmg);
        dealt += dmg;
        const tail = `${r.crit ? ' (critical!)' : ''}${blocked ? ' (blocked!)' : ''}`;
        events.push({
          kind: 'hit', actor: f.id, target: t.id, dmg, crit: r.crit, skill: true, blocked, hp: t.hp, element: el.id, color: el.color, aoe: sk.all || undefined, mana: f.mana,
          text: sk.all ? `${el.icon} ${t.name} −${dmg}${tail}` : `${f.name} uses ${el.icon} ${sk.name}! ${t.name} −${dmg}${tail}`,
        });
        ignite(t, dmg, sk.burn, sk.burnRounds);
        faint(t);
      }
      drink(f, dealt, sk.drain, el);
      continue;
    }
    const target = foes.find((x) => x.id === a.target) ?? foes[0];
    // Monsters (and fighters who keep no mana) use focus for their skill.
    const skill = f.mana === undefined && a.kind === 'skill' && f.focus >= pc.skillCost;
    if (skill) f.focus -= pc.skillCost;
    const r = damage(cfg, f.atk * (f.buff ?? 1), target.def, skill ? pc.skillPower * (1 + (f.skillUp ?? 0)) : 1, rand, f.side === 'party' ? (f.crit ?? pc.crit) : pc.crit / 2);
    let dmg = cut(target, r.dmg);
    // 🛡️ A shield sometimes takes half of it.
    const blocked = !!target.block && rand() < target.block;
    if (blocked) dmg = Math.max(1, Math.round(dmg / 2));
    target.hp = Math.max(0, target.hp - dmg);
    const how = skill ? `uses ${f.move || 'a skill'}` : f.side === 'foe' ? `uses ${f.move}` : 'attacks';
    events.push({ kind: 'hit', actor: f.id, target: target.id, dmg, crit: r.crit, skill, blocked, hp: target.hp, text: `${f.name} ${how}! ${target.name} −${dmg}${r.crit ? ' (critical!)' : ''}${blocked ? ' (blocked!)' : ''}` });
    faint(target);
  }
  // 🔥 Burns tick.
  const fire = labElement(cfg, 'api');
  for (const t of fighters) {
    if (t.out || !t.burn) continue;
    t.hp = Math.max(0, t.hp - t.burn.dmg);
    events.push({ kind: 'hit', actor: t.id, target: t.id, dmg: t.burn.dmg, burn: true, aoe: true, hp: t.hp, element: fire.id, color: fire.color, text: `🔥 ${t.name} burns! −${t.burn.dmg}` });
    t.burn.left--;
    if (t.burn.left <= 0) t.burn = undefined;
    faint(t);
  }
  // Focus builds up each round, and a little 🔷 mana comes back.
  for (const f of fighters) {
    if (f.out) continue;
    f.focus = Math.min(pc.focusMax, f.focus + 1);
    if (f.mana !== undefined && f.maxMana !== undefined) f.mana = Math.min(f.maxMana, f.mana + pc.mana.perRound);
  }
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
  return { events, outcome, used };
}

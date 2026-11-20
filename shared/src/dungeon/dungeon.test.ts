import { describe, expect, it } from 'vitest';
import dungeonJson from '../../config/dungeon.json';
import petsJson from '../../config/pets.json';
import { petsConfigSchema, petGearBoosts, petStats, addPetXp, newProgress, resolveRound, autoChoice, petXpToNext, type Fighter, type PetProgress } from '../pets/pets';
import { applyRest, deathLoot, dungeonConfigSchema, enemyFor, floorLoot, isBossFloor, restAfter, restOffer, type DungeonRun } from './dungeon';

const cfg = dungeonConfigSchema.parse(dungeonJson);
const pets = petsConfigSchema.parse(petsJson);

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

const RARITY: Record<string, string> = { pet_kucing: 'common', pet_ayam: 'common', pet_kancil: 'common', pet_penyu: 'uncommon', pet_harimau: 'legendary', pet_naga: 'mythic', pet_enggang: 'rare', pet_kerbau: 'rare' };

function fighter(id: string, level: number, upgrades = 0, iid = 1): Fighter {
  const prog: PetProgress = { ...newProgress(), level, up: { hp: upgrades, atk: upgrades, def: upgrades, spd: upgrades } };
  const s = petStats(pets, { id, rarity: RARITY[id] ?? 'common', gradeMult: 1, variantMult: 1 }, prog);
  const sp = pets.species[id];
  return { side: 'pet', id, name: id, hp: s.hp, maxHp: s.hp, atk: s.atk, def: s.def, spd: s.spd, points: 0, move: sp.move, ultimate: sp.ultimate, iid };
}

describe('pets', () => {
  it('stats grow with level, upgrades, rarity and gear', () => {
    const base = petStats(pets, { id: 'pet_kucing', rarity: 'common', gradeMult: 1, variantMult: 1 }, newProgress());
    const l10 = petStats(pets, { id: 'pet_kucing', rarity: 'common', gradeMult: 1, variantMult: 1 }, { ...newProgress(), level: 10 });
    const up = petStats(pets, { id: 'pet_kucing', rarity: 'common', gradeMult: 1, variantMult: 1 }, { ...newProgress(), up: { hp: 0, atk: 5, def: 0, spd: 0 } });
    const rare = petStats(pets, { id: 'pet_kucing', rarity: 'rare', gradeMult: 1, variantMult: 1 }, newProgress());
    const geared = petStats(pets, { id: 'pet_kucing', rarity: 'common', gradeMult: 1, variantMult: 1 }, newProgress(), { id: 'pg_taring', rarity: 'rare', gradeMult: 1 });
    expect(l10.atk).toBeGreaterThan(base.atk);
    expect(up.atk).toBeGreaterThan(base.atk);
    expect(up.hp).toBe(base.hp);
    expect(rare.hp).toBeGreaterThan(base.hp);
    expect(geared.atk).toBeGreaterThan(base.atk);
  });

  it('rarity, tier and variant multiply (gear: +10% × tier 2 × variant 2 = +40%)', () => {
    const kolar = petGearBoosts(pets, { id: 'pg_kolar', rarity: 'common', gradeMult: 2, variantMult: 2 });
    expect(kolar.def).toBeCloseTo(pets.gear.pg_kolar.def! * 4, 10);
    const rare = petGearBoosts(pets, { id: 'pg_kolar', rarity: 'rare', gradeMult: 1, variantMult: 1 });
    expect(rare.def).toBeCloseTo(pets.gear.pg_kolar.def! * pets.rarityMult.rare, 10);
    // The pet itself: tier × variant multiply its stats in full.
    const prog = { ...newProgress(), level: 20 };
    const plain = petStats(pets, { id: 'pet_kucing', rarity: 'common', gradeMult: 1, variantMult: 1 }, prog);
    const fancy = petStats(pets, { id: 'pet_kucing', rarity: 'common', gradeMult: 2, variantMult: 2 }, prog);
    expect(fancy.hp / plain.hp).toBeCloseTo(4, 1);
  });

  it('XP levels a pet up (carrying the rest over), capped at the max level', () => {
    const p = newProgress();
    expect(addPetXp(pets, p, petXpToNext(pets, 1) + 5)).toBe(1);
    expect(p.level).toBe(2);
    expect(p.xp).toBe(5);
    const top = { ...newProgress(), level: pets.maxLevel };
    expect(addPetXp(pets, top, 99999)).toBe(0);
    expect(top.level).toBe(pets.maxLevel);
  });
});

describe('battle rounds', () => {
  it('attack builds points; charge builds more; ultimate needs points', () => {
    const r = seeded(3);
    const me = fighter('pet_kerbau', 10);
    const foe = enemyFor(cfg, 1, r).fighter;
    foe.hp = foe.maxHp = 9999;
    foe.atk = 1;
    const a = resolveRound(pets, [me], 0, foe, 'attack', r);
    expect(a.events.find((e) => e.side === 'pet' && e.kind === 'act')?.action).toBe('attack');
    expect(me.points).toBe(pets.battle.attackPoints);
    resolveRound(pets, [me], 0, foe, 'charge', r);
    expect(me.points).toBe(pets.battle.attackPoints + pets.battle.chargePoints);
    // Not enough points yet: an ultimate becomes a plain attack.
    me.points = 1;
    const u = resolveRound(pets, [me], 0, foe, 'ultimate', r);
    expect(u.events.find((e) => e.side === 'pet' && e.kind === 'act')?.action).toBe('attack');
    me.points = pets.battle.ultimateCost;
    const u2 = resolveRound(pets, [me], 0, foe, 'ultimate', r);
    const ev = u2.events.find((e) => e.side === 'pet' && e.kind === 'act')!;
    expect(ev.action).toBe('ultimate');
    expect(ev.move).toBe(pets.species.pet_kerbau.ultimate);
  });

  it('when a pet falls the next comes out; win and lose end the fight', () => {
    const r = seeded(5);
    const a = fighter('pet_kancil', 1, 0, 1), b = fighter('pet_ayam', 1, 0, 2);
    const foe = enemyFor(cfg, 1, r).fighter;
    a.hp = 1;
    foe.atk = 999;
    foe.spd = 999;
    const res = resolveRound(pets, [a, b], 0, foe, 'attack', r);
    expect(res.active).toBe(1);
    expect(res.events.some((e) => e.kind === 'switch')).toBe(true);
    b.hp = 1;
    let over: string | null = null;
    for (let i = 0; i < 10 && !over; i++) over = resolveRound(pets, [a, b], 1, foe, 'attack', r).over; // (it may charge first)
    expect(over).toBe('lose');
    const strong = fighter('pet_naga', 30);
    const weak = enemyFor(cfg, 1, r).fighter;
    weak.hp = 1;
    expect(resolveRound(pets, [strong], 0, weak, 'attack', r).over).toBe('win');
  });
});

describe('floors and loot', () => {
  it('bosses, scaling and loot', () => {
    const r = seeded(1);
    expect(enemyFor(cfg, cfg.bossEvery, r).fighter.boss).toBe(true);
    expect(enemyFor(cfg, 9, r).fighter.maxHp).toBeGreaterThan(enemyFor(cfg, 1, r).fighter.maxHp);
    expect(enemyFor(cfg, 60, r).fighter.hp).toBeGreaterThan(0);
    expect(isBossFloor(cfg, 10)).toBe(true);
    const boss = floorLoot(cfg, 1, cfg.bossEvery, 10, 3);
    expect(boss.shards).toBeGreaterThan(0);
    expect(boss.petXp).toBeGreaterThan(floorLoot(cfg, 1, 1, 10, 3).petXp);
    expect(deathLoot(cfg, { sen: 1001, shards: 9, xp: 7, petXp: 5 })).toEqual({ sen: 500, shards: 4, xp: 3, petXp: 2 });
  });
});

describe('balance (auto battles)', () => {
  /** How deep a team gets on auto, healing between floors like a run does. */
  function depth(team: Fighter[], seed: number): number {
    const r = seeded(seed);
    let floor = 1;
    let enemy = enemyFor(cfg, floor, r).fighter;
    let active = 0;
    for (let rounds = 0; rounds < 5000; rounds++) {
      const res = resolveRound(pets, team, active, enemy, autoChoice(pets, team[active], enemy), r);
      active = res.active;
      if (res.over === 'lose') return floor;
      if (res.over === 'win') {
        floor++;
        for (const f of team) if (f.hp > 0) f.hp = Math.min(f.maxHp, f.hp + Math.round(f.maxHp * cfg.healPerFloor));
        enemy = enemyFor(cfg, floor, r).fighter;
      }
    }
    return floor;
  }
  const avg = (make: () => Fighter[]) => [1, 2, 3, 4, 5, 6].reduce((a, s) => a + depth(make(), s), 0) / 6;

  it('one new starter clears a floor or two; a levelled team reaches the bosses; a strong team goes deep', () => {
    const one = avg(() => [fighter('pet_kucing', 1)]);
    const three10 = avg(() => [fighter('pet_kucing', 10, 0, 1), fighter('pet_ayam', 10, 0, 2), fighter('pet_kancil', 10, 0, 3)]);
    const strong = avg(() => [fighter('pet_harimau', 30, 6, 1), fighter('pet_naga', 30, 6, 2), fighter('pet_kerbau', 30, 6, 3)]);
    expect(one).toBeGreaterThanOrEqual(2);
    expect(one).toBeLessThan(6);
    expect(three10).toBeGreaterThan(one);
    expect(strong).toBeGreaterThan(three10);
    expect(strong).toBeLessThan(80);
  });
});

describe('rest rooms', () => {
  const runWith = (team: Fighter[]): DungeonRun => ({ floor: 4, team, active: 0, enemy: team[0], enemyLine: '', phase: 'rest', loot: { sen: 1000, shards: 0, xp: 0, petXp: 0 }, round: 0, restNext: false, buffs: 0 });

  it('come every few floors, plus sometimes at random; HP carries over between floors', () => {
    expect(cfg.healPerFloor).toBe(0);
    expect(restAfter(cfg, cfg.rest.every, 0.99)).toBe(true);
    expect(restAfter(cfg, cfg.rest.every + 1, 0.99)).toBe(false);
    expect(restAfter(cfg, cfg.rest.every + 1, 0)).toBe(true);
  });

  it('heal patches up and revives; buff stacks on attack and defence', () => {
    const a = fighter('pet_kucing', 5, 0, 1);
    const b = fighter('pet_ayam', 5, 0, 2);
    a.hp = 1;
    b.hp = 0;
    const r = runWith([a, b]);
    const offer = restOffer(cfg, r, 1);
    expect(offer.revives).toBe(1);
    applyRest(cfg, r, 'heal', 1);
    expect(r.team[0].hp).toBe(Math.min(a.maxHp, 1 + Math.round(a.maxHp * cfg.rest.heal)));
    expect(r.team[1].hp).toBe(Math.max(1, Math.round(b.maxHp * cfg.rest.revive)));
    const atk = r.team[0].atk;
    applyRest(cfg, r, 'buff', 1);
    expect(r.team[0].atk).toBe(Math.round(atk * (1 + cfg.rest.buffAtk)));
    expect(r.buffs).toBe(1);
  });

  it('a sacrifice costs HP (never below 1, fainted ones untouched) and pays money into the loot', () => {
    const a = fighter('pet_kucing', 5, 0, 1);
    const b = fighter('pet_ayam', 5, 0, 2);
    b.hp = 0;
    const r = runWith([a, b]);
    const sen = restOffer(cfg, r, 2).sacrificeSen;
    expect(sen).toBe(Math.round(floorLoot(cfg, 2, 4).sen * cfg.rest.sacrificeFloors));
    applyRest(cfg, r, 'sacrifice', 2);
    expect(r.team[0].hp).toBe(Math.max(1, a.maxHp - Math.round(a.maxHp * cfg.rest.sacrificeHp)));
    expect(r.team[1].hp).toBe(0);
    expect(r.loot.sen).toBe(1000 + sen);
  });
});


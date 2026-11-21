import { describe, expect, it } from 'vitest';
import labJson from '../../config/labyrinth.json';
import { labConfigSchema } from './config';
import { groupCoins, labPlayerStats, resolveLabRound, rollGroup, temanBoost, type LabFighter } from './battle';
import { labRng } from './generate';

const cfg = labConfigSchema.parse(labJson);

function hero(id = 'p1', mult = 1): LabFighter {
  const s = labPlayerStats(cfg, 0);
  return { id, side: 'party', name: id, move: '', hp: s.hp * mult, maxHp: s.hp * mult, atk: s.atk * mult, def: s.def * mult, spd: s.spd, focus: 0, out: false };
}

/** Fights to the end with ⚔️ / 💥 when focus allows. */
function fight(fs: LabFighter[], rand: () => number) {
  for (let r = 0; r < 80; r++) {
    const acts: Record<string, { kind: 'attack' | 'skill' }> = {};
    for (const f of fs) if (f.side === 'party' && !f.out) acts[f.id] = { kind: f.focus >= cfg.player.skillCost ? 'skill' : 'attack' };
    const res = resolveLabRound(cfg, fs, acts, rand);
    if (res.outcome) return res.outcome;
  }
  return null;
}

function winRate(floor: number, mult: number, party = 1, n = 600) {
  const rand = labRng(7 + floor * 31 + party);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const fs = [...Array.from({ length: party }, (_, k) => hero(`p${k}`, mult)), ...rollGroup(cfg, floor, party, rand)];
    if (fight(fs, rand) === 'win') w++;
  }
  return w / n;
}

describe('Labirin battles', () => {
  it('a gearless player clears floor 1 almost always, but not floor 4', () => {
    expect(winRate(0, 1)).toBeGreaterThan(0.95);
    expect(winRate(3, 1)).toBeLessThan(0.15);
  });

  it('gear and friends make the deep floors winnable (the grind pays off)', () => {
    expect(winRate(5, 4.7)).toBeGreaterThan(0.6);
    // Two players with good gear do better than one on floor 7.
    expect(winRate(6, 3.4, 2)).toBeGreaterThan(winRate(6, 3.4, 1));
  });

  it('guarding takes less damage', () => {
    const rand = () => 0.5;
    const hit = (guard: boolean) => {
      const me = hero();
      const foe = rollGroup(cfg, 2, 1, () => 0)[0];
      foe.spd = 99;
      const fs = [me, foe];
      resolveLabRound(cfg, fs, { p1: guard ? { kind: 'guard' } : { kind: 'attack' } }, rand);
      return me.maxHp - me.hp;
    };
    expect(hit(true)).toBeLessThan(hit(false));
  });

  it('running away leaves the fight (fled, not a wipe)', () => {
    const fs = [hero(), ...rollGroup(cfg, 0, 1, () => 0.1)];
    const res = resolveLabRound(cfg, fs, { p1: { kind: 'run' } }, () => 0.01);
    expect(res.outcome).toBe('fled');
    expect(fs[0].fled).toBe(true);
  });

  it('pays more for deeper groups, and the Teman boost stays tiny', () => {
    const g = rollGroup(cfg, 0, 1, () => 0.2);
    expect(groupCoins(cfg, 5, g)).toBeGreaterThan(groupCoins(cfg, 0, g));
    expect(temanBoost(cfg, 'common', 1, 1)).toBeCloseTo(0.01, 5);
    expect(temanBoost(cfg, 'secret', 1.75, 1.55)).toBe(cfg.teman.max);
    expect(labPlayerStats(cfg, 0.08).atk).toBeLessThan(cfg.player.atk * 1.1);
  });
});

import { describe, expect, it } from 'vitest';
import labJson from '../../config/labyrinth.json';
import { labConfigSchema } from './config';
import { gearBonus } from './gear';
import { labLevel, labPointsFree, labXpNeed } from './progress';
import { branchPoints, labStats, treeBlock, treeTotals } from './stats';

const cfg = labConfigSchema.parse(labJson);
const none = { atk: 0, def: 0, hp: 0, spd: 0, crit: 0, block: 0 };
const full = (t: string) => gearBonus(cfg, { weapon: `weapon_${t}`, shield: `shield_${t}`, armour: `armour_${t}`, charm: `charm_${t}` });

describe('Labirin abyss stats: (base + items) × (1 + buffs)', () => {
  it('level 1, no tree, no gear, no buffs = the starting stats', () => {
    const s = labStats(cfg, { level: 1, ranks: {}, gear: none, teman: 0 });
    expect(s.atk).toBe(cfg.player.atk);
    expect(s.hp).toBe(cfg.player.hp);
    expect(s.mana).toBe(cfg.player.mana.max);
    expect(s.manaRegen).toBe(cfg.player.mana.perRound);
  });

  it('levels and flat tree points raise the base; items add; buffs multiply the sum', () => {
    const s = labStats(cfg, { level: 11, ranks: { tangan_besi: 4 }, gear: { ...none, atk: 7 }, cls: 'pemburu', teman: 0 });
    const base = cfg.player.atk + cfg.progress.perLevel.atk * 10 + 0.25 * 4;
    expect(s.lines.atk.base).toBeCloseTo(base, 2);
    expect(s.lines.atk.items).toBe(7);
    expect(s.lines.atk.pct).toBeCloseTo(0.12, 5); // Pemburu
    expect(s.atk).toBeCloseTo(Math.round((base + 7) * 1.12 * 10) / 10, 5);
  });

  it('the tree: deeper nodes need points in their branch; capped nodes stop; free points needed', () => {
    expect(treeBlock(cfg, {}, 'hentakan', 5)).toMatch(/needs 8 points/);
    const eight = { tangan_besi: 6, urat_dawai: 2 };
    expect(branchPoints(cfg, eight, 'kuasa')).toBe(8);
    expect(treeBlock(cfg, eight, 'hentakan', 5)).toBe('');
    expect(treeBlock(cfg, { ...eight, hentakan: 25 }, 'hentakan', 5)).toMatch(/at its best/);
    expect(treeBlock(cfg, {}, 'tangan_besi', 0)).toMatch(/No skill points/);
    expect(treeTotals(cfg, { tangan_besi: 1000 }).atk).toBeCloseTo(250); // flat nodes have no cap
    expect(treeTotals(cfg, { aliran_tenaga: 1000 }).manaRegen).toBeCloseTo(40 * 0.05); // capped
  });

  it('levels come easily, so each point is small: all-in ATK stays within reason', () => {
    // Level 10 after ~a couple of dozen first-floor fights.
    let xp = 0;
    for (let l = 1; l < 10; l++) xp += labXpNeed(cfg, l);
    expect(xp).toBeLessThan(500);
    expect(labLevel(cfg, xp).level).toBe(10);
    expect(labPointsFree(cfg, xp, {})).toBe(10);
    const gain = (level: number, tier: string | null) => {
      const g = tier ? full(tier) : none;
      const a = labStats(cfg, { level: 1, ranks: {}, gear: g, teman: 0 }).atk;
      const b = labStats(cfg, { level, ranks: { tangan_besi: level }, gear: g, teman: 0 }).atk;
      return b / a - 1;
    };
    expect(gain(10, null)).toBeLessThan(0.4); // early, gearless
    expect(gain(30, 'emas')).toBeLessThan(0.35); // mid-game, geared
    expect(gain(60, 'mistik')).toBeLessThan(0.45); // long-haul, endgame gear
  });
});

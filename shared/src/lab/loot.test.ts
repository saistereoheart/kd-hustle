import { describe, expect, it } from 'vitest';
import labJson from '../../config/labyrinth.json';
import { labConfigSchema } from './config';
import { gearBonus } from './gear';
import { classMods, itemMult, itemScrap, rollClass, rollLoot, wornBase, wornBonus } from './loot';

const cfg = labConfigSchema.parse(labJson);

describe('Labirin loot (feedback #24)', () => {
  it('grades and variants multiply a shop piece; the average grade is about the shop piece', () => {
    expect(itemMult(cfg, { grade: 'S', variant: 'rainbow' })).toBeCloseTo(1.35 * 1.2, 5);
    const total = cfg.loot.grades.reduce((a, g) => a + g.weight, 0);
    const avg = cfg.loot.grades.reduce((a, g) => a + g.mult * g.weight, 0) / total;
    expect(avg).toBeGreaterThan(0.95);
    expect(avg).toBeLessThan(1.05);
    expect(itemScrap(cfg, { gear: 'weapon_mistik', grade: 'S', variant: 'golden' })).toBeGreaterThan(itemScrap(cfg, { gear: 'weapon_kayu', grade: 'D', variant: 'normal' }));
  });

  it('a worn item (#uid) counts like its piece × its multiplier; others see the base piece', () => {
    const items = [{ uid: 7, gear: 'weapon_besi', grade: 'A', variant: 'normal' }];
    const shopOnly = gearBonus(cfg, { weapon: 'weapon_besi' });
    const withItem = wornBonus(cfg, { weapon: '#7' }, items);
    expect(withItem.atk).toBeCloseTo(shopOnly.atk * 1.2, 5);
    expect(wornBonus(cfg, { weapon: 'weapon_besi' })).toEqual(shopOnly);
    expect(wornBase(cfg, { weapon: '#7', shield: 'shield_kayu' }, items)).toEqual({ weapon: 'weapon_besi', shield: 'shield_kayu' });
    expect(wornBonus(cfg, { weapon: '#99' }, items).atk).toBe(0); // gone (scrapped): nothing
  });

  it('rolls: diamonds per monster, a floor boss always gives some; an item of this floor’s tier', () => {
    expect(rollLoot(cfg, 0, 3, false, () => 0.99)).toEqual({ diamonds: 0, item: undefined });
    const lucky = rollLoot(cfg, 5, 3, true, () => 0.0001);
    expect(lucky.diamonds).toBe(3 + cfg.loot.diamond.boss + 2);
    expect(lucky.item?.gear).toMatch(/_(emas|mistik)$/);
    expect(lucky.item?.variant).toBe('rainbow');
  });

  it('classes: trade-offs; the roll only gives roll classes you lack', () => {
    for (const c of cfg.classes.filter((x) => x.source === 'basic' && x.id !== 'pendekar')) {
      const m = classMods(cfg, c.id);
      const shares = [m.atk, m.def, m.hp, m.mana, m.skillPower];
      expect(shares.some((v) => v < 0)).toBe(true); // every basic class gives something up
    }
    const rolled = rollClass(cfg, [], () => 0.01);
    expect(rolled?.source).toBe('roll');
    const all = cfg.classes.filter((c) => c.source === 'roll').map((c) => c.id);
    expect(rollClass(cfg, all, () => 0.01)).toBeNull();
    expect(rollClass(cfg, [], () => 0.99)).toBeNull();
  });
});

import gradesJson from '../../config/grades.json';
import { gradesConfigSchema } from '../items/grades';
import { describe, expect, it } from 'vitest';
import cratesJson from '../../config/crates.json';
import economyJson from '../../config/economy.json';
import goalsJson from '../../config/goals.json';
import itemsJson from '../../config/items.json';
import levelsJson from '../../config/levels.json';
import questsJson from '../../config/quests.json';
import raritiesJson from '../../config/rarities.json';
import stagesJson from '../../config/stages.json';
import titlesJson from '../../config/titles.json';
import upgradesJson from '../../config/upgrades.json';
import { cratesConfigSchema, itemsConfigSchema, raritiesConfigSchema, economyConfigSchema, type CrateDef } from '../economy/schemas';
import {
  newlyDoneGoals, currentGoalIndex, buildSnapshot, combineMults, computeMods, conditionProgress, dayKey, effectivePity, levelInfo, levelUpReward, loginStatus,
  manifestRateSen, netWorthSen, pickQuests, prevDayKey, questProgress, skillCostSen, skillLevel, skillLockReason, stageForNetWorth,
  totalXpForLevel, validateProgressionConfigs, xpToNext, type ProgCfg,
} from './progression';
import { goalsConfigSchema, levelsConfigSchema, questsConfigSchema, stagesConfigSchema, titlesConfigSchema, upgradesConfigSchema } from './schemas';

const rarities = raritiesConfigSchema.parse(raritiesJson);
const items = itemsConfigSchema.parse(itemsJson);
const crates = cratesConfigSchema.parse(cratesJson);
const itemById = new Map(items.items.map((i) => [i.id, i]));
const crateOfItem = new Map<string, CrateDef>();
for (const c of crates.crates) for (const id of c.pool) crateOfItem.set(id, c);
const cfg: ProgCfg = {
  rarities, items, itemById, crates, crateOfItem, pawnRate: economyConfigSchema.parse(economyJson).pawnRate, grades: gradesConfigSchema.parse(gradesJson),
  levels: levelsConfigSchema.parse(levelsJson),
  stages: stagesConfigSchema.parse(stagesJson),
  titles: titlesConfigSchema.parse(titlesJson),
  upgrades: upgradesConfigSchema.parse(upgradesJson),
  quests: questsConfigSchema.parse(questsJson),
  goals: goalsConfigSchema.parse(goalsJson),
};

const snap = (o: Partial<Parameters<typeof buildSnapshot>[1]> = {}) =>
  buildSnapshot(cfg, { level: 1, stage: 1, walletSen: 0, inventory: [], index: [], pages: [], stats: {}, skills: {}, ...o });

describe('config', () => {
  it('the real progression configs are consistent', () => {
    expect(validateProgressionConfigs(cfg)).toEqual([]);
  });
});

describe('levels', () => {
  it('follows xp_needed = 100 × level^1.6', () => {
    expect(xpToNext(cfg.levels, 1)).toBe(100);
    expect(xpToNext(cfg.levels, 2)).toBe(Math.round(100 * 2 ** 1.6));
    expect(totalXpForLevel(cfg.levels, 1)).toBe(0);
    expect(totalXpForLevel(cfg.levels, 3)).toBe(100 + Math.round(100 * 2 ** 1.6));
  });

  it('turns total XP into a level and progress through it', () => {
    expect(levelInfo(cfg.levels, 0)).toEqual({ level: 1, into: 0, need: 100, maxed: false });
    expect(levelInfo(cfg.levels, 99).level).toBe(1);
    expect(levelInfo(cfg.levels, 100)).toMatchObject({ level: 2, into: 0 });
    expect(levelInfo(cfg.levels, 150)).toMatchObject({ level: 2, into: 50 });
    const max = totalXpForLevel(cfg.levels, cfg.levels.maxLevel);
    expect(levelInfo(cfg.levels, max + 1e9)).toMatchObject({ level: cfg.levels.maxLevel, maxed: true });
  });

  it('pays RM per level plus milestone rewards', () => {
    expect(levelUpReward(cfg.levels, 3)).toMatchObject({ sen: 3 * cfg.levels.levelUpSenPerLevel, items: [] });
    expect(levelUpReward(cfg.levels, 10).items).toEqual(['luck_potion', 'mega_luck_potion']);
  });
});

describe('net worth and stages', () => {
  it('counts cash plus the pawn price of items', () => {
    const duck = itemById.get('rubber_duck')!;
    const capsule = crates.crates.find((c) => c.id === 'capsule')!;
    const tier = rarities.tiers.find((t) => t.id === duck.rarity)!;
    const pawn = Math.floor(capsule.priceSen * tier.valueFactor * cfg.pawnRate);
    expect(netWorthSen(cfg, 1000, [{ itemId: 'rubber_duck', variant: 'normal' }])).toBe(1000 + pawn);
    // Potions (no crate) are worth their fixed value at the pawn rate.
    expect(netWorthSen(cfg, 0, [{ itemId: 'luck_potion', variant: 'normal' }])).toBe(Math.floor(itemById.get('luck_potion')!.valueSen! * cfg.pawnRate));
  });

  it('maps net worth to the right stage', () => {
    expect(stageForNetWorth(cfg.stages, 0)).toBe(1);
    expect(stageForNetWorth(cfg.stages, 199_999)).toBe(1);
    expect(stageForNetWorth(cfg.stages, 200_000)).toBe(2);
    expect(stageForNetWorth(cfg.stages, 5_000_000)).toBe(3);
    expect(stageForNetWorth(cfg.stages, 100_000_000_000)).toBe(6);
  });
});

describe('skills', () => {
  it('costs base × growth^levels bought', () => {
    const hh = cfg.upgrades.skills.hustle_harder;
    expect(skillCostSen(hh, 0)).toBe(hh.baseCostSen);
    expect(skillCostSen(hh, 2)).toBe(Math.round(hh.baseCostSen * hh.costGrowth ** 2));
    const m = cfg.upgrades.skills.manifest; // starts at level 1
    expect(skillCostSen(m, 1)).toBe(m.baseCostSen);
  });

  it('keeps Manifesting compatible with Phase 2 saves (level 1 = RM 0.02/s)', () => {
    expect(skillLevel(cfg.upgrades, {}, 'manifest')).toBe(1);
    expect(manifestRateSen(cfg.upgrades, {})).toBe(70); // level 1: RM 0.50 + RM 0.20
    expect(manifestRateSen(cfg.upgrades, { manifest: 3 })).toBe(110);
    expect(manifestRateSen(cfg.upgrades, { manifest: 5 })).toBe(150); // RM 1.50 a second = RM 5,400 an hour
  });

  it('locks skills behind level / stage and at max', () => {
    const lc = cfg.upgrades.skills.lucky_charm; // needs stage 2
    expect(skillLockReason(lc, 0, 10, 1, cfg.stages)).toMatch(/Hustler/);
    expect(skillLockReason(lc, 0, 10, 2, cfg.stages)).toBeNull();
    expect(skillLockReason(lc, lc.maxLevel, 10, 2, cfg.stages)).toBe('Maxed out');
    const fl = cfg.upgrades.skills.fast_learner; // needs level 3
    expect(skillLockReason(fl, 0, 2, 1, cfg.stages)).toMatch(/Level 3/);
  });
});

describe('multipliers', () => {
  const buff = (item: string, kind: 'luck' | 'xp' | 'passive' | 'jobPay', mult: number, leftMs = 60_000) => ({ item, kind, mult, leftMs });

  it('add across source types and multiply within one', () => {
    expect(combineMults([{ type: 'upgrade', mult: 1.2 }, { type: 'potion', mult: 1.5 }])).toBeCloseTo(1.7);
    expect(combineMults([{ type: 'potion', mult: 2 }, { type: 'potion', mult: 5 }])).toBeCloseTo(10);
  });

  it('combines Lucky Charm, potions and a title into crate luck', () => {
    const m = computeMods(cfg, { skills: { lucky_charm: 4 }, title: 'collector', buffs: [buff('luck_potion', 'luck', 2)] });
    expect(m.luck).toBeCloseTo(1 + 0.2 + 1 + 0.05);
    const two = computeMods(cfg, { skills: { lucky_charm: 4 }, title: null, buffs: [buff('luck_potion', 'luck', 2), buff('mega_luck_potion', 'luck', 5)] });
    expect(two.luck).toBeCloseTo(1 + 0.2 + 9);
    expect(two.luckSources).toHaveLength(3);
  });

  it('ignores expired buffs and caps luck', () => {
    expect(computeMods(cfg, { skills: {}, title: null, buffs: [buff('luck_potion', 'luck', 2, 0)] }).luck).toBe(1);
    const huge = computeMods(cfg, { skills: {}, title: null, buffs: Array.from({ length: 6 }, (_, i) => buff(`p${i}`, 'luck', 5)) });
    expect(huge.luck).toBe(rarities.maxLuck);
  });

  it('works out job pay, XP, walk speed, pity and car wash time', () => {
    const m = computeMods(cfg, {
      skills: { hustle_harder: 4, fast_learner: 2, kaki_lari: 5, pity_pact: 5, elbow_grease: 2, shiny_sense: 3, auto_roll: 1 },
      title: 'rajin',
      buffs: [buff('kopi_kaw', 'jobPay', 1.5), buff('xp_booster', 'xp', 2)],
    });
    expect(m.jobPay).toBeCloseTo(1 + 0.2 + 0.5);
    expect(m.xp).toBeCloseTo(1 + 0.1 + 1 + 0.03);
    expect(m.walk).toBeCloseTo(1.2);
    expect(m.pityMult).toBeCloseTo(0.8);
    expect(m.carwashExtraSec).toBe(6);
    expect(m.variantChance).toBeCloseTo(1.3);
    expect(m.autoRoll).toBe(true);
    const capsule = crates.crates.find((c) => c.id === 'capsule')!;
    expect(effectivePity(capsule, m.pityMult)).toEqual({ epic: 40, legendary: 240 });
  });
});

describe('conditions', () => {
  it('reports progress for every condition type', () => {
    const s = snap({ level: 4, stage: 1, walletSen: 150_000, stats: { jobs: 3 }, skills: { manifest: 2 }, index: ['rubber_duck'] });
    expect(conditionProgress({ type: 'stat', stat: 'jobs', n: 5 }, s)).toEqual({ cur: 3, target: 5, done: false, unit: 'count' });
    expect(conditionProgress({ type: 'level', n: 3 }, s).done).toBe(true);
    expect(conditionProgress({ type: 'stage', n: 2 }, s, cfg.stages)).toEqual({ cur: 150_000, target: 200_000, done: false, unit: 'money' });
    expect(conditionProgress({ type: 'netWorth', sen: 100_000 }, s).done).toBe(true);
    expect(conditionProgress({ type: 'skill', id: 'manifest', n: 5 }, s)).toMatchObject({ cur: 2, done: false });
    expect(conditionProgress({ type: 'page', crate: 'capsule' }, s)).toMatchObject({ cur: 1, target: 16, done: false });
    expect(conditionProgress({ type: 'index', pct: 50 }, s).done).toBe(false);
    expect(conditionProgress({ type: 'always' }, s).done).toBe(true);
  });

  it('Hustle Path goals complete in any order; the HUD shows the first one not done', () => {
    expect(newlyDoneGoals(cfg.goals, new Set(), snap(), cfg.stages)).toEqual([]);
    expect(newlyDoneGoals(cfg.goals, new Set(), snap({ stats: { jobs: 1, rolls: 1 } }), cfg.stages)).toEqual([0, 1]);
    // Rolled before taking a job: the roll goal pays now, the job goal stays current.
    expect(newlyDoneGoals(cfg.goals, new Set(), snap({ stats: { rolls: 1 } }), cfg.stages)).toEqual([1]);
    expect(newlyDoneGoals(cfg.goals, new Set(['first_roll']), snap({ stats: { rolls: 1 } }), cfg.stages)).toEqual([]);
    expect(currentGoalIndex(cfg.goals, ['first_roll'])).toBe(0);
    expect(currentGoalIndex(cfg.goals, ['first_job', 'first_roll'])).toBe(2);
    expect(currentGoalIndex(cfg.goals, cfg.goals.goals.map((g) => g.id))).toBe(cfg.goals.goals.length);
  });
});

describe('daily login', () => {
  const day = (y: number, m: number, d: number) => dayKey(new Date(y, m - 1, d, 15).getTime());

  it('knows yesterday, also across months and years', () => {
    expect(prevDayKey('2026-03-01')).toBe('2026-02-28');
    expect(prevDayKey('2027-01-01')).toBe('2026-12-31');
  });

  it('builds a streak on consecutive days, resets after a gap, and loops after day 7', () => {
    expect(loginStatus({ lastDay: null, streak: 0 }, day(2026, 11, 17))).toEqual({ canClaim: true, nextDay: 1, keepsStreak: false });
    expect(loginStatus({ lastDay: day(2026, 11, 17), streak: 1 }, day(2026, 11, 17)).canClaim).toBe(false);
    expect(loginStatus({ lastDay: day(2026, 11, 17), streak: 1 }, day(2026, 11, 18))).toEqual({ canClaim: true, nextDay: 2, keepsStreak: true });
    expect(loginStatus({ lastDay: day(2026, 11, 17), streak: 4 }, day(2026, 11, 19))).toMatchObject({ canClaim: true, nextDay: 1, keepsStreak: false });
    expect(loginStatus({ lastDay: day(2026, 11, 17), streak: 7 }, day(2026, 11, 18))).toMatchObject({ nextDay: 1, keepsStreak: true });
  });
});

describe('daily quests', () => {
  it('picks distinct quests the stage allows, measured from when they were given', () => {
    let seed = 7;
    const rand = (max: number) => (seed = (seed * 16807) % 2147483647) % max;
    for (let i = 0; i < 50; i++) {
      const qs = pickQuests(cfg.quests, 1, { rolls: 40 }, rand);
      expect(qs).toHaveLength(cfg.quests.perDay);
      expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
      for (const q of qs) expect(cfg.quests.daily.find((d) => d.id === q.id)!.minStage).toBe(1);
    }
    const def = cfg.quests.daily.find((d) => d.id === 'roll')!;
    const q = pickQuests({ ...cfg.quests, perDay: 1, daily: [def] }, 1, { rolls: 40 }, rand)[0];
    expect(q).toMatchObject({ base: 40, target: def.targets[0], senReward: def.reward.senByStage[0] });
    expect(questProgress(def, q, { rolls: 45 })).toEqual({ cur: 5, done: false });
    expect(questProgress(def, q, { rolls: 40 + def.targets[0] }).done).toBe(true);
  });

  it('scales targets and rewards with the stage', () => {
    const def = cfg.quests.daily.find((d) => d.id === 'jobs')!;
    const q3 = pickQuests({ ...cfg.quests, perDay: 1, daily: [def] }, 3, {}, () => 0)[0];
    expect(q3.target).toBe(def.targets[2]);
    expect(q3.senReward).toBe(def.reward.senByStage[2]);
  });
});

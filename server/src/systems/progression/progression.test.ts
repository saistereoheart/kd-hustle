import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { levelUpReward, totalXpForLevel, type ProgressEvent, type RandInt } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { backfillProgress } from '../../db/migrations';
import { createRepos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy, GameError } from '../economy/economy';
import { Gacha } from '../gacha/gacha';
import { emptyProgress, ProgressionSystem, retroXp } from './progression';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const rand: RandInt = () => 0;
const at = (d: number, h = 12) => new Date(2026, 10, d, h).getTime(); // November 2026

function setup(walletSen = 30000) {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create('tester', 'h', false, { x: 0, y: 0 }, 2, walletSen);
  const p = {
    id, name: 'tester', scene: 'town', walletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set<string>(),
    pages: new Set<string>(), pity: {}, jobs: {}, job: null, vehicle: null, skills: {}, manifestBank: 0, manifestSecs: 0,
    hotbar: [], rideQuote: null, ride: null, prog: emptyProgress(),
  } as unknown as OnlinePlayer;
  const econ = new Economy(repos, cfg);
  const gacha = new Gacha(repos, cfg, econ, rand);
  let now = at(17);
  const events: ProgressEvent[] = [];
  const announced: string[] = [];
  const pub: Array<{ level?: number; title?: string | null }> = [];
  const prog = new ProgressionSystem(cfg, repos, econ, rand, {
    wallet: () => {},
    items: () => {},
    progress: (_p, ev) => events.push(...ev),
    publicChanged: (_p, c) => pub.push(c),
    announce: (text) => announced.push(text),
    freeRoll: (pl, crateId) => ({ crateId, results: gacha.roll(pl, crateId, 1, { free: true }).results }),
  }, () => now);
  prog.load(p);
  const txSum = () => (db.prepare('SELECT COALESCE(SUM(delta_sen),0) AS s FROM transactions WHERE account_id = ?').get(id) as { s: number }).s;
  return { db, repos, p, econ, prog, events, announced, pub, txSum, setNow: (t: number) => (now = t), gacha };
}

describe('XP and levels', () => {
  it('a paid job gives XP and counts in the stats', () => {
    const { p, prog } = setup();
    prog.onJob(p, 'delivery', 6000, false);
    const x = cfg.levels.xp;
    // + the first Hustle Path goal ("take your first job") pays XP too.
    expect(p.prog.xp).toBe(Math.floor(x.jobBase + 60 * x.jobPerRm) + (cfg.goals.goals[0].reward.xp ?? 0));
    expect(p.prog.stats).toMatchObject({ jobs: 1, jobs_delivery: 1, jobEarnSen: 6000 });
  });

  it('an unpaid job (a failed car wash) counts for nothing', () => {
    const { p, prog } = setup();
    prog.onJob(p, 'carwash', 0, false);
    expect(p.prog.xp).toBe(0);
    expect(p.prog.stats.jobs).toBeUndefined();
  });

  it('levelling up pays the level reward once, broadcasts the level and persists', () => {
    const { p, prog, events, pub, repos, txSum } = setup(0);
    p.prog.xp = totalXpForLevel(cfg.levels, 5) - 1;
    prog.check(p);
    expect(p.prog.level).toBe(4);
    const wallet = p.walletSen;
    p.prog.xp += 1;
    prog.check(p);
    expect(p.prog.level).toBe(5);
    const r = levelUpReward(cfg.levels, 5);
    expect(p.walletSen).toBe(wallet + (r.sen ?? 0));
    expect(p.inventory.map((i) => i.itemId)).toEqual(expect.arrayContaining(r.items ?? []));
    expect(events.filter((e) => e.kind === 'level').map((e) => (e as { level: number }).level)).toEqual([2, 3, 4, 5]);
    expect(pub.at(-1)).toEqual({ level: 5 });
    expect(repos.progress.load(p.id)).toMatchObject({ level: 5, xp: p.prog.xp });
    expect(txSum()).toBe(p.walletSen); // every sen of reward is in the economy log
    prog.check(p);
    expect(events.filter((e) => e.kind === 'level')).toHaveLength(4); // no double rewards
  });

  it('XP Booster and Fast Learner multiply XP (with fractions carried over)', () => {
    const { p, prog } = setup();
    p.skills = { fast_learner: 2 }; // +10%
    p.prog.buffs.push({ item: 'xp_booster', kind: 'xp', mult: 2, until: at(17, 13) });
    prog.addXp(p, 10); // 10 × (1 + 0.1 + 1) = 21
    expect(p.prog.xp).toBe(21);
    prog.addXp(p, 0.5); // 1.05 → 1 + 0.05 carried
    expect(p.prog.xp).toBe(22);
    expect(p.prog.xpFrac).toBeCloseTo(0.05);
  });
});

describe('wealth stages', () => {
  it('reaching RM 2,000 net worth makes you a Hustler (once), and the stage never drops', () => {
    const { p, prog, econ, events, announced } = setup(150_000);
    prog.check(p);
    expect(p.prog.stage).toBe(1);
    econ.run(p, () => econ.change(p, 60_000, 0, 'test'));
    prog.check(p);
    expect(p.prog.stage).toBe(2);
    expect(events.some((e) => e.kind === 'stage' && e.stage === 2)).toBe(true);
    expect(announced.some((t) => t.includes('HUSTLER'))).toBe(true);
    econ.run(p, () => econ.change(p, -p.walletSen, 0, 'test'));
    prog.check(p);
    expect(p.prog.stage).toBe(2);
  });

  it('gates crates by stage and level', () => {
    const { p, prog } = setup();
    const mall = cfg.crateById.get('mallbox')!;
    expect(prog.crateLock(p, cfg.crateById.get('capsule')!)).toBeNull();
    expect(prog.crateLock(p, cfg.crateById.get('luckybag')!)).toMatch(/stage 2/);
    p.prog.stage = 2;
    expect(prog.crateLock(p, mall)).toMatch(/Level 5/);
    p.prog.level = 5;
    expect(prog.crateLock(p, mall)).toBeNull();
  });
});

describe('titles and the Hustle Path', () => {
  it('earns Part-timer after 10 jobs, and only earned titles can be worn', () => {
    const { p, prog, pub } = setup();
    expect(() => prog.equipTitle(p, 'part_timer')).toThrow(GameError);
    for (let i = 0; i < 10; i++) prog.onJob(p, 'carwash', 3000, i < 2);
    expect(p.prog.titles).toEqual(expect.arrayContaining(['budak_baru', 'part_timer']));
    prog.equipTitle(p, 'part_timer');
    expect(p.prog.title).toBe('part_timer');
    expect(pub).toContainEqual({ title: 'part_timer' });
    expect(p.prog.stats.titleEquips).toBe(1);
  });

  it('the first job completes the first goal and pays its reward', () => {
    const { p, prog, events } = setup(0);
    const g = cfg.goals.goals[0];
    prog.onJob(p, 'delivery', 5000, false);
    expect(p.prog.path).toBe(1);
    expect(events).toContainEqual({ kind: 'goal', id: g.id, rewardSen: g.reward.sen ?? 0, items: g.reward.items ?? [] });
  });
});

describe('Hustle Skills', () => {
  it('charges base × growth^level and refuses locked or unaffordable levels', () => {
    const { p, prog, repos } = setup(100_000); // RM 1,000: still stage 1
    const hh = cfg.upgrades.skills.hustle_harder;
    prog.upgradeSkill(p, 'hustle_harder');
    expect(p.walletSen).toBe(100_000 - hh.baseCostSen);
    expect(p.skills.hustle_harder).toBe(1);
    expect(repos.econ.load(p.id).skills.hustle_harder).toBe(1);
    prog.upgradeSkill(p, 'hustle_harder');
    expect(p.walletSen).toBe(100_000 - hh.baseCostSen - Math.round(hh.baseCostSen * hh.costGrowth));
    expect(p.prog.stats.skillLevels).toBe(2);
    expect(() => prog.upgradeSkill(p, 'lucky_charm')).toThrow(/Hustler/); // needs stage 2
    expect(() => prog.upgradeSkill(p, 'nope')).toThrow(GameError);
    const poor = setup(100);
    expect(() => poor.prog.upgradeSkill(poor.p, 'hustle_harder')).toThrow(/costs/);
    expect(poor.p.walletSen).toBe(100);
  });
});

describe('potions', () => {
  const givePotion = (s: ReturnType<typeof setup>, id: string) => s.econ.run(s.p, () => s.econ.grant(s.p, id, 'normal', null)).item;

  it('drinking a Luck Potion removes it, doubles luck and stacks its time', () => {
    const s = setup();
    const a = givePotion(s, 'luck_potion');
    const b = givePotion(s, 'luck_potion');
    expect(s.p.index.has('luck_potion')).toBe(false); // potions aren't Item Index collectibles
    s.prog.useItem(s.p, a.iid);
    expect(s.p.inventory.some((i) => i.iid === a.iid)).toBe(false);
    expect(s.prog.mods(s.p).luck).toBeCloseTo(2);
    s.prog.useItem(s.p, b.iid);
    expect(s.p.prog.buffs).toHaveLength(1);
    expect(s.p.prog.buffs[0].until - at(17)).toBe(2 * 600_000);
    s.setNow(at(17) + 20 * 60_000 + 1);
    expect(s.prog.mods(s.p).luck).toBe(1); // expired
  });

  it('caps stacking and refuses things that are not potions', () => {
    const s = setup();
    for (let i = 0; i < 6; i++) s.prog.useItem(s.p, givePotion(s, 'luck_potion').iid);
    expect(() => s.prog.useItem(s.p, givePotion(s, 'luck_potion').iid)).toThrow(/up to/);
    expect(() => s.prog.useItem(s.p, givePotion(s, 'rubber_duck').iid)).toThrow(/can't be used/);
  });

  it('buff timers pause while offline (saved as time left)', () => {
    const s = setup();
    s.prog.useItem(s.p, givePotion(s, 'xp_booster').iid);
    s.setNow(at(17) + 5 * 60_000);
    s.prog.save(s.p);
    s.setNow(at(18)); // a day later
    s.prog.load(s.p);
    expect(s.prog.activeBuffs(s.p)[0].leftMs).toBe(10 * 60_000);
  });
});

describe('daily login streak', () => {
  it('claims once a day, builds the streak, resets after a missed day', () => {
    const s = setup(0);
    const r1 = s.prog.claimDaily(s.p);
    expect(r1.day).toBe(1);
    expect(s.p.walletSen).toBeGreaterThanOrEqual(cfg.quests.login[0].sen ?? 0);
    expect(() => s.prog.claimDaily(s.p)).toThrow(/already/);
    s.setNow(at(18));
    expect(s.prog.claimDaily(s.p).day).toBe(2);
    expect(s.p.inventory.some((i) => i.itemId === 'kopi_kaw')).toBe(true);
    s.setNow(at(20)); // missed the 19th
    expect(s.prog.claimDaily(s.p).day).toBe(1);
    expect(s.p.prog.stats).toMatchObject({ dailyClaims: 3, loginStreak: 1, bestLoginStreak: 2 });
  });

  it('day 7 gives a free crate roll without charging for it', () => {
    const s = setup(0);
    s.p.prog.login = { lastDay: '2026-11-16', streak: 6 };
    const r = s.prog.claimDaily(s.p);
    expect(r.day).toBe(7);
    expect(r.roll?.crateId).toBe('mallbox');
    expect(r.roll?.results).toHaveLength(1);
    expect(s.p.walletSen).toBeGreaterThanOrEqual(0);
    expect(s.p.prog.stats.rolls_mallbox).toBe(1);
    expect(s.txSum()).toBe(s.p.walletSen);
  });
});

describe('daily quests', () => {
  it('hands out quests per day, pays once when done', () => {
    const s = setup(0);
    s.prog.check(s.p);
    const list = s.p.prog.quests.list;
    expect(list).toHaveLength(cfg.quests.perDay);
    const q = list[0];
    const def = cfg.quests.daily.find((d) => d.id === q.id)!;
    expect(() => s.prog.claimQuest(s.p, q.id)).toThrow(/Not done/);
    s.prog.bump(s.p, def.stat, q.target);
    s.prog.check(s.p);
    expect(s.events.some((e) => e.kind === 'questReady' && e.id === q.id)).toBe(true);
    const before = s.p.walletSen;
    s.prog.claimQuest(s.p, q.id);
    expect(s.p.walletSen).toBeGreaterThanOrEqual(before + q.senReward);
    expect(() => s.prog.claimQuest(s.p, q.id)).toThrow(/Already/);
    s.setNow(at(18));
    s.prog.check(s.p);
    expect(s.p.prog.quests.day).toBe('2026-11-18');
    expect(s.p.prog.quests.list.every((x) => !x.claimed)).toBe(true);
  });
});

describe('players from before Phase 3', () => {
  it('migration 7 rebuilds their stats and they get XP for them on login', () => {
    const db = openDatabase(':memory:');
    const repos = createRepos(db);
    const id = repos.accounts.create('oldtimer', 'h', false, { x: 0, y: 0 }, 2, 30000);
    for (let i = 0; i < 12; i++) repos.rolls.log(id, 'capsule', 'rubber_duck', 'common', 'normal', null);
    repos.rolls.log(id, 'capsule', 'golden_crown', 'legendary', 'normal', null);
    db.prepare('UPDATE players SET jobs_json = ?, skills_json = ? WHERE account_id = ?').run(JSON.stringify({ delivery: { level: 2, done: 7 } }), JSON.stringify({ manifest: 3 }), id);
    repos.econ.logTx(id, 42000, 72000, 0, 'job-delivery', 'x');
    repos.econ.logTx(id, -26000, 46000, 0, 'crate', 'capsulex13');
    repos.econ.logTx(id, 500, 46500, 0, 'manifest', '120s');
    backfillProgress(db);
    const rec = repos.progress.load(id);
    expect(rec.retroXp).toBe(true);
    expect(rec.stats).toMatchObject({ rolls: 13, rolls_capsule: 13, epicPlusRolls: 1, legendaryRolls: 1, jobs: 7, jobs_delivery: 7, jobEarnSen: 42000, crateSpendSen: 26000, manifestSecs: 120, skillLevels: 2 });
    const xp = retroXp(cfg, rec.stats);
    expect(xp).toBeGreaterThan(0);
    const p = { id, prog: emptyProgress() } as unknown as OnlinePlayer;
    const prog = new ProgressionSystem(cfg, repos, new Economy(repos, cfg), rand, {} as never);
    prog.load(p);
    expect(p.prog.xp).toBe(xp);
    prog.save(p);
    expect(repos.progress.load(id).retroXp).toBe(false); // only once
  });
});

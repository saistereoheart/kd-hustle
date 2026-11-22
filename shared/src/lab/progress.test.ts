import { describe, expect, it } from 'vitest';
import labJson from '../../config/labyrinth.json';
import { labConfigSchema } from './config';
import { groupXp, labLevel, labPointsFree, labSkillBonus, labXpNeed, rollSpellBook } from './progress';
import { resolveLabRound, type LabFighter } from './battle';

const cfg = labConfigSchema.parse(labJson);

const foe = (id: string, hp = 100): LabFighter => ({ id, side: 'foe', name: id, move: 'Gigit', hp, maxHp: hp, atk: 1, def: 2, spd: 1, focus: 0, out: false });
const me = (over: Partial<LabFighter> = {}): LabFighter => ({ id: 'p1', side: 'party', name: 'me', move: '', hp: 50, maxHp: 100, atk: 20, def: 4, spd: 99, focus: 3, out: false, crit: 0, ...over });

describe('Labirin progress', () => {
  it('levels from XP on the curve, with a skill point per level', () => {
    expect(labLevel(cfg, 0)).toEqual({ level: 1, into: 0, need: labXpNeed(cfg, 1) });
    const l1 = labXpNeed(cfg, 1), l2 = labXpNeed(cfg, 2);
    expect(labLevel(cfg, l1).level).toBe(2);
    expect(labLevel(cfg, l1 + l2 - 1)).toEqual({ level: 2, into: l2 - 1, need: l2 });
    expect(labPointsFree(cfg, 0, {})).toBe(1);
    expect(labPointsFree(cfg, l1 + l2, { tangan_besi: 2 })).toBe(1);
    expect(labLevel(cfg, 1e12).level).toBe(cfg.progress.levels.max);
  });

  it('adds skill ranks up, capped at each skill’s max', () => {
    const b = labSkillBonus(cfg, { tangan_besi: 2, langkah_angin: 99 });
    expect(b.atk).toBeCloseTo(0.1);
    expect(b.spd).toBe(5);
  });

  it('XP grows with the floor; bosses give much more', () => {
    expect(groupXp(cfg, 0, [foe('m0')])).toBe(cfg.progress.xp.perMonster);
    expect(groupXp(cfg, 2, [foe('m0')])).toBeGreaterThan(groupXp(cfg, 0, [foe('m0')]));
    expect(groupXp(cfg, 0, [{ ...foe('b0'), boss: true }])).toBe(cfg.progress.xp.boss);
  });

  it('the tavern roll gives a book you lack (by weight) or nothing', () => {
    expect(rollSpellBook(cfg, [], () => 0.99)).toBeNull();
    const owned = cfg.spells.list.slice(1).map((s) => s.id);
    expect(rollSpellBook(cfg, owned, () => 0)?.id).toBe(cfg.spells.list[0].id);
    expect(rollSpellBook(cfg, cfg.spells.list.map((s) => s.id), () => 0)).toBeNull();
  });
});

describe('Labirin ultimates', () => {
  it('a damage spell hits every monster and spends a full focus bar', () => {
    const fs2 = [me({ spell: 'kitab_api' }), foe('m0'), foe('m1'), foe('m2')];
    const { events } = resolveLabRound(cfg, fs2, { p1: { kind: 'ultimate' } }, () => 0.5);
    const hits = events.filter((e) => e.kind === 'hit' && e.aoe && e.actor === 'p1');
    expect(events[0]).toMatchObject({ kind: 'spell', spell: 'kitab_api' });
    expect(hits.map((e) => e.target)).toEqual(['m0', 'm1', 'm2']);
    expect(fs2[0].focus).toBe(1); // 3 − 3, +1 for the round
    for (const f of fs2.slice(1)) expect(f.hp).toBeLessThan(100);
  });

  it('a heal spell heals every standing friend; spell power from skills makes it stronger', () => {
    const a = [me({ spell: 'kitab_embun' }), { ...me(), id: 'p2' }, foe('m0', 1e6)];
    resolveLabRound(cfg, a, { p1: { kind: 'ultimate' }, p2: { kind: 'guard' } }, () => 0.5);
    const b = [me({ spell: 'kitab_embun', spellUp: 0.5 }), foe('m0', 1e6)];
    resolveLabRound(cfg, b, { p1: { kind: 'ultimate' } }, () => 0.5);
    expect(a[1].hp).toBeGreaterThan(50);
    expect(b[0].hp - 50).toBeGreaterThan(a[1].hp - 50 - 1); // (minus the monster's poke)
  });

  it('does nothing without a book or a full bar', () => {
    const fs3 = [me({ focus: 2, spell: 'kitab_api' }), foe('m0')];
    const { events } = resolveLabRound(cfg, fs3, { p1: { kind: 'ultimate' } }, () => 0.5);
    expect(events.some((e) => e.kind === 'spell')).toBe(false);
  });
});

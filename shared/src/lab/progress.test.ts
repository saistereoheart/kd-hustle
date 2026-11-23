import { describe, expect, it } from 'vitest';
import labJson from '../../config/labyrinth.json';
import { labConfigSchema } from './config';
import { groupXp, labLevel, labPointsFree, labSpell, labUltimate, labXpNeed, rollSpellBook } from './progress';
import { resolveLabRound, type LabFighter } from './battle';

const cfg = labConfigSchema.parse(labJson);

const foe = (id: string, hp = 100): LabFighter => ({ id, side: 'foe', name: id, move: 'Gigit', hp, maxHp: hp, atk: 1, def: 2, spd: 1, focus: 0, out: false });
const me = (over: Partial<LabFighter> = {}): LabFighter => ({ id: 'p1', side: 'party', name: 'me', move: '', hp: 50, maxHp: 100, atk: 20, def: 4, spd: 99, focus: cfg.spells.focus, out: false, crit: 0, ...over });

describe('Labirin progress', () => {
  it('levels from XP on the curve, with a skill point per level', () => {
    expect(labLevel(cfg, 0)).toEqual({ level: 1, into: 0, need: labXpNeed(cfg, 1) });
    const l1 = labXpNeed(cfg, 1), l2 = labXpNeed(cfg, 2);
    expect(labLevel(cfg, l1).level).toBe(2);
    expect(labLevel(cfg, l1 + l2 - 1)).toEqual({ level: 2, into: l2 - 1, need: l2 });
    expect(labPointsFree(cfg, 0, {})).toBe(1);
    expect(labPointsFree(cfg, l1 + l2, { tangan_besi: 2 })).toBe(1);
    // No real cap: levels keep coming (each costs a bit more).
    expect(labLevel(cfg, 1e12).level).toBeGreaterThan(100);
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
    expect(fs2[0].focus).toBe(1); // a full bar spent, +1 for the round
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

describe('Labirin elements and mana', () => {
  const caster = (element: string, over: Partial<LabFighter> = {}) => me({ element, mana: 20, maxMana: 20, focus: 0, ...over });
  const el = (id: string) => cfg.elements.find((e) => e.id === id)!;

  it('a skill spends its mana (+1 back for the round); short of mana it is a plain attack', () => {
    const a = [caster('petir'), foe('m0', 1e6)];
    const { events } = resolveLabRound(cfg, a, { p1: { kind: 'skill' } }, () => 0.5);
    expect(events.find((e) => e.kind === 'hit' && e.actor === 'p1')).toMatchObject({ skill: true, element: 'petir' });
    expect(a[0].mana).toBe(20 - el('petir').skill.mana + cfg.player.mana.perRound);
    const b = [caster('petir', { mana: 1 }), foe('m0', 1e6)];
    const r2 = resolveLabRound(cfg, b, { p1: { kind: 'skill' } }, () => 0.5);
    expect(r2.events.find((e) => e.kind === 'hit' && e.actor === 'p1')?.skill).toBeFalsy();
    expect(b[0].mana).toBe(1 + cfg.player.mana.perRound);
  });

  it('🔥 burns tick at the end of the round; 💧 heals you a share of the damage', () => {
    const a = [caster('api'), foe('m0', 1e6)];
    const { events } = resolveLabRound(cfg, a, { p1: { kind: 'skill' } }, () => 0.5);
    const hit = events.find((e) => e.kind === 'hit' && e.actor === 'p1' && !e.burn)!;
    const tick = events.find((e) => e.burn)!;
    expect(tick.dmg).toBe(Math.round(hit.dmg! * el('api').skill.burn!));
    expect(a[1].burn?.left).toBe(el('api').skill.burnRounds! - 1);
    const b = [caster('air'), foe('m0', 1e6)];
    resolveLabRound(cfg, b, { p1: { kind: 'skill' } }, () => 0.5);
    expect(b[0].hp).toBeGreaterThan(50 - 5); // healed back more than the monster's tiny hit
  });

  it('🌪️ hits every monster; ⚡ goes first even when slower; 🪨 takes less damage that round', () => {
    const a = [caster('angin'), foe('m0', 1e6), foe('m1', 1e6), foe('m2', 1e6)];
    const r = resolveLabRound(cfg, a, { p1: { kind: 'skill' } }, () => 0.5);
    expect(r.events[0]).toMatchObject({ kind: 'cast', element: 'angin' });
    expect(r.events.filter((e) => e.kind === 'hit' && e.actor === 'p1')).toHaveLength(3);
    const fast = { ...foe('m0', 1e6), spd: 999 };
    const b = [caster('petir', { spd: 1 }), fast];
    const r2 = resolveLabRound(cfg, b, { p1: { kind: 'skill' } }, () => 0.5);
    expect(r2.events.find((e) => e.kind === 'hit')!.actor).toBe('p1');
    const hurt = (element: string, kind: 'skill' | 'attack') => {
      const big = { ...foe('m0', 1e6), atk: 30 };
      const c = [caster(element, { hp: 100 }), big];
      resolveLabRound(cfg, c, { p1: { kind } }, () => 0.5);
      return 100 - c[0].hp;
    };
    expect(hurt('tanah', 'skill')).toBeLessThan(hurt('tanah', 'attack'));
  });

  it('your ultimate follows your element: its book if you own it, else the basic one', () => {
    expect(labUltimate(cfg, 'api', []).id).toBe('ult_api');
    expect(labUltimate(cfg, 'api', ['kitab_api']).id).toBe('kitab_api');
    expect(labUltimate(cfg, 'air', ['kitab_api']).id).toBe('ult_air');
    expect(labSpell(cfg, 'ult_tanah')?.move).toBe(el('tanah').ultimate.move);
    // Every book belongs to an element.
    for (const b of cfg.spells.list) expect(b.element === 'all' || cfg.elements.some((e) => e.id === b.element)).toBe(true);
    // A boss skill (element 'all') works with any element, and wins if it's stronger.
    expect(labUltimate(cfg, 'air', ['kitab_raja']).id).toBe('kitab_raja');
    const a = [caster('air', { focus: cfg.spells.focus, spell: 'ult_air', hp: 50 }), foe('m0', 1e6)];
    resolveLabRound(cfg, a, { p1: { kind: 'ultimate' } }, () => 0.5);
    expect(a[0].hp).toBeGreaterThan(50);
  });

  it('a mana potion gives mana back', () => {
    const a = [caster('api', { mana: 0 }), foe('m0', 1e6)];
    const r = resolveLabRound(cfg, a, { p1: { kind: 'item', item: 'air_kelapa' } }, () => 0.5);
    expect(r.used).toEqual([{ actor: 'p1', item: 'air_kelapa' }]);
    expect(a[0].mana).toBe(10 + cfg.player.mana.perRound);
  });
});

describe('Labirin damage tiers (feedback #26)', () => {
  it('⚔️ Attack < 💥 Skill < 📜 Ultimate for every element, and a book beats its basic ultimate', () => {
    for (const e of cfg.elements) {
      expect(e.skill.power ?? 1).toBeGreaterThan(1);
      expect(e.ultimate.power ?? 0).toBeGreaterThan(e.skill.power ?? 1);
      const book = cfg.spells.list.find((b) => b.element === e.id)!;
      expect((book.power ?? 0) + (book.heal ?? 0)).toBeGreaterThan((e.ultimate.power ?? 0) * 0.6 + (e.ultimate.heal ?? 0));
    }
  });
});

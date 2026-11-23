import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { roomLayout } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { LabSystem } from './lab';
import { LabBattles } from './labBattles';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const lc = cfg.lab;

function setup() {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const lab = new LabSystem(lc, repos, () => 0.5, () => 1_700_000_000_000);
  const started: number[][] = [];
  const battles = new LabBattles(lc, lab, { started: (ps) => started.push(ps.map((p) => p.id)), picked: () => {}, round: () => {} }, () => 0.5, () => 0, () => 0 as never, () => {});
  const player = (name: string) => {
    const id = repos.accounts.create(name, 'h', false, { x: 0, y: 0 }, 2, 0);
    return { id, name, hasCharacter: true, lab: null } as unknown as OnlinePlayer;
  };
  // A monster room next to the entrance.
  const f = lab.floor(0);
  const room = f.rooms.filter((r) => r.monsters).sort((a, b) => a.dist - b.dist)[0];
  const putIn = (p: OnlinePlayer) => {
    p.lab = { floor: 0, room: room.id, x: 400, y: 300, dir: 'up', moving: false, at: 0 };
  };
  return { lab, battles, player, putIn, started };
}

describe('Labirin party battles', () => {
  it('a party in the room fights together, and a member walking in joins the fight', () => {
    const s = setup();
    const a = s.player('a'), b = s.player('b'), c = s.player('c');
    [a, b, c].forEach(s.putIn);
    expect(s.battles.encounter([a, b])).toBe(true);
    const v = s.battles.view(a)!;
    expect(v.fighters.filter((f) => f.side === 'party').map((f) => f.id)).toEqual([`p${a.id}`, `p${b.id}`]);
    // c (the third member) walks in: joins this fight.
    expect(s.battles.join(c, a)).toBe(true);
    expect(s.battles.inFight(c)).toBe(true);
    expect(s.battles.view(c)!.fighters.filter((f) => f.side === 'party')).toHaveLength(3);
    expect(s.started.at(-1)).toEqual([c.id]);
    // Not twice, and not from another room.
    expect(s.battles.join(c, a)).toBe(false);
    const d = s.player('d');
    d.lab = { floor: 0, room: 0, x: 0, y: 0, dir: 'up', moving: false, at: 0 };
    expect(s.battles.join(d, a)).toBe(false);
  });

  it('each fighter carries their own gear and stats (a gearless player fights with bare fists)', () => {
    const s = setup();
    const a = s.player('a'), b = s.player('b');
    [a, b].forEach(s.putIn);
    const sb = s.lab.state(b);
    sb.owned.push('weapon_kayu', 'shield_kayu');
    sb.gear = { weapon: 'weapon_kayu', shield: 'shield_kayu' };
    s.battles.encounter([a, b]);
    const fs = s.battles.view(a)!.fighters;
    const fa = fs.find((f) => f.id === `p${a.id}`)!, fb = fs.find((f) => f.id === `p${b.id}`)!;
    expect(fa.gear).toEqual({});
    expect(fb.gear).toEqual({ weapon: 'weapon_kayu', shield: 'shield_kayu' });
    expect(fb.atk).toBeGreaterThan(fa.atk);
    expect(fb.def).toBeGreaterThan(fa.def);
  });

  it('only lets you use a potion you have', () => {
    const s = setup();
    const a = s.player('a');
    s.putIn(a);
    s.battles.encounter([a]);
    expect(() => s.battles.act(a, { kind: 'item', item: 'sambal_semangat' })).toThrow(/no Sambal/);
    s.lab.state(a).potions.sambal_semangat = 1;
    expect(() => s.battles.act(a, { kind: 'item', item: 'tali_pulang' })).toThrow(/no Tali/);
    s.lab.state(a).potions.tali_pulang = 1;
    expect(() => s.battles.act(a, { kind: 'item', item: 'tali_pulang' })).toThrow(/doesn't work in a fight/);
    s.battles.act(a, { kind: 'item', item: 'sambal_semangat' }); // a party of one: the round plays at once
    expect(s.lab.state(a).potions.sambal_semangat).toBeUndefined();
  });

  it('💥 skills spend 🔷 mana (it carries over after the fight); switching element mid-fight changes skill and ultimate', () => {
    const s = setup();
    const a = s.player('a');
    s.putIn(a);
    s.battles.encounter([a]);
    const me = () => s.battles.view(a)!.fighters.find((f) => f.id === `p${a.id}`)!;
    expect(me()).toMatchObject({ element: 'api', spell: 'ult_api', mana: lc.player.mana.max });
    s.lab.setElement(a, 'tanah');
    s.battles.restyle(a);
    expect(me()).toMatchObject({ element: 'tanah', spell: 'ult_tanah' });
    // Out of mana: no skill.
    const live = (s.battles as unknown as { byPlayer: Map<number, { fighters: Array<{ id: string; mana?: number; hp: number; side: string }> }> }).byPlayer.get(a.id)!.fighters;
    live.find((f) => f.id === `p${a.id}`)!.mana = 2;
    expect(() => s.battles.act(a, { kind: 'skill' })).toThrow(/Not enough 🔷 mana/);
    live.find((f) => f.id === `p${a.id}`)!.mana = lc.player.mana.max;
    // Win with 🌪️ (it hits them all): the mana spent stays spent (+1 for the round).
    s.lab.setElement(a, 'angin');
    s.battles.restyle(a);
    for (const f of live) if (f.side === 'foe') f.hp = 1;
    s.battles.act(a, { kind: 'skill' });
    expect(s.battles.inFight(a)).toBe(false);
    const cost = lc.elements.find((e) => e.id === 'angin')!.skill.mana;
    expect(s.lab.mana(a)).toBe(lc.player.mana.max - cost + lc.player.mana.perRound);
  });
});

describe('Labirin floor bosses', () => {
  it('the boss guards the stairs: no running, and beating it opens them for good', () => {
    const s = setup();
    const a = s.player('a');
    const f = s.lab.floor(0);
    const L = roomLayout(lc, f, f.rooms[f.boss]);
    const stairs = { floor: 0, room: f.boss, x: (L.spot.feature[0] + 0.5) * lc.tile, y: (L.spot.feature[1] + 0.5) * lc.tile, dir: 'up' as const, moving: false, at: 0 };
    a.lab = { ...stairs };
    expect(() => s.lab.use(a, 'down')).toThrow(/guards the stairs/);
    expect(s.lab.bossHere(a)).toBe(true);
    expect(s.battles.encounter([a])).toBe(true);
    const v = s.battles.view(a)!;
    expect(v.boss).toBe(true);
    expect(v.fighters.find((x) => x.side === 'foe')!.name).toBe(lc.bosses[0].name);
    expect(() => s.battles.act(a, { kind: 'run' })).toThrow(/no running/);
    // Knock it down to 1 HP and finish it.
    const fighters = (s.battles as unknown as { byPlayer: Map<number, { fighters: Array<{ side: string; hp: number }> }> }).byPlayer.get(a.id)!.fighters;
    for (const x of fighters) if (x.side === 'foe') x.hp = 1;
    s.battles.act(a, { kind: 'attack' });
    expect(s.battles.inFight(a)).toBe(false);
    expect(s.lab.state(a).bosses).toEqual([0]);
    expect(s.lab.state(a).carried).toBeGreaterThanOrEqual(lc.bosses[0].coins);
    expect(s.lab.bossHere(a)).toBe(false);
    expect(s.lab.monstersHere(a)).toBe(false);
    a.lab = { ...stairs };
    expect(s.lab.use(a, 'down').view!.floor).toBe(1);
  });
});

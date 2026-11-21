import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
});

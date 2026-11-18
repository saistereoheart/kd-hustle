import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNpcRoutes, errandOffer, gridIndexAt, npcPose } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import type { OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { GameError } from '../economy/economy';
import { NpcSystem } from './npcs';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const T = cfg.map.tileSize;

function player(id = 1): OnlinePlayer {
  return { id, x: 0, y: 0, errand: null, prog: { stage: 1 } } as unknown as OnlinePlayer;
}
const standAt = (p: OnlinePlayer, x: number, y: number) => {
  p.x = x * T;
  p.y = y * T + 4;
};

describe('wandering NPCs', () => {
  it('everyone gets a walking loop, the same on every machine', () => {
    const a = buildNpcRoutes(cfg.map, cfg.npcs);
    const b = buildNpcRoutes(cfg.map, cfg.npcs);
    expect(a.length).toBe(cfg.npcs.people.length);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('only ever stands on walkable ground', () => {
    for (const r of buildNpcRoutes(cfg.map, cfg.npcs)) {
      for (let t = 0; t < r.cycleMs; t += 997) {
        const p = npcPose(r, cfg.npcs, t);
        expect(cfg.map.solid[gridIndexAt(cfg.map, p.x * T, p.y * T)], `${r.name} at ${t}`).toBe(0);
      }
    }
  });

  it('runs an errand: go to the place, back to the NPC, get paid', () => {
    let now = 5_000_000;
    const paid: number[] = [];
    const sys = new NpcSystem({ map: cfg.map, cfg: cfg.npcs, pay: (_p, sen) => paid.push(sen), stageOf: () => 1, now: () => now });
    const p = player(7);
    // Find an NPC with an errand for this player right now.
    const r = sys.routes.find((x) => errandOffer(cfg.npcs, x.id, p.id, now))!;
    expect(r).toBeTruthy();
    const pose = () => npcPose(r, cfg.npcs, now);
    // Too far away: no talking.
    standAt(p, pose().x + 20, pose().y);
    expect(() => sys.talk(p, r.id)).toThrow(GameError);
    standAt(p, pose().x, pose().y);
    const talk = sys.talk(p, r.id);
    expect(talk.offer?.rewardSen).toBe(cfg.npcs.rewardSenByStage[0]);
    const e = sys.accept(p, r.id);
    expect(e.stage).toBe('go');
    // Can't skip the trip.
    expect(() => sys.progress(p)).toThrow(GameError);
    standAt(p, e.place.x, e.place.y);
    expect(sys.progress(p).errand?.stage).toBe('return');
    now += 30_000; // they've wandered on: find them again
    standAt(p, pose().x, pose().y);
    const done = sys.progress(p);
    expect(done.errand).toBeNull();
    expect(paid).toEqual([cfg.npcs.rewardSenByStage[0]]);
    // The same NPC doesn't offer another errand in the same time slot.
    expect(sys.talk(p, r.id).offer).toBeUndefined();
  });

  it('errands expire', () => {
    let now = 9_000_000;
    const sys = new NpcSystem({ map: cfg.map, cfg: cfg.npcs, pay: () => {}, stageOf: () => 1, now: () => now });
    const p = player(3);
    const r = sys.routes.find((x) => errandOffer(cfg.npcs, x.id, p.id, now))!;
    const pose = npcPose(r, cfg.npcs, now);
    standAt(p, pose.x, pose.y);
    const e = sys.accept(p, r.id);
    now += cfg.npcs.errandExpiresMs + 1;
    standAt(p, e.place.x, e.place.y);
    expect(() => sys.progress(p)).toThrow(/gave up/);
    expect(p.errand).toBeNull();
  });
});

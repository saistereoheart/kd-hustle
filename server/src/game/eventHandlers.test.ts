import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/loadConfig';
import { ROOT } from '../paths';
import { createEvents } from './eventHandlers';
import { World } from './world';
import type { GameIO } from './gameServer';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));

describe('server events', () => {
  it('an event gives everyone its buffs until it ends, and opens its crate', () => {
    let now = 1_000_000;
    const sent: unknown[] = [];
    const io = { emit: (_e: string, p: unknown) => sent.push(p) } as unknown as GameIO;
    const said: string[] = [];
    const ev = createEvents({ cfg, io, world: new World(), rand: () => 0, announce: (t) => said.push(t), clock: () => now });
    try {
      expect(ev.buffs()).toEqual([]);
      expect(ev.crateOpen('durian_season')).toBe(false);
      expect(ev.crateOpen(undefined)).toBe(true); // normal crates are always open
      ev.start('lucky_hour', 10);
      expect(ev.buffs()).toEqual([expect.objectContaining({ kind: 'luck', mult: 2, item: 'event:Lucky Hour' })]);
      expect(said[0]).toMatch(/LUCKY HOUR/);
      ev.start('durian_season');
      expect(ev.crateOpen('durian_season')).toBe(true);
      now += 16 * 60_000;
      expect(ev.crateOpen('durian_season')).toBe(false);
      expect(ev.buffs()).toEqual([]);
      expect(() => ev.start('nope')).toThrow(/No event/);
    } finally {
      ev.dispose();
    }
  });

  it('the Durian Crate reuses items without changing what they are worth', () => {
    const durian = cfg.crateById.get('durian')!;
    expect(durian.event).toBe('durian_season');
    for (const id of durian.pool) expect(cfg.crateOfItem.get(id)?.id).not.toBe('durian');
  });
});

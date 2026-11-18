// Server events (spec §14): Lucky Hour, Rush Hour, the Pasar Malam Festival, Durian Season.
// An admin starts one with /event <id> [minutes]; otherwise every `randomEveryMin` minutes
// there's a chance a random one starts (only when people are online). While it runs, everyone
// gets its buffs (through progression's extraBuffs), and its limited crate can be rolled.
import type { ActiveBuff, ActiveEvent, EventDef } from '@kh/shared';
import type { ServerConfig } from '../config/loadConfig';
import { log } from '../log';
import type { RandInt } from '@kh/shared';
import type { GameIO } from './gameServer';
import type { World } from './world';

export function createEvents(d: { cfg: ServerConfig; io: GameIO; world: World; rand: RandInt; announce: (text: string, banner: boolean) => void; clock?: () => number }) {
  const clock = d.clock ?? Date.now;
  const ec = d.cfg.events;
  let active: { def: EventDef; endsAt: number } | null = null;
  let nextRandom = clock() + ec.randomEveryMin * 60_000;

  const view = (): ActiveEvent | null => (active ? { id: active.def.id, endsAt: active.endsAt } : null);
  const broadcast = () => d.io.emit('event', { event: view() });

  function start(id: string, minutes?: number): EventDef {
    const def = ec.events.find((e) => e.id === id);
    if (!def) throw new Error(`No event "${id}". Events: ${ec.events.map((e) => e.id).join(', ')}`);
    active = { def, endsAt: clock() + (minutes ?? def.minutes) * 60_000 };
    broadcast();
    d.announce(`${def.icon} ${def.name.toUpperCase()}! ${def.desc} (${Math.round(minutes ?? def.minutes)} min)`, true);
    log.info(`Event started: ${def.name}`);
    return def;
  }

  function stop() {
    if (!active) return;
    const def = active.def;
    active = null;
    broadcast();
    d.announce(`${def.icon} ${def.name} is over. See you next time!`, false);
  }

  const timer = setInterval(() => {
    const now = clock();
    if (active && now >= active.endsAt) stop();
    if (now >= nextRandom) {
      nextRandom = now + ec.randomEveryMin * 60_000;
      const online = [...d.world.players.values()].some((p) => p.hasCharacter);
      if (!active && online && d.rand(1000) < ec.randomChance * 1000) start(ec.events[d.rand(ec.events.length)].id);
    }
  }, 5000);

  return {
    view,
    start,
    stop,
    /** Everyone's buffs from the event running now. */
    buffs: (): ActiveBuff[] => {
      if (!active) return [];
      const left = active.endsAt - clock();
      return left > 0 ? active.def.buffs.map((b) => ({ item: `event:${active!.def.name}`, kind: b.kind, mult: b.mult, leftMs: left })) : [];
    },
    /** Event crates can only be rolled while their event runs. */
    crateOpen: (event: string | undefined) => !event || (!!active && active.def.id === event && clock() < active.endsAt),
    dispose: () => clearInterval(timer),
  };
}

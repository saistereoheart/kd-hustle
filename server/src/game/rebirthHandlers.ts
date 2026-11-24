// Rebirth (Phase 8, reworked 2026-11-19): start a new life at wealth stage 6. EVERYTHING resets
// except your XP and level: cash (back to the starting wallet), items, the Item Index, shards,
// skills, titles, job levels, homes, businesses, the stall, loans and the wealth stage. In return
// your cash income is multiplied by rebirth.cashMultPerRebirth per rebirth (×2, ×4, ×8...).
// After a rebirth the client reloads to pick up the fresh state.
import { emptyRebirth, formatMoney, rebirthCashMult, rebirthMods, type RebirthState, type RebirthView } from '@kh/shared';
import type { Socket } from 'socket.io';
import { z } from 'zod';
import type { ServerConfig } from '../config/loadConfig';
import type { Repos } from '../db/repos';
import { GameError } from '../systems/economy/economy';
import type { GameIO } from './gameServer';
import type { OnlinePlayer } from './world';

type Handle = <A, R>(socket: Socket, event: string, schema: { safeParse: (v: unknown) => { success: true; data: A } | { success: false } } | null, fn: (args: A) => R) => void;

export const rebirthSchemas = {
  confirm: z.object({ confirm: z.literal('REBIRTH') }),
};

export interface RebirthDeps {
  cfg: ServerConfig;
  repos: Repos;
  io: GameIO;
  socketOf: (p: OnlinePlayer) => Socket | undefined;
  /** Why you can't rebirth yet besides the stage (bids or listings out), or null. */
  blocker: (p: OnlinePlayer) => string | null;
  /** Wipe homes, businesses, the stall and loans (systems with their own state). */
  wipe: (p: OnlinePlayer) => void;
  /** Reset the player's own state (cash, items, skills, titles...) keeping XP, and reload it. */
  resetSelf: (p: OnlinePlayer, startSen: number) => void;
  announce: (text: string) => void;
}

export function createRebirth(d: RebirthDeps) {
  const rc = d.cfg.rebirth;
  const cache = new Map<number, RebirthState>();
  const of = (p: { id: number }): RebirthState => {
    let s = cache.get(p.id);
    if (!s) {
      const saved = d.repos.playerData.load<Partial<RebirthState>>(p.id, 'rebirth');
      s = { ...emptyRebirth(), count: saved?.count ?? 0 };
      cache.set(p.id, s);
    }
    return s;
  };
  const save = (p: OnlinePlayer) => d.repos.playerData.save(p.id, 'rebirth', of(p));
  /** Everyone's rebirth count by name, online or not (⭐ by names everywhere: chat, signs, lists). */
  let stars: Map<string, number> | null = null;
  const starMap = (): Map<string, number> => {
    if (stars) return stars;
    stars = new Map();
    for (const r of d.repos.playerData.all<Partial<RebirthState>>('rebirth')) {
      const name = d.repos.accounts.byId(r.id)?.username;
      if (name && (r.data.count ?? 0) > 0) stars.set(name, r.data.count!);
    }
    return stars;
  };

  function view(p: OnlinePlayer): RebirthView {
    const s = of(p);
    const reason = p.prog.stage < rc.minStage ? `Reach wealth stage ${rc.minStage} first.` : d.blocker(p);
    return { count: s.count, can: !reason, reason, minStage: rc.minStage, multNow: rebirthCashMult(rc, s.count), multNext: rebirthCashMult(rc, s.count + 1) };
  }
  const push = (p: OnlinePlayer) => d.socketOf(p)?.emit('rebirth:self', { view: view(p) });

  function rebirth(p: OnlinePlayer) {
    const v = view(p);
    if (!v.can) throw new GameError(v.reason!);
    const s = of(p);
    d.wipe(p); // stall, homes, businesses, loans
    s.count++;
    save(p);
    p.rebirths = s.count;
    const start = d.cfg.economy.startingWalletSen;
    d.resetSelf(p, start); // cash, items, Index, shards, skills, titles, jobs, stage → fresh; XP stays
    d.io.to(p.scene).emit('player:updated', { id: p.id, rebirths: s.count, title: null });
    starMap().set(p.name, s.count);
    d.io.emit('rebirth:stars', { name: p.name, count: s.count }); // every name label shows it
    const mult = rebirthCashMult(rc, s.count);
    d.announce(`⭐ ${p.name} was reborn! Rebirth #${s.count}: everything they earn now pays ×${mult}. A new life starts with ${formatMoney(start)}.`);
    return { count: s.count, mult };
  }

  function register(socket: Socket, me: OnlinePlayer, handle: Handle) {
    handle(socket, 'rebirth:view', null, () => ({ view: view(me) }));
    handle(socket, 'rebirth:do', rebirthSchemas.confirm, () => rebirth(me));
  }

  return {
    register,
    push,
    /** At login: the stars by the name. */
    load: (p: OnlinePlayer) => {
      p.rebirths = of(p).count;
    },
    unload: (p: OnlinePlayer) => cache.delete(p.id),
    /** For the init payload: name → rebirths, for everyone reborn at least once. */
    stars: (): Record<string, number> => Object.fromEntries(starMap()),
    mods: (p: { id: number }) => rebirthMods(rc, of(p)),
    /** Offline income cap and rate. */
    offlineFor: (_p: OnlinePlayer) => d.cfg.economy.offline,
  };
}

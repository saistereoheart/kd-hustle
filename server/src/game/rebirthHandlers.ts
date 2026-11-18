// Rebirth (Phase 8, spec §13): start a new life at wealth stage 6 for Rebirth Tokens.
// Resets cash, homes, businesses (and the shop), the stall and loans, and drops you back to
// wealth stage 1. Keeps your items (cosmetics, furniture...), the Item Index, titles, level,
// skills and Rebirth Shop perks. Tokens buy permanent perks (luck, income, starting cash, a
// longer and better offline income).
import { perkCost, perkValue, rebirthMods, rebirthTokens, emptyRebirth, formatMoney, REBIRTH_PERKS, type RebirthPerk, type RebirthState } from '@kh/shared';
import type { Socket } from 'socket.io';
import { z } from 'zod';
import type { ServerConfig } from '../config/loadConfig';
import type { Repos } from '../db/repos';
import { GameError, type Economy } from '../systems/economy/economy';
import type { GameIO } from './gameServer';
import type { OnlinePlayer } from './world';

type Handle = <A, R>(socket: Socket, event: string, schema: { safeParse: (v: unknown) => { success: true; data: A } | { success: false } } | null, fn: (args: A) => R) => void;

export const rebirthSchemas = {
  confirm: z.object({ confirm: z.literal('REBIRTH') }),
  perk: z.object({ perk: z.enum(REBIRTH_PERKS) }),
};

export interface RebirthDeps {
  cfg: ServerConfig;
  repos: Repos;
  econ: Economy;
  io: GameIO;
  socketOf: (p: OnlinePlayer) => Socket | undefined;
  pushWallet: (p: OnlinePlayer, delta?: number, reason?: string) => void;
  netWorth: (p: OnlinePlayer) => number;
  /** Money held in Pasar Online bids (can't rebirth with bids out). */
  heldBids: (p: OnlinePlayer) => number;
  /** Wipe the assets that reset. */
  wipe: (p: OnlinePlayer) => void;
  announce: (text: string) => void;
  check: (p: OnlinePlayer) => void;
  progress: (p: OnlinePlayer) => void;
}

export function createRebirth(d: RebirthDeps) {
  const rc = d.cfg.rebirth;
  const cache = new Map<number, RebirthState>();
  const of = (p: { id: number }): RebirthState => {
    let s = cache.get(p.id);
    if (!s) {
      s = { ...emptyRebirth(), ...(d.repos.playerData.load<Partial<RebirthState>>(p.id, 'rebirth') ?? {}) };
      cache.set(p.id, s);
    }
    return s;
  };
  const save = (p: OnlinePlayer) => d.repos.playerData.save(p.id, 'rebirth', of(p));

  function view(p: OnlinePlayer) {
    const s = of(p);
    const reason = p.prog.stage < rc.minStage ? `Reach wealth stage ${rc.minStage} first.` : d.heldBids(p) ? 'Settle your Pasar Online bids first.' : null;
    return { count: s.count, tokens: s.tokens, shop: s.shop, can: !reason, reason, tokensNow: rebirthTokens(rc, d.netWorth(p)), minStage: rc.minStage };
  }
  const push = (p: OnlinePlayer) => d.socketOf(p)?.emit('rebirth:self', { view: view(p) });

  function rebirth(p: OnlinePlayer) {
    const v = view(p);
    if (!v.can) throw new GameError(v.reason!);
    const s = of(p);
    const tokens = v.tokensNow;
    d.wipe(p); // stall, homes, businesses, loans
    // A fresh wallet: the starting cash plus Trust Fund.
    const start = d.cfg.economy.startingWalletSen + perkValue(rc, s, 'startCash');
    d.econ.run(p, () => d.econ.change(p, start - p.walletSen, 0, 'rebirth', `#${s.count + 1}`));
    p.prog.stage = 1;
    p.prog.stats.rebirths = (p.prog.stats.rebirths ?? 0) + 1;
    s.count++;
    s.tokens += tokens;
    p.rebirths = s.count;
    save(p);
    d.pushWallet(p, 0, 'rebirth');
    d.io.to(p.scene).emit('player:updated', { id: p.id, rebirths: s.count });
    d.announce(`⭐ ${p.name} was reborn! Rebirth #${s.count}, +${tokens} Rebirth Tokens. A new life starts with ${formatMoney(start)}.`);
    d.progress(p);
    d.check(p);
    push(p);
    return { tokens };
  }

  function buy(p: OnlinePlayer, perk: RebirthPerk) {
    const s = of(p);
    const def = rc.shop.find((x) => x.id === perk);
    if (!def) throw new GameError('No such perk.');
    const lv = s.shop[perk] ?? 0;
    if (lv >= def.maxLevel) throw new GameError('Maxed.');
    const cost = perkCost(rc, perk, lv);
    if (s.tokens < cost) throw new GameError(`That needs ${cost} Rebirth Tokens.`);
    s.tokens -= cost;
    s.shop[perk] = lv + 1;
    save(p);
    push(p);
    d.progress(p); // luck / income changed
  }

  function register(socket: Socket, me: OnlinePlayer, handle: Handle) {
    handle(socket, 'rebirth:view', null, () => ({ view: view(me) }));
    handle(socket, 'rebirth:do', rebirthSchemas.confirm, () => rebirth(me));
    handle(socket, 'rebirth:buy', rebirthSchemas.perk, ({ perk }) => (buy(me, perk), {}));
  }

  return {
    register,
    push,
    /** At login: the stars by your name. */
    load: (p: OnlinePlayer) => {
      p.rebirths = of(p).count;
    },
    unload: (p: OnlinePlayer) => cache.delete(p.id),
    mods: (p: { id: number }) => rebirthMods(rc, of(p)),
    /** Offline income cap and rate with Night Owl and Autopilot. */
    offlineFor: (p: OnlinePlayer) => {
      const base = d.cfg.economy.offline;
      const s = of(p);
      return { capHours: base.capHours + perkValue(rc, s, 'offlineCap'), efficiency: Math.min(1, base.efficiency + perkValue(rc, s, 'offlineEff')) };
    },
  };
}

// Phase 7 socket handlers: the players list, trading, gifting and leaderboards.
// Leaderboards cover everyone who has played: online players live, offline ones from the last
// snapshot saved when they were online (kept in player_data 'board').
import { C2S, isCollectible, LEADERBOARDS, netWorthSen, type BoardEntry, type BoardId, type InventoryItem } from '@kh/shared';
import type { Socket } from 'socket.io';
import type { ServerConfig } from '../config/loadConfig';
import type { Repos } from '../db/repos';
import type { Economy } from '../systems/economy/economy';
import { TradeSystem } from '../systems/trade/trade';
import { CoinflipSystem } from '../systems/coinflip/coinflip';
import { MarketSystem } from '../systems/market/market';
import { cryptoRand } from '../systems/gacha/gacha';
import type { GameIO } from './gameServer';
import type { OnlinePlayer, World } from './world';

type Handle = <A, R>(socket: Socket, event: string, schema: { safeParse: (v: unknown) => { success: true; data: A } | { success: false } } | null, fn: (args: A) => R) => void;

export interface SocialDeps {
  cfg: ServerConfig;
  repos: Repos;
  econ: Economy;
  world: World;
  io: GameIO;
  socketOf: (p: OnlinePlayer) => Socket | undefined;
  pushWallet: (p: OnlinePlayer, delta?: number, reason?: string) => void;
  lockedIids: (p: OnlinePlayer) => Set<number>;
  /** Homes, stalls, businesses minus debts (for net worth). */
  assetsOf: (p: OnlinePlayer) => number;
  /** Best Airbnb rating among your homes (0 if none). */
  bestAirbnb: (p: OnlinePlayer) => number;
  cosmeticsChanged: (p: OnlinePlayer) => void;
  check: (p: OnlinePlayer) => void;
  announce: (text: string) => void;
}

interface Stored {
  name: string;
  scores: Record<BoardId, number>;
  notes?: Partial<Record<BoardId, string>>;
}

export function createSocial(d: SocialDeps) {
  const trade = new TradeSystem(d.econ, d.world, {
    view: (p, v, done, reason) => d.socketOf(p)?.emit('trade', { trade: v, done, reason }),
    request: (to, from) => d.socketOf(to)?.emit('trade:request', { from: from.id, name: from.name }),
    notice: (p, text, kind) => d.socketOf(p)?.emit('notice', { text, kind }),
    wallet: (p, delta, reason) => d.pushWallet(p, delta, reason),
    items: (p, items: InventoryItem[]) => items.length && d.socketOf(p)?.emit('inv:added', { items, index: [...p.index] }),
    removed: (p, iids) => iids.length && d.socketOf(p)?.emit('inv:removed', { iids }),
    lockedIids: (p) => d.lockedIids(p),
    cosmeticsChanged: (p) => d.cosmeticsChanged(p),
    check: (p) => d.check(p),
  });

  const coinflip = new CoinflipSystem(d.cfg.casino, d.econ, d.world, cryptoRand, {
    challenge: (to, from, sen) => d.socketOf(to)?.emit('coinflip:challenge', { from: from.id, name: from.name, sen }),
    result: (p, r) => d.socketOf(p)?.emit('coinflip:result', r),
    notice: (p, text, kind) => d.socketOf(p)?.emit('notice', { text, kind }),
    wallet: (p, delta, reason) => d.pushWallet(p, delta, reason),
    announce: (t) => d.announce(t),
    check: (p) => d.check(p),
  });

  const market: MarketSystem = new MarketSystem(d.cfg, d.repos, d.econ, d.world, {
    wallet: (p, delta, reason) => d.pushWallet(p, delta, reason),
    items: (p, items) => items.length && d.socketOf(p)?.emit('inv:added', { items, index: [...p.index] }),
    changed: () => d.io.emit('market', { listings: market.all() }),
    notice: (p, text, kind) => d.socketOf(p)?.emit('notice', { text, kind }),
    lockedIids: (p) => d.lockedIids(p),
    check: (p) => d.check(p),
  });
  const marketTimer = setInterval(() => market.tick(), 2000);

  const tiers = d.cfg.rarities.tiers;
  const collectibles = d.cfg.items.items.filter(isCollectible).length;

  /** A player's numbers right now. */
  function entryOf(p: OnlinePlayer): Stored {
    let best = -1;
    for (const id of p.index) best = Math.max(best, tiers.findIndex((t) => t.id === d.cfg.itemById.get(id)?.rarity));
    const st = p.prog.stats;
    return {
      name: p.name,
      scores: {
        netWorth: netWorthSen(d.cfg.prog, p.walletSen, p.inventory, d.assetsOf(p)),
        rarest: best,
        collection: collectibles ? Math.round((p.index.size / collectibles) * 1000) / 10 : 0,
        airbnb: Math.round(d.bestAirbnb(p) * 10) / 10,
        cooking: st.perfectDishes ?? 0,
        casinoWin: st.biggestCasinoWin ?? 0,
        casinoLoss: st.biggestCasinoLoss ?? 0,
        level: p.prog.level,
      },
      notes: { rarest: best >= 0 ? tiers[best].name : '—' },
    };
  }

  function snapshot(p: OnlinePlayer) {
    if (p.hasCharacter && p.prog) d.repos.playerData.save(p.id, 'board', entryOf(p));
  }

  /** Everyone: live for online players, the last snapshot for the rest. */
  function boards(): BoardEntry[] {
    const out = new Map<number, BoardEntry>();
    for (const r of d.repos.playerData.all<Stored>('board')) if (r.data?.scores) out.set(r.id, { player: r.id, name: r.data.name, online: false, scores: r.data.scores, notes: r.data.notes });
    for (const p of d.world.players.values()) {
      if (!p.hasCharacter || !p.prog) continue;
      const e = entryOf(p);
      out.set(p.id, { player: p.id, name: e.name, online: true, scores: e.scores, notes: e.notes });
    }
    return [...out.values()];
  }

  // Keep offline snapshots fresh (also catches a crash).
  const timer = setInterval(() => {
    for (const p of d.world.players.values()) snapshot(p);
  }, 60_000);

  function register(socket: Socket, me: OnlinePlayer, handle: Handle) {
    handle(socket, 'players:list', null, () => ({
      players: [...d.world.players.values()].filter((p) => p.hasCharacter && p.id !== me.id).map((p) => ({ id: p.id, name: p.name, level: p.prog.level, title: p.prog.title })),
    }));
    handle(socket, 'trade:request', C2S.playerId, ({ to }) => (trade.request(me, to), {}));
    handle(socket, 'trade:respond', C2S.tradeRespond, ({ from, accept }) => (trade.respond(me, from, accept), {}));
    handle(socket, 'trade:offer', C2S.tradeOffer, ({ items, sen }) => (trade.offer(me, items, sen), {}));
    handle(socket, 'trade:lock', null, () => (trade.lock(me), {}));
    handle(socket, 'trade:confirm', null, () => (trade.confirm(me), {}));
    handle(socket, 'trade:cancel', null, () => (trade.cancel(me), {}));
    handle(socket, 'gift:send', C2S.gift, ({ to, sen, items }) => (trade.gift(me, to, sen, items), {}));
    handle(socket, 'board:view', null, () => ({ entries: boards() }));
    handle(socket, 'market:view', null, () => ({ listings: market.all() }));
    handle(socket, 'market:list', C2S.marketList, ({ iid, kind, priceSen, hours }) => ({ removed: market.list(me, iid, kind, priceSen, hours).removed }));
    handle(socket, 'market:cancel', C2S.marketId, ({ id }) => (market.cancel(me, id), {}));
    handle(socket, 'market:buy', C2S.marketId, ({ id }) => (market.buy(me, id), {}));
    handle(socket, 'market:bid', C2S.marketBid, ({ id, sen }) => (market.bid(me, id, sen), {}));
    handle(socket, 'market:history', C2S.marketHistory, ({ itemId }) => market.history(itemId));
    handle(socket, 'coinflip:challenge', C2S.coinflip, ({ to, sen }) => (coinflip.challenge(me, to, sen), {}));
    handle(socket, 'coinflip:respond', C2S.tradeRespond, ({ from, accept }) => (coinflip.respond(me, from, accept), {}));
  }

  return {
    trade,
    register,
    snapshot,
    leave: (p: OnlinePlayer) => {
      trade.leave(p);
      coinflip.leave(p);
      snapshot(p);
    },
    market,
    stop: () => {
      clearInterval(timer);
      clearInterval(marketTimer);
    },
    boardIds: LEADERBOARDS.map((b) => b.id),
  };
}

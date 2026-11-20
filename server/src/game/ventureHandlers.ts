// Phase 6 socket handlers: idle businesses, the retail shop and its checkout mini-game.
// (Loans are in loanHandlers.ts.) The systems do the transactional work; this wires them to
// sockets, the 1-second tick, saving and the welcome-back screen.
import { C2S } from '@kh/shared';
import type { Socket } from 'socket.io';
import type { ServerConfig } from '../config/loadConfig';
import type { Repos } from '../db/repos';
import { log } from '../log';
import { BusinessSystem } from '../systems/business/business';
import type { ShoplotSystem } from '../systems/shoplots/shoplots';
import { GameError } from '../systems/economy/economy';
import { BoutiqueSystem } from '../systems/boutique/boutique';
import { formatMoney, netWorthSen, type InventoryItem } from '@kh/shared';
import type { GameIO } from './gameServer';
import type { Economy } from '../systems/economy/economy';
import { cryptoRand } from '../systems/gacha/gacha';
import type { OnlinePlayer, World } from './world';

type Handle = <A, R>(socket: Socket, event: string, schema: { safeParse: (v: unknown) => { success: true; data: A } | { success: false } } | null, fn: (args: A) => R) => void;

export interface VentureDeps {
  cfg: ServerConfig;
  repos: Repos;
  econ: Economy;
  world: World;
  socketOf: (p: OnlinePlayer) => Socket | undefined;
  pushWallet: (p: OnlinePlayer, delta?: number, reason?: string) => void;
  /** Passive income multiplier (skills, gear; less while you owe the Ah Long). */
  incomeMult: (p: OnlinePlayer) => number;
  /** Something changed that may unlock titles / goals. */
  check: (p: OnlinePlayer) => void;
  io: GameIO;
  /** Furniture placed in homes (can't be listed). */
  lockedIids: (p: OnlinePlayer) => Set<number>;
  /** 🏪 Who holds which shoplot. */
  shoplots: ShoplotSystem;
}

export function createVentures(d: VentureDeps) {
  const biz = new BusinessSystem(d.cfg, d.repos, d.econ, cryptoRand, {
    wallet: (p, delta, reason) => d.pushWallet(p, delta, reason),
    changed: (p) => d.socketOf(p)?.emit('ventures:self', { ventures: biz.of(p) }),
    incomeMult: (p) => d.incomeMult(p),
    gone: (p, types) => {
      for (const t of types) d.shoplots.release(p.id, 'venture', t);
      broadcastShoplots();
    },
  });
  const T = d.cfg.map.tileSize;
  const broadcastShoplots = () => d.io.emit('shoplots', { shoplots: d.shoplots.public() });
  /** Every Venture you own has a shoplot (ones bought before shoplots existed get the free one nearest
   *  the town square). */
  function placeAll(p: OnlinePlayer) {
    let changed = false;
    for (const [type, b] of Object.entries(biz.of(p).businesses)) {
      if (b.level <= 0 || d.shoplots.of(p.id, 'venture', type)) continue;
      try {
        d.shoplots.claim(p.id, p.name, 'venture', type, { x: d.cfg.map.spawnPx.x / T, y: d.cfg.map.spawnPx.y / T });
        changed = true;
      } catch {
        /* the town is full: it stays phone-only */
      }
    }
    if (changed) broadcastShoplots();
  }

  const boutique = new BoutiqueSystem(d.cfg, d.repos, d.econ, d.world, {
    wallet: (p, delta, reason) => d.pushWallet(p, delta, reason),
    items: (p, items: InventoryItem[]) => d.socketOf(p)?.emit('inv:added', { items, index: [...p.index] }),
    removed: () => {},
    listingsChanged: () => d.io.emit('boutique', { listings: boutique.all() }),
    selfChanged: (p) => d.socketOf(p)?.emit('boutique:self', { boutique: boutique.selfOf(p.id) }),
    event: (p, text) => d.socketOf(p)?.emit('loan:event', { text, kind: 'good' }),
    lockedIids: (p) => d.lockedIids(p),
    check: (p) => d.check(p),
  });

  // Managers pay out and cashiers sell, every second, for online players.
  const timer = setInterval(() => {
    for (const p of d.world.players.values()) {
      if (!p.hasCharacter || !p.prog) continue;
      try {
        biz.tick(p);
      } catch (err) {
        log.error('business tick failed', err);
      }
    }
  }, 1000);
  // Live numbers (stored cycles, stock) for the phone app every few seconds.
  const pushTimer = setInterval(() => {
    for (const p of d.world.players.values()) {
      const v = p.hasCharacter && p.prog ? biz.of(p) : null;
      if (v && (Object.keys(v.businesses).length || v.retail)) d.socketOf(p)?.emit('ventures:self', { ventures: v });
    }
  }, 3000);

  /** Boutique sales made while you were away: paid now, one line per item sold. */
  function boutiqueLines(p: OnlinePlayer) {
    const r = boutique.collect(p);
    if (!r.sen) return [];
    const fee = d.cfg.businesses.boutique.feeRate;
    return r.sales.map((s) => ({
      label: `👜 Sold: ${d.cfg.itemById.get(s.itemId)?.name ?? s.itemId}`,
      sen: Math.floor(s.priceSen * (1 - fee)),
      detail: `to ${s.buyer} for ${formatMoney(s.priceSen)} (−${Math.round(fee * 100)}% fee)`,
    }));
  }

  function register(socket: Socket, me: OnlinePlayer, handle: Handle) {
    const after = <T>(r: T) => {
      d.check(me);
      return r;
    };
    placeAll(me);
    handle(socket, 'biz:buy', C2S.bizBuy, ({ type, n }) => {
      // Buying a new business takes the free shoplot nearest to you (move it later from the phone).
      const isNew = (biz.of(me).businesses[type]?.level ?? 0) <= 0;
      let spot: string | null = null;
      if (isNew) spot = d.shoplots.claim(me.id, me.name, 'venture', type, { x: me.x / T, y: me.y / T });
      try {
        const r = biz.buyLevels(me, type, n);
        if (isNew) broadcastShoplots();
        return after({ ...r, ...(spot ? { building: spot } : {}) });
      } catch (e) {
        if (isNew) d.shoplots.release(me.id, 'venture', type);
        throw e;
      }
    });
    handle(socket, 'biz:move', C2S.bizMove, ({ type, building }) => {
      if ((biz.of(me).businesses[type]?.level ?? 0) <= 0) throw new GameError('Buy the business first.');
      const fee = d.cfg.businesses.moveFeeSen;
      if (me.walletSen < fee) throw new GameError('Not enough money to move.');
      const b = d.shoplots.move(me.id, 'venture', type, building);
      if (fee) {
        d.econ.run(me, () => d.econ.change(me, -fee, 0, 'business-move', `${type}>${b}`));
        d.pushWallet(me, -fee, 'business');
      }
      broadcastShoplots();
      return { building: b, feeSen: fee };
    });
    handle(socket, 'biz:manager', C2S.bizType, ({ type }) => after((biz.hireManager(me, type), {})));
    handle(socket, 'biz:collect', C2S.bizCollect, ({ type }) => biz.collect(me, type));
    handle(socket, 'biz:rush', C2S.bizRush, ({ type, taps }) => biz.rush(me, type, taps));
    handle(socket, 'shop:open', null, () => after((biz.openShop(me), {})));
    handle(socket, 'shop:stock', C2S.shopStock, ({ product, qty }) => (biz.buyStock(me, product, qty), {}));
    handle(socket, 'shop:price', C2S.shopPrice, ({ product, priceSen }) => (biz.setPrice(me, product, priceSen), {}));
    handle(socket, 'shop:cashier', C2S.shopCashier, ({ on }) => (biz.setCashier(me, on), {}));
    handle(socket, 'checkout:start', null, () => ({ checkout: biz.checkoutStart(me) }));
    handle(socket, 'boutique:open', null, () => (boutique.open(me), {}));
    handle(socket, 'boutique:list', C2S.boutiqueList, ({ iid, priceSen }) => boutique.list(me, iid, priceSen));
    handle(socket, 'boutique:cancel', C2S.boutiqueId, ({ id }) => boutique.cancel(me, id));
    handle(socket, 'boutique:buy', C2S.boutiqueId, ({ id }) => boutique.buy(me, id));
    handle(socket, 'checkout:finish', C2S.checkoutFinish, ({ id, changeSen }) => after(biz.checkoutFinish(me, id, changeSen)));
  }

  return {
    biz,
    register,
    /** Items on your Butik shelf (rebirth needs an empty shelf). */
    shelfCount: (p: OnlinePlayer) => boutique.listedOf(p).length,
    /** Send the state after login. */
    sendSelf: (p: OnlinePlayer) => {
      d.socketOf(p)?.emit('ventures:self', { ventures: biz.of(p) });
      d.socketOf(p)?.emit('boutique', { listings: boutique.all() });
      d.socketOf(p)?.emit('boutique:self', { boutique: boutique.selfOf(p.id) });
    },
    /** Offline catch-up (managed businesses), for the welcome-back screen. */
    offline: (p: OnlinePlayer, awayMs: number, o: { capHours: number; efficiency: number } = d.cfg.economy.offline) => {
      const paid = biz.offline(p, awayMs, o.capHours, o.efficiency);
      const lines = d.cfg.businesses.types.filter((t) => paid[t.id]).map((t) => ({ label: `${t.icon} ${t.name}`, sen: paid[t.id], detail: `Lv ${biz.of(p).businesses[t.id]?.level ?? 0} · managed` }));
      return [...lines, ...boutiqueLines(p)];
    },
    /** Businesses, plus items on display in your boutique (still yours) and unpaid sales. */
    assetsOf: (p: OnlinePlayer) =>
      biz.assetsOf(p) + netWorthSen(d.cfg.prog, 0, boutique.listedOf(p)) + boutique.selfOf(p.id).pendingSen,
    save: (p: OnlinePlayer) => biz.save(p),
    unload: (p: OnlinePlayer) => biz.unload(p),
    stop: () => {
      clearInterval(timer);
      clearInterval(pushTimer);
    },
  };
}

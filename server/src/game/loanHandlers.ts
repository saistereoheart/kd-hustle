// Phase 6 socket handlers: Bank Kota and the Ah Long (see systems/loans). Wires the loan system
// to sockets, the 1-second loan clock, collateral (homes and businesses) and saving.
import { C2S } from '@kh/shared';
import type { Socket } from 'socket.io';
import type { ServerConfig } from '../config/loadConfig';
import type { Repos } from '../db/repos';
import { log } from '../log';
import type { BusinessSystem } from '../systems/business/business';
import type { Economy } from '../systems/economy/economy';
import { LoanSystem } from '../systems/loans/loans';
import type { PropertySystem } from '../systems/property/property';
import type { GameIO } from './gameServer';
import type { OnlinePlayer, World } from './world';

type Handle = <A, R>(socket: Socket, event: string, schema: { safeParse: (v: unknown) => { success: true; data: A } | { success: false } } | null, fn: (args: A) => R) => void;

export interface LoanDeps {
  cfg: ServerConfig;
  repos: Repos;
  econ: Economy;
  world: World;
  io: GameIO;
  socketOf: (p: OnlinePlayer) => Socket | undefined;
  pushWallet: (p: OnlinePlayer, delta?: number, reason?: string) => void;
  netWorth: (p: OnlinePlayer) => number;
  props: () => PropertySystem;
  biz: () => BusinessSystem;
  check: (p: OnlinePlayer) => void;
}

export function createLoans(d: LoanDeps) {
  const auction = d.cfg.loans.bank.auctionRate;
  const loans: LoanSystem = new LoanSystem(d.cfg, d.repos, d.econ, {
    wallet: (p, delta, reason) => d.pushWallet(p, delta, reason),
    changed: (p) => d.socketOf(p)?.emit('bank:self', { bank: loans.view(p) }),
    event: (p, text, kind) => d.socketOf(p)?.emit('loan:event', { text, kind }),
    publicFlag: (p) => d.io.to(p.scene).emit('player:updated', { id: p.id, owesAhLong: !!p.owesAhLong }),
    netWorth: (p) => d.netWorth(p),
    check: (p) => d.check(p),
    property: {
      value: (p, unit) => d.props().valueOf(p, unit),
      repossess: (p, unit) => Math.round(d.props().repossess(p, unit) * auction),
      list: (p) =>
        d.props().ownedBy(p).map((s) => ({
          id: s.unit,
          name: `${d.cfg.properties.types[s.type]?.icon ?? '🏠'} ${d.cfg.properties.types[s.type]?.name ?? s.type}`,
          valueSen: d.props().valueOf(p, s.unit) ?? 0,
        })),
    },
    business: {
      value: (p, type) => d.biz().valueOf(p, type),
      repossess: (p, type) => Math.round(d.biz().repossess(p, type) * auction),
      list: (p) => d.biz().owned(p),
    },
  });

  // The loan clock: play time only (a loan day = an in-game day of being online).
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(5000, now - last);
    last = now;
    for (const p of d.world.players.values()) {
      if (!p.hasCharacter || !p.prog) continue;
      try {
        loans.tick(p, dt);
      } catch (err) {
        log.error('loan tick failed', err);
      }
    }
  }, 1000);

  function register(socket: Socket, me: OnlinePlayer, handle: Handle) {
    handle(socket, 'bank:view', null, () => ({ bank: loans.view(me) }));
    handle(socket, 'loan:take', C2S.loanTake, ({ kind, amountSen, collateral }) => {
      const r = loans.take(me, kind, amountSen, collateral);
      d.check(me);
      return r;
    });
    handle(socket, 'loan:repay', C2S.loanRepay, ({ id, amountSen }) => loans.repay(me, id, amountSen));
  }

  return {
    loans,
    register,
    sendSelf: (p: OnlinePlayer) => d.socketOf(p)?.emit('bank:self', { bank: loans.view(p) }),
    /** Pledged as collateral (can't be sold). */
    isPledged: (p: OnlinePlayer, kind: 'property' | 'business', id: string) => loans.of(p).loans.some((l) => l.collateral === `${kind}:${id}`),
    owedOf: (p: OnlinePlayer) => loans.owedOf(p),
    incomeMult: (p: OnlinePlayer) => loans.incomeMult(p),
    save: (p: OnlinePlayer) => loans.save(p),
    unload: (p: OnlinePlayer) => loans.unload(p),
    stop: () => clearInterval(timer),
  };
}

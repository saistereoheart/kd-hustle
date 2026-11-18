// Phase 7 socket handlers: the Lucky Strand Casino (see systems/casino). Games are played inside
// the casino (you must be in the building); the daily free spin works anywhere. Shared tables
// broadcast to a socket.io room per game, joined while the player has that table open.
import { C2S } from '@kh/shared';
import type { Socket } from 'socket.io';
import type { ServerConfig } from '../config/loadConfig';
import type { Repos } from '../db/repos';
import { log } from '../log';
import { CasinoSystem } from '../systems/casino/casino';
import { GameError, type Economy } from '../systems/economy/economy';
import { cryptoRand } from '../systems/gacha/gacha';
import type { GameIO } from './gameServer';
import type { OnlinePlayer, World } from './world';

type Handle = <A, R>(socket: Socket, event: string, schema: { safeParse: (v: unknown) => { success: true; data: A } | { success: false } } | null, fn: (args: A) => R) => void;

export interface CasinoDeps {
  cfg: ServerConfig;
  repos: Repos;
  econ: Economy;
  world: World;
  io: GameIO;
  socketOf: (p: OnlinePlayer) => Socket | undefined;
  pushWallet: (p: OnlinePlayer, delta?: number, reason?: string) => void;
  announce: (text: string) => void;
  check: (p: OnlinePlayer) => void;
}

/** The casino building (where the games' stations are). */
function casinoBuilding(cfg: ServerConfig): string | null {
  return cfg.map.interactables.find((i) => i.type === 'casino')?.building ?? null;
}

export function createCasino(d: CasinoDeps) {
  const building = casinoBuilding(d.cfg);
  const casino = new CasinoSystem(d.cfg, d.repos, d.econ, d.world, cryptoRand, {
    wallet: (p, delta, reason) => d.pushWallet(p, delta, reason),
    table: (game, view) => d.io.to(`casino:${game}`).emit('casino:table', { game, view } as never),
    announce: (text) => d.announce(text),
    event: (p, text, kind) => d.socketOf(p)?.emit('loan:event', { text, kind }),
    items: (p, items) => d.socketOf(p)?.emit('inv:added', { items, index: [...p.index] }),
    session: (p, session) => d.socketOf(p)?.emit('casino:session', { session }),
    check: (p) => d.check(p),
  });
  const timer = setInterval(() => {
    try {
      casino.tick();
    } catch (err) {
      log.error('casino tick failed', err);
    }
  }, 250);

  const viewOf = (game: 'roulette' | 'blackjack' | 'crash' | 'wheel') =>
    game === 'roulette' ? casino.rouletteView() : game === 'blackjack' ? casino.bjView() : game === 'crash' ? casino.crashView() : casino.wheelView();

  function register(socket: Socket, me: OnlinePlayer, handle: Handle) {
    /** Games are played inside the casino. */
    const inside = () => {
      if (building && me.interior !== building) throw new GameError('Go inside the Lucky Strand Casino to play.');
    };
    const play = <A, R>(event: string, schema: Parameters<Handle>[2], fn: (a: A) => R) =>
      handle(socket, event, schema as never, (a: A) => {
        inside();
        return fn(a);
      });
    handle(socket, 'casino:watch', C2S.casinoGame, ({ game }) => {
      void socket.join(`casino:${game}`);
      return { view: viewOf(game), session: casino.session(me) };
    });
    handle(socket, 'casino:unwatch', C2S.casinoGame, ({ game }) => {
      void socket.leave(`casino:${game}`);
      return {};
    });
    handle(socket, 'casino:session', null, () => ({ session: casino.session(me), canSpin: casino.canSpin(me), highlow: casino.hlState(me) }));
    play('casino:slots', C2S.casinoSen, ({ sen }: { sen: number }) => casino.slots(me, sen));
    play('casino:hl:start', C2S.casinoSen, ({ sen }: { sen: number }) => casino.hlStart(me, sen));
    play('casino:hl:guess', C2S.hlGuess, ({ guess }: { guess: 'higher' | 'lower' }) => casino.hlGuess(me, guess));
    handle(socket, 'casino:hl:cashout', null, () => casino.hlCashout(me));
    play('casino:roulette:bet', C2S.rouletteBet, ({ bet, sen }: { bet: string; sen: number }) => casino.rouletteBet(me, bet, sen));
    play('casino:wheel:bet', C2S.wheelBet, ({ segment, sen }: { segment: string; sen: number }) => casino.wheelBet(me, segment, sen));
    play('casino:crash:bet', C2S.crashBet, ({ sen, auto }: { sen: number; auto: number | null }) => casino.crashBet(me, sen, auto));
    handle(socket, 'casino:crash:cashout', null, () => casino.crashCashout(me));
    play('casino:bj:sit', C2S.bjSeat, ({ seat }: { seat: number }) => casino.bjSit(me, seat));
    handle(socket, 'casino:bj:leave', null, () => casino.bjLeave(me));
    play('casino:bj:bet', C2S.casinoSen, ({ sen }: { sen: number }) => casino.bjBet(me, sen));
    handle(socket, 'casino:bj:act', C2S.bjAction, ({ action }) => casino.bjAction(me, action));
    handle(socket, 'casino:spin', null, () => casino.dailySpin(me));
  }

  return {
    casino,
    register,
    /** Winnings from tables you'd left, paid at login. */
    collect: (p: OnlinePlayer) => casino.collect(p),
    leave: (p: OnlinePlayer) => casino.leave(p),
    stop: () => {
      clearInterval(timer);
      casino.refundOpenBets();
    },
  };
}

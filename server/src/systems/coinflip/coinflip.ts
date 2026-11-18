// PvP coinflip (spec §7.6 / §14): challenge another player for a stake; if they accept, both
// stakes are taken, the server flips a coin, and the winner takes the pot minus a 2% house fee.
// Everything happens in one transaction for both players. Challenges expire after 60 s.
import { betLimits, formatMoney, type CasinoConfig, type RandInt } from '@kh/shared';
import type { OnlinePlayer, World } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

export interface CoinflipHooks {
  challenge: (to: OnlinePlayer, from: OnlinePlayer, sen: number) => void;
  result: (p: OnlinePlayer, r: { a: string; b: string; winner: string; side: 'heads' | 'tails'; sen: number; wonSen: number }) => void;
  notice: (p: OnlinePlayer, text: string, kind: 'good' | 'bad' | 'info') => void;
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  announce: (text: string) => void;
  check: (p: OnlinePlayer) => void;
}

export const COINFLIP_FEE = 0.02;

export class CoinflipSystem {
  /** to → from → { sen, at } */
  private pending = new Map<number, Map<number, { sen: number; at: number }>>();

  constructor(
    private casino: CasinoConfig,
    private econ: Economy,
    private world: World,
    private rand: RandInt,
    private hooks: CoinflipHooks,
    private clock: () => number = Date.now,
  ) {}

  /** Stakes allowed between these two: within the casino limits of the lower wealth stage. */
  limits(a: OnlinePlayer, b: OnlinePlayer): [number, number] {
    return betLimits(this.casino, Math.min(a.prog.stage, b.prog.stage));
  }

  challenge(from: OnlinePlayer, to: number, sen: number) {
    if (to === from.id) throw new GameError("You can't flip against yourself.");
    const target = this.world.get(to);
    if (!target?.hasCharacter || !target.prog) throw new GameError("They aren't online.");
    const [min, max] = this.limits(from, target);
    if (sen < min || sen > max) throw new GameError(`Stakes between you two: ${formatMoney(min)} to ${formatMoney(max)}.`);
    if (from.walletSen < sen) throw new GameError('Not enough money.');
    const m = this.pending.get(to) ?? new Map();
    m.set(from.id, { sen, at: this.clock() });
    this.pending.set(to, m);
    this.hooks.challenge(target, from, sen);
    this.hooks.notice(from, `🪙 Challenged ${target.name} to a ${formatMoney(sen)} coinflip.`, 'info');
  }

  respond(me: OnlinePlayer, from: number, accept: boolean) {
    const c = this.pending.get(me.id)?.get(from);
    this.pending.get(me.id)?.delete(from);
    if (!c || this.clock() - c.at > 60_000) throw new GameError('That challenge expired.');
    const a = this.world.get(from);
    if (!a?.prog) throw new GameError('They left.');
    if (!accept) {
      this.hooks.notice(a, `${me.name} turned down your coinflip.`, 'info');
      return null;
    }
    const sen = c.sen;
    if (a.walletSen < sen) throw new GameError(`${a.name} can't cover the stake any more.`);
    if (me.walletSen < sen) throw new GameError('Not enough money.');
    const side: 'heads' | 'tails' = this.rand(2) ? 'heads' : 'tails';
    const challengerWins = side === 'heads'; // the challenger is heads
    const winner = challengerWins ? a : me, loser = challengerWins ? me : a;
    const pot = sen * 2;
    const won = pot - Math.round(pot * COINFLIP_FEE);
    this.econ.run(a, () =>
      this.econ.run(me, () => {
        this.econ.change(a, -sen, 0, 'coinflip-stake', `vs ${me.name}`);
        this.econ.change(me, -sen, 0, 'coinflip-stake', `vs ${a.name}`);
        this.econ.change(winner, won, 0, 'coinflip-win', `vs ${loser.name}`);
      }),
    );
    for (const p of [a, me]) {
      this.hooks.wallet(p, p === winner ? won - sen : -sen, 'coinflip');
      this.hooks.result(p, { a: a.name, b: me.name, winner: winner.name, side, sen, wonSen: won });
      p.prog.stats.coinflips = (p.prog.stats.coinflips ?? 0) + 1;
    }
    winner.prog.stats.coinflipsWon = (winner.prog.stats.coinflipsWon ?? 0) + 1;
    winner.prog.stats.biggestCasinoWin = Math.max(winner.prog.stats.biggestCasinoWin ?? 0, won - sen);
    loser.prog.stats.biggestCasinoLoss = Math.max(loser.prog.stats.biggestCasinoLoss ?? 0, sen);
    if (sen >= this.casino.announceSen) this.hooks.announce(`🪙 ${winner.name} beat ${loser.name} in a ${formatMoney(sen)} coinflip!`);
    this.hooks.check(winner);
    this.hooks.check(loser);
    return { side, winner: winner.name };
  }

  leave(p: OnlinePlayer) {
    this.pending.delete(p.id);
  }
}

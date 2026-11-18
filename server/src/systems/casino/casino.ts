// Lucky Strand Casino (Phase 7, spec §7.6), server side. Every game is resolved here with the
// server's RNG; bets are taken from the wallet when placed and winnings paid when decided.
//
// Solo games: slots, high-low. Shared tables (everyone in the casino sees the same round):
// roulette, the wheel of fortune, crash and blackjack (5 seats). Shared rounds run on a timer
// (tick()). A result is settled the moment it's decided, so leaving can't dodge a loss; winnings
// for someone who has left are kept and paid at their next login.
import {
  betLimits, crashMsFor, crashMultAt, crashPoint, dayKey, formatMoney, handValue, highLowChance, highLowMult, isBlackjack, newShoe, rouletteReturn, settleBlackjack,
  slotsPayout, wheelLayout, cardRank,
  type BjSeat, type BlackjackView, type Card, type CasinoConfig, type CasinoGame, type CasinoSession, type CrashView, type InventoryItem, type RandInt, type RouletteView, type WheelView,
} from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer, World } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

export interface CasinoHooks {
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  /** A shared table changed: send its view to everyone watching. */
  table: (game: 'roulette' | 'blackjack' | 'crash' | 'wheel', view: unknown) => void;
  /** Big wins (and losses) for the whole server. */
  announce: (text: string) => void;
  /** A personal result worth a toast (e.g. you won at a table you'd walked away from). */
  event: (p: OnlinePlayer, text: string, kind: 'good' | 'bad' | 'info') => void;
  items: (p: OnlinePlayer, items: InventoryItem[]) => void;
  session: (p: OnlinePlayer, s: CasinoSession) => void;
  check: (p: OnlinePlayer) => void;
}

interface Saved {
  lastSpinDay: string;
  pendingSen: number;
  session: CasinoSession;
}

interface HighLow {
  bet: number;
  pot: number;
  card: Card;
  streak: number;
}

export class CasinoSystem {
  private cc: CasinoConfig;
  private hl = new Map<number, HighLow>();
  private roulette: RouletteView;
  private wheel: WheelView;
  private crash: CrashView & { point: number };
  private bj: BlackjackView;
  private shoe: Card[] = [];
  private layout: string[];

  constructor(
    private cfg: ServerConfig,
    private repos: Repos,
    private econ: Economy,
    private world: World,
    private rand: RandInt,
    private hooks: CasinoHooks,
    private clock: () => number = Date.now,
  ) {
    this.cc = cfg.casino;
    const now = clock();
    this.layout = wheelLayout(this.cc);
    this.roulette = { round: 1, phase: 'betting', endsAt: now + this.cc.roulette.bettingMs, bets: [], result: null, history: [] };
    this.wheel = { round: 1, phase: 'betting', endsAt: now + this.cc.wheel.everyMs, bets: [], result: null, history: [] };
    this.crash = { round: 1, phase: 'betting', endsAt: now + this.cc.crash.bettingMs, startedAt: 0, crashAt: null, bets: [], history: [], point: 1 };
    this.bj = { round: 1, phase: 'waiting', endsAt: 0, seats: new Array(this.cc.blackjack.seats).fill(null), dealer: [], turn: null };
  }

  // ---------------------------------------------------------------- money
  private saved(id: number): Saved {
    const s = this.repos.playerData.load<Partial<Saved>>(id, 'casino') ?? {};
    return { lastSpinDay: s.lastSpinDay ?? '', pendingSen: s.pendingSen ?? 0, session: s.session ?? { day: '', wageredSen: 0, returnedSen: 0, biggestWinSen: 0 } };
  }
  private store(id: number, s: Saved) {
    this.repos.playerData.save(id, 'casino', s);
  }

  session(p: OnlinePlayer): CasinoSession {
    const s = this.saved(p.id).session;
    return s.day === dayKey(this.clock()) ? s : { day: dayKey(this.clock()), wageredSen: 0, returnedSen: 0, biggestWinSen: 0 };
  }

  private bumpSession(id: number, wagered: number, returned: number, win: number) {
    const s = this.saved(id);
    const today = dayKey(this.clock());
    if (s.session.day !== today) s.session = { day: today, wageredSen: 0, returnedSen: 0, biggestWinSen: 0 };
    s.session.wageredSen += wagered;
    s.session.returnedSen += returned;
    s.session.biggestWinSen = Math.max(s.session.biggestWinSen, win);
    this.store(id, s);
    const p = this.world.get(id);
    if (p) this.hooks.session(p, s.session);
  }

  /** Takes a bet (within your stage's limits). */
  private stake(p: OnlinePlayer, sen: number, game: CasinoGame) {
    sen = Math.floor(sen);
    const [min, max] = betLimits(this.cc, p.prog.stage);
    if (sen < min || sen > max) throw new GameError(`Bets at your wealth stage: ${formatMoney(min)} to ${formatMoney(max)}.`);
    if (p.walletSen < sen) throw new GameError('Not enough money.');
    this.econ.run(p, () => this.econ.change(p, -sen, 0, 'casino-bet', game));
    this.hooks.wallet(p, -sen, 'casino');
    p.prog.stats.casinoBets = (p.prog.stats.casinoBets ?? 0) + 1;
    p.prog.stats.casinoWageredSen = (p.prog.stats.casinoWageredSen ?? 0) + sen;
    this.bumpSession(p.id, sen, 0, 0);
    return sen;
  }

  /**
   * Pays `sen` back for a bet of `betSen` (0 = lost). Online: straight to the wallet; gone:
   * kept and paid at their next login. Big wins are announced.
   */
  private settle(playerId: number, name: string, betSen: number, sen: number, game: string) {
    sen = Math.floor(sen);
    const profit = sen - betSen;
    const p = this.world.get(playerId);
    if (sen > 0) {
      if (p?.prog) {
        this.econ.run(p, () => this.econ.change(p, sen, 0, 'casino-win', game));
        this.hooks.wallet(p, sen, 'casino');
      } else {
        const s = this.saved(playerId);
        s.pendingSen += sen;
        this.store(playerId, s);
      }
    }
    this.bumpSession(playerId, 0, sen, Math.max(0, profit));
    if (p?.prog) {
      const st = p.prog.stats;
      if (profit > 0) {
        st.casinoWonSen = (st.casinoWonSen ?? 0) + profit;
        st.biggestCasinoWin = Math.max(st.biggestCasinoWin ?? 0, profit);
      } else if (profit < 0) {
        st.casinoLostSen = (st.casinoLostSen ?? 0) - profit;
        st.biggestCasinoLoss = Math.max(st.biggestCasinoLoss ?? 0, -profit);
      }
      this.hooks.check(p);
    }
    if (profit > 0 && (sen >= betSen * this.cc.announceMult || profit >= this.cc.announceSen)) {
      this.hooks.announce(`🎰 ${name} won ${formatMoney(profit)} on ${GAME_NAME[game] ?? game} at the Lucky Strand!`);
    }
  }

  /** Winnings that came in while you were away (paid at login). */
  collect(p: OnlinePlayer): number {
    const s = this.saved(p.id);
    if (!s.pendingSen) return 0;
    const sen = s.pendingSen;
    this.econ.run(p, () => {
      this.econ.change(p, sen, 0, 'casino-win', 'while away');
      s.pendingSen = 0;
      this.store(p.id, s);
    });
    this.hooks.wallet(p, sen, 'casino');
    return sen;
  }

  private card(): Card {
    return (1 + this.rand(13)) * 4 + this.rand(4);
  }

  // ---------------------------------------------------------------- slots
  slots(p: OnlinePlayer, betSen: number) {
    const bet = this.stake(p, betSen, 'slots');
    const syms = this.cc.slots.symbols;
    const W = syms.reduce((a, s) => a + s.weight, 0);
    const reel = () => {
      let r = this.rand(W);
      for (const s of syms) if ((r -= s.weight) < 0) return s.id;
      return syms[0].id;
    };
    const reels = [reel(), reel(), reel()];
    const mult = slotsPayout(this.cc, reels);
    const paid = Math.floor(bet * mult);
    this.settle(p.id, p.name, bet, paid, 'slots');
    return { reels, mult, paidSen: paid, walletSen: p.walletSen };
  }

  // ---------------------------------------------------------------- high-low
  hlState(p: OnlinePlayer) {
    const h = this.hl.get(p.id);
    return h ? { card: h.card, pot: h.pot, bet: h.bet, streak: h.streak } : null;
  }

  hlStart(p: OnlinePlayer, betSen: number) {
    if (this.hl.has(p.id)) throw new GameError('Finish your current game first.');
    const bet = this.stake(p, betSen, 'highlow');
    const h: HighLow = { bet, pot: bet, card: this.card(), streak: 0 };
    this.hl.set(p.id, h);
    return { state: this.hlState(p)! };
  }

  hlGuess(p: OnlinePlayer, guess: 'higher' | 'lower') {
    const h = this.hl.get(p.id);
    if (!h) throw new GameError('Place a bet first.');
    const r = cardRank(h.card);
    if (!highLowChance(r, guess)) throw new GameError(`Nothing is ${guess} than that!`);
    const mult = highLowMult(this.cc, r, guess);
    const next = this.card();
    const nr = cardRank(next);
    const correct = guess === 'higher' ? nr > r : nr < r;
    if (!correct) {
      this.hl.delete(p.id);
      this.settle(p.id, p.name, h.bet, 0, 'highlow');
      return { card: next, correct, state: null, paidSen: 0 };
    }
    h.pot = Math.floor(h.pot * mult);
    h.card = next;
    h.streak++;
    if (h.streak >= this.cc.highlow.maxStreak) {
      const paid = this.hlCashout(p).paidSen;
      return { card: next, correct, state: null, paidSen: paid };
    }
    return { card: next, correct, state: this.hlState(p), paidSen: 0 };
  }

  hlCashout(p: OnlinePlayer) {
    const h = this.hl.get(p.id);
    if (!h) throw new GameError('Nothing to cash out.');
    this.hl.delete(p.id);
    this.settle(p.id, p.name, h.bet, h.pot, 'highlow');
    return { paidSen: h.pot, walletSen: p.walletSen };
  }

  // ---------------------------------------------------------------- roulette
  rouletteView(): RouletteView {
    return this.roulette;
  }

  rouletteBet(p: OnlinePlayer, bet: string, sen: number) {
    if (this.roulette.phase !== 'betting') throw new GameError('No more bets! Wait for the next round.');
    const amt = this.stake(p, sen, 'roulette');
    this.roulette.bets.push({ player: p.id, name: p.name, bet, sen: amt });
    this.hooks.table('roulette', this.roulette);
    return {};
  }

  // ---------------------------------------------------------------- wheel of fortune
  wheelView(): WheelView & { layout: string[] } {
    return { ...this.wheel, layout: this.layout };
  }

  wheelBet(p: OnlinePlayer, segment: string, sen: number) {
    if (this.wheel.phase !== 'betting') throw new GameError('The wheel is spinning: bet on the next one.');
    if (!this.cc.wheel.segments.some((s) => s.id === segment)) throw new GameError('No such segment.');
    const amt = this.stake(p, sen, 'wheel');
    this.wheel.bets.push({ player: p.id, name: p.name, segment, sen: amt });
    this.hooks.table('wheel', this.wheelView());
    return {};
  }

  // ---------------------------------------------------------------- crash
  crashView(): CrashView {
    const { point: _hidden, ...v } = this.crash;
    return v;
  }

  crashBet(p: OnlinePlayer, sen: number, auto: number | null) {
    if (this.crash.phase !== 'betting') throw new GameError('The round already started: wait for the next one.');
    if (this.crash.bets.some((b) => b.player === p.id)) throw new GameError('You already bet this round.');
    if (auto !== null && !(auto >= 1.01)) throw new GameError('Auto cash-out must be at least 1.01×.');
    const amt = this.stake(p, sen, 'crash');
    this.crash.bets.push({ player: p.id, name: p.name, sen: amt, auto, cashedAt: null });
    this.hooks.table('crash', this.crashView());
    return {};
  }

  crashCashout(p: OnlinePlayer) {
    const c = this.crash;
    const b = c.bets.find((x) => x.player === p.id);
    if (c.phase !== 'running' || !b || b.cashedAt !== null) throw new GameError('Nothing to cash out.');
    const now = this.clock();
    const m = crashMultAt(this.cc, now - c.startedAt);
    if (m >= c.point) throw new GameError('Too late: it crashed!');
    this.cashOut(b, m);
    this.hooks.table('crash', this.crashView());
    return { mult: m, paidSen: Math.floor(b.sen * m) };
  }

  private cashOut(b: CrashView['bets'][number], m: number) {
    b.cashedAt = m;
    this.settle(b.player, b.name, b.sen, b.sen * m, 'crash');
  }

  // ---------------------------------------------------------------- blackjack
  bjView(): BlackjackView {
    const hide = this.bj.phase === 'betting' || this.bj.phase === 'playing';
    return { ...this.bj, dealer: hide && this.bj.dealer.length > 1 ? [this.bj.dealer[0], -1] : this.bj.dealer };
  }

  private seatOf(p: OnlinePlayer) {
    return this.bj.seats.findIndex((s) => s?.player === p.id);
  }

  bjSit(p: OnlinePlayer, seat: number) {
    if (this.seatOf(p) >= 0) throw new GameError('You already have a seat.');
    if (!(seat >= 0 && seat < this.bj.seats.length) || this.bj.seats[seat]) throw new GameError('That seat is taken.');
    this.bj.seats[seat] = { player: p.id, name: p.name, bet: 0, hands: [] };
    this.hooks.table('blackjack', this.bjView());
    return {};
  }

  bjLeave(p: OnlinePlayer) {
    const i = this.seatOf(p);
    if (i < 0) return {};
    const s = this.bj.seats[i]!;
    if (s.hands.some((h) => !h.result) && this.bj.phase !== 'result' && this.bj.phase !== 'waiting') {
      // In a hand: stand everything; the seat frees up after the round.
      for (const h of s.hands) h.done = true;
      (s as BjSeat & { leaving?: boolean }).leaving = true;
      if (this.bj.turn?.seat === i) this.bjAdvance();
    } else if (s.bet && this.bj.phase === 'betting') {
      // Bet placed but no cards yet: refund.
      this.settle(p.id, p.name, s.bet, s.bet, 'blackjack-refund');
      this.bj.seats[i] = null;
    } else this.bj.seats[i] = null;
    this.hooks.table('blackjack', this.bjView());
    return {};
  }

  bjBet(p: OnlinePlayer, sen: number) {
    const i = this.seatOf(p);
    if (i < 0) throw new GameError('Sit down first.');
    if (this.bj.phase !== 'waiting' && this.bj.phase !== 'betting') throw new GameError('Wait for the next hand.');
    const s = this.bj.seats[i]!;
    if (s.bet) throw new GameError('You already bet this hand.');
    s.bet = this.stake(p, sen, 'blackjack');
    if (this.bj.phase === 'waiting') {
      this.bj.phase = 'betting';
      this.bj.endsAt = this.clock() + this.cc.blackjack.bettingMs;
    }
    // Everyone seated has bet: deal now.
    if (this.bj.seats.every((x) => !x || x.bet)) this.bjDeal();
    this.hooks.table('blackjack', this.bjView());
    return {};
  }

  private draw(): Card {
    if (this.shoe.length < this.cc.blackjack.decks * 52 * 0.25) {
      this.shoe = newShoe(this.cc.blackjack.decks);
      for (let i = this.shoe.length - 1; i > 0; i--) {
        const j = this.rand(i + 1);
        [this.shoe[i], this.shoe[j]] = [this.shoe[j], this.shoe[i]];
      }
    }
    return this.shoe.pop()!;
  }

  private bjDeal() {
    const t = this.bj;
    t.round++;
    t.dealer = [this.draw(), this.draw()];
    for (const s of t.seats) {
      if (!s?.bet) continue;
      const cards = [this.draw(), this.draw()];
      s.hands = [{ cards, bet: s.bet, done: isBlackjack(cards), doubled: false, fromSplit: false }];
    }
    // The dealer peeks: a dealer blackjack ends the hand at once.
    if (isBlackjack(t.dealer)) {
      for (const s of t.seats) for (const h of s?.hands ?? []) h.done = true;
      this.bjFinish();
      return;
    }
    t.phase = 'playing';
    t.turn = null;
    this.bjAdvance();
  }

  /** The next hand that still has to act (or the dealer's turn). */
  private bjAdvance() {
    const t = this.bj;
    for (let si = 0; si < t.seats.length; si++) {
      const s = t.seats[si];
      if (!s) continue;
      const hi = s.hands.findIndex((h) => !h.done);
      if (hi >= 0) {
        t.turn = { seat: si, hand: hi };
        t.endsAt = this.clock() + this.cc.blackjack.turnMs;
        return;
      }
    }
    t.turn = null;
    this.bjFinish();
  }

  bjAction(p: OnlinePlayer, action: 'hit' | 'stand' | 'double' | 'split') {
    const t = this.bj;
    const si = this.seatOf(p);
    if (t.phase !== 'playing' || !t.turn || t.turn.seat !== si) throw new GameError("It isn't your turn.");
    const s = t.seats[si]!;
    const h = s.hands[t.turn.hand];
    if (action === 'hit') {
      h.cards.push(this.draw());
      if (handValue(h.cards).total >= 21) h.done = true;
    } else if (action === 'stand') {
      h.done = true;
    } else if (action === 'double') {
      if (h.cards.length !== 2) throw new GameError('You can only double on your first two cards.');
      this.stake(p, h.bet, 'blackjack');
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(this.draw());
      h.done = true;
    } else {
      if (s.hands.length !== 1 || h.cards.length !== 2 || Math.min(10, cardRank(h.cards[0])) !== Math.min(10, cardRank(h.cards[1]))) throw new GameError('Split needs a pair (once per hand).');
      this.stake(p, h.bet, 'blackjack');
      const aces = cardRank(h.cards[0]) === 1;
      const second = { cards: [h.cards[1], this.draw()], bet: h.bet, done: aces, doubled: false, fromSplit: true };
      h.cards = [h.cards[0], this.draw()];
      h.fromSplit = true;
      h.done = aces; // split aces get one card each
      s.hands.push(second);
    }
    if (h.done) this.bjAdvance();
    else t.endsAt = this.clock() + this.cc.blackjack.turnMs;
    this.hooks.table('blackjack', this.bjView());
    return {};
  }

  /** The dealer plays (draws to 17, stands on soft 17) and every hand is settled. */
  private bjFinish() {
    const t = this.bj;
    const live = t.seats.some((s) => s?.hands.some((h) => handValue(h.cards).total <= 21 && !(isBlackjack(h.cards) && !h.fromSplit)));
    if (live && !isBlackjack(t.dealer)) while (handValue(t.dealer).total < 17) t.dealer.push(this.draw());
    for (const s of t.seats) {
      if (!s) continue;
      let bet = 0, back = 0;
      for (const h of s.hands) {
        const r = settleBlackjack(this.cc, h.cards, t.dealer, h.fromSplit);
        h.result = r.result;
        h.paid = Math.floor(h.bet * r.returns);
        bet += h.bet;
        back += h.paid;
      }
      if (s.hands.length) this.settle(s.player, s.name, bet, back, 'blackjack');
    }
    t.phase = 'result';
    t.endsAt = this.clock() + this.cc.blackjack.resultMs;
    t.turn = null;
  }

  // ---------------------------------------------------------------- the round clock
  /** Advance every shared table (call ~4×/s). */
  tick(now = this.clock()) {
    this.tickRoulette(now);
    this.tickWheel(now);
    this.tickCrash(now);
    this.tickBlackjack(now);
  }

  private tickRoulette(now: number) {
    const r = this.roulette, c = this.cc.roulette;
    if (now < r.endsAt) return;
    if (r.phase === 'betting') {
      // No more bets: the ball is spinning, and the result is settled right now.
      r.phase = 'spinning';
      r.result = this.rand(37);
      r.endsAt = now + c.spinMs;
      for (const b of r.bets) this.settle(b.player, b.name, b.sen, b.sen * rouletteReturn(b.bet, r.result), 'roulette');
    } else if (r.phase === 'spinning') {
      r.phase = 'result';
      r.endsAt = now + c.resultMs;
      r.history = [r.result!, ...r.history].slice(0, 12);
    } else {
      this.roulette = { round: r.round + 1, phase: 'betting', endsAt: now + c.bettingMs, bets: [], result: null, history: r.history };
    }
    this.hooks.table('roulette', this.roulette);
  }

  private tickWheel(now: number) {
    const w = this.wheel, c = this.cc.wheel;
    if (now < w.endsAt) return;
    if (w.phase === 'betting') {
      w.phase = 'spinning';
      w.result = this.rand(this.layout.length);
      w.endsAt = now + c.spinMs;
      const seg = this.layout[w.result];
      const ret = c.segments.find((s) => s.id === seg)!.returns;
      for (const b of w.bets) this.settle(b.player, b.name, b.sen, b.segment === seg ? b.sen * ret : 0, 'wheel');
    } else {
      const seg = this.layout[w.result!];
      this.wheel = { round: w.round + 1, phase: 'betting', endsAt: now + c.everyMs - c.spinMs, bets: [], result: null, history: [seg, ...w.history].slice(0, 12) };
    }
    this.hooks.table('wheel', this.wheelView());
  }

  private tickCrash(now: number) {
    const c = this.crash, k = this.cc.crash;
    if (c.phase === 'running') {
      // Auto cash-outs that the multiplier has reached.
      let changed = false;
      for (const b of c.bets) {
        if (b.cashedAt !== null || b.auto === null || b.auto >= c.point) continue;
        if (now >= c.startedAt + crashMsFor(this.cc, b.auto)) {
          this.cashOut(b, b.auto);
          changed = true;
        }
      }
      if (now >= c.startedAt + crashMsFor(this.cc, c.point)) {
        c.phase = 'crashed';
        c.crashAt = c.point;
        c.endsAt = now + k.crashedMs;
        c.history = [c.point, ...c.history].slice(0, 12);
        for (const b of c.bets) if (b.cashedAt === null) this.settle(b.player, b.name, b.sen, 0, 'crash');
        changed = true;
      }
      if (changed) this.hooks.table('crash', this.crashView());
      return;
    }
    if (now < c.endsAt) return;
    if (c.phase === 'betting') {
      c.phase = 'running';
      c.startedAt = now;
      c.point = crashPoint(this.cc, this.rand(1_000_000) / 1_000_000);
    } else {
      this.crash = { round: c.round + 1, phase: 'betting', endsAt: now + k.bettingMs, startedAt: 0, crashAt: null, bets: [], history: c.history, point: 1 };
    }
    this.hooks.table('crash', this.crashView());
  }

  private tickBlackjack(now: number) {
    const t = this.bj;
    if (t.phase === 'waiting' || now < t.endsAt) return;
    if (t.phase === 'betting') {
      // Time's up: deal to whoever bet; seats without a bet sit this hand out.
      if (t.seats.some((s) => s?.bet)) this.bjDeal();
      else t.phase = 'waiting';
    } else if (t.phase === 'playing' && t.turn) {
      // Too slow: stand.
      const h = t.seats[t.turn.seat]?.hands[t.turn.hand];
      if (h) h.done = true;
      this.bjAdvance();
    } else if (t.phase === 'result') {
      // Next hand: clear the cards, free the seats of anyone who left.
      t.dealer = [];
      t.turn = null;
      for (let i = 0; i < t.seats.length; i++) {
        const s = t.seats[i] as (BjSeat & { leaving?: boolean }) | null;
        if (!s) continue;
        const gone = s.leaving || !this.world.get(s.player);
        t.seats[i] = gone ? null : { player: s.player, name: s.name, bet: 0, hands: [] };
      }
      t.phase = 'waiting';
    }
    this.hooks.table('blackjack', this.bjView());
  }

  /** Someone left the game: give up their seat (their hands stand) and finish high-low. */
  leave(p: OnlinePlayer) {
    if (this.hl.has(p.id)) this.hlCashout(p);
    if (this.seatOf(p) >= 0) this.bjLeave(p);
  }

  /** Server shutting down: hand back every bet that isn't decided yet. */
  refundOpenBets() {
    if (this.roulette.phase === 'betting') for (const b of this.roulette.bets) this.settle(b.player, b.name, b.sen, b.sen, 'refund');
    if (this.wheel.phase === 'betting') for (const b of this.wheel.bets) this.settle(b.player, b.name, b.sen, b.sen, 'refund');
    if (this.crash.phase !== 'crashed') for (const b of this.crash.bets) if (b.cashedAt === null) this.settle(b.player, b.name, b.sen, b.sen, 'refund');
    for (const st of this.bj.seats) {
      if (!st) continue;
      const open = st.hands.length ? st.hands.filter((h) => !h.result).reduce((a, h) => a + h.bet, 0) : st.bet;
      if (open) this.settle(st.player, st.name, open, open, 'refund');
    }
    for (const [id, h] of this.hl) {
      const p = this.world.get(id);
      this.settle(id, p?.name ?? '', h.bet, h.pot, 'highlow');
    }
    this.roulette.bets = [];
    this.wheel.bets = [];
    this.crash.bets = [];
    this.hl.clear();
  }

  // ---------------------------------------------------------------- daily free spin
  canSpin(p: OnlinePlayer) {
    return this.saved(p.id).lastSpinDay !== dayKey(this.clock());
  }

  dailySpin(p: OnlinePlayer) {
    const s = this.saved(p.id);
    const today = dayKey(this.clock());
    if (s.lastSpinDay === today) throw new GameError('You already spun today. Come back tomorrow!');
    const d = this.cc.dailySpin;
    const W = d.prizes.reduce((a, x) => a + x.weight, 0);
    let r = this.rand(W);
    let index = 0;
    for (let i = 0; i < d.prizes.length; i++) if ((r -= d.prizes[i].weight) < 0) {
      index = i;
      break;
    }
    const prize = d.prizes[index];
    const sen = Math.round(prize.sen * d.stageMult[Math.min(d.stageMult.length - 1, p.prog.stage - 1)]);
    const items: InventoryItem[] = [];
    this.econ.run(p, () => {
      if (sen || prize.shards) this.econ.change(p, sen, prize.shards, 'daily-spin', prize.id);
      if (prize.item && this.cfg.itemById.has(prize.item)) items.push(this.econ.grant(p, prize.item, 'normal', null).item);
      s.lastSpinDay = today;
      this.store(p.id, s);
    });
    if (sen || prize.shards) this.hooks.wallet(p, sen, 'spin');
    if (items.length) this.hooks.items(p, items);
    return { index, sen, shards: prize.shards, item: prize.item ?? null };
  }
}

const GAME_NAME: Record<string, string> = { slots: 'the slots', roulette: 'roulette', blackjack: 'blackjack', crash: 'Crash', wheel: 'the Wheel of Fortune', highlow: 'High-Low' };

// Trading and gifting between players (Phase 7, spec §14).
//
// Trade: request → the other player accepts → both put in items and/or RM → both lock → both
// confirm → the server swaps everything in ONE database transaction (all or nothing). Any change
// to an offer unlocks both sides, so nobody can be tricked by a last-second swap. Items stay in
// your bag until the swap and are checked again then (still yours, not worn, not placed in a
// home). Leaving, or either side cancelling, ends the trade.
//
// Gift: send RM and/or items to someone online, straight away.
import { formatMoney, type InventoryItem, type TradeSide, type TradeView } from '@kh/shared';
import type { OnlinePlayer, World } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

export interface TradeHooks {
  /** The trade changed: send each side their view (null = closed). */
  view: (p: OnlinePlayer, v: TradeView | null, done?: boolean, reason?: string) => void;
  request: (to: OnlinePlayer, from: OnlinePlayer) => void;
  notice: (p: OnlinePlayer, text: string, kind: 'good' | 'bad' | 'info') => void;
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  items: (p: OnlinePlayer, items: InventoryItem[]) => void;
  removed: (p: OnlinePlayer, iids: number[]) => void;
  /** Placed furniture can't change hands. */
  lockedIids: (p: OnlinePlayer) => Set<number>;
  cosmeticsChanged: (p: OnlinePlayer) => void;
  check: (p: OnlinePlayer) => void;
}

interface Side {
  player: number;
  items: number[];
  sen: number;
  locked: boolean;
  confirmed: boolean;
}
interface Trade {
  id: number;
  a: Side;
  b: Side;
}

const MAX_ITEMS = 30;

export class TradeSystem {
  private trades = new Map<number, Trade>();
  /** to → from → when (pending requests, 60 s). */
  private requests = new Map<number, Map<number, number>>();
  private nextId = 1;

  constructor(
    private econ: Economy,
    private world: World,
    private hooks: TradeHooks,
    private clock: () => number = Date.now,
  ) {}

  private tradeOf(id: number): Trade | undefined {
    for (const t of this.trades.values()) if (t.a.player === id || t.b.player === id) return t;
    return undefined;
  }

  private online(id: number): OnlinePlayer {
    const p = this.world.get(id);
    if (!p?.hasCharacter || !p.prog) throw new GameError("They aren't online.");
    return p;
  }

  request(from: OnlinePlayer, to: number) {
    if (to === from.id) throw new GameError("You can't trade with yourself.");
    const target = this.online(to);
    if (this.tradeOf(from.id)) throw new GameError('Finish your current trade first.');
    if (this.tradeOf(to)) throw new GameError(`${target.name} is already trading.`);
    const m = this.requests.get(to) ?? new Map<number, number>();
    m.set(from.id, this.clock());
    this.requests.set(to, m);
    this.hooks.request(target, from);
    this.hooks.notice(from, `Trade request sent to ${target.name}.`, 'info');
  }

  respond(me: OnlinePlayer, from: number, accept: boolean) {
    const at = this.requests.get(me.id)?.get(from);
    this.requests.get(me.id)?.delete(from);
    if (!at || this.clock() - at > 60_000) throw new GameError('That request expired.');
    const other = this.online(from);
    if (!accept) return this.hooks.notice(other, `${me.name} said no to the trade.`, 'info');
    if (this.tradeOf(me.id) || this.tradeOf(from)) throw new GameError('One of you is already trading.');
    const side = (player: number): Side => ({ player, items: [], sen: 0, locked: false, confirmed: false });
    const t: Trade = { id: this.nextId++, a: side(from), b: side(me.id) };
    this.trades.set(t.id, t);
    this.push(t);
  }

  private sides(t: Trade, id: number): [Side, Side] {
    return t.a.player === id ? [t.a, t.b] : [t.b, t.a];
  }

  private sideView(s: Side): TradeSide {
    const p = this.world.get(s.player);
    return { player: s.player, name: p?.name ?? '?', items: (p?.inventory ?? []).filter((i) => s.items.includes(i.iid)), sen: s.sen, locked: s.locked, confirmed: s.confirmed };
  }

  private push(t: Trade) {
    for (const id of [t.a.player, t.b.player]) {
      const p = this.world.get(id);
      if (!p) continue;
      const [me, them] = this.sides(t, id);
      this.hooks.view(p, { id: t.id, me: this.sideView(me), them: this.sideView(them) });
    }
  }

  private mine(p: OnlinePlayer): [Trade, Side, Side] {
    const t = this.tradeOf(p.id);
    if (!t) throw new GameError("You aren't trading.");
    const [me, them] = this.sides(t, p.id);
    return [t, me, them];
  }

  /** What can be offered: yours, not worn, not placed in a home. */
  private checkItems(p: OnlinePlayer, iids: number[]) {
    if (new Set(iids).size !== iids.length) throw new GameError('Each item only once.');
    if (iids.length > MAX_ITEMS) throw new GameError(`Up to ${MAX_ITEMS} items at a time.`);
    const worn = new Set(Object.values(p.equipped));
    const locked = this.hooks.lockedIids(p);
    for (const iid of iids) {
      if (!p.inventory.some((i) => i.iid === iid)) throw new GameError('You no longer have one of those items.');
      if (worn.has(iid)) throw new GameError('Take it off first.');
      if (locked.has(iid)) throw new GameError("That's in use (placed in a home, or in your 🐾 Teman team / on a Teman).");
    }
  }

  offer(p: OnlinePlayer, items: number[], sen: number) {
    const [t, me, them] = this.mine(p);
    this.checkItems(p, items);
    if (sen > p.walletSen) throw new GameError('Not enough money.');
    me.items = items;
    me.sen = sen;
    // Any change: both have to look again.
    me.locked = them.locked = false;
    me.confirmed = them.confirmed = false;
    this.push(t);
  }

  lock(p: OnlinePlayer) {
    const [t, me] = this.mine(p);
    me.locked = true;
    this.push(t);
  }

  confirm(p: OnlinePlayer) {
    const [t, me, them] = this.mine(p);
    if (!me.locked || !them.locked) throw new GameError('Both of you have to lock your offers first.');
    me.confirmed = true;
    if (them.confirmed) this.execute(t);
    else this.push(t);
  }

  cancel(p: OnlinePlayer, reason = `${p.name} cancelled the trade.`) {
    const t = this.tradeOf(p.id);
    if (!t) return;
    this.trades.delete(t.id);
    for (const id of [t.a.player, t.b.player]) {
      const q = this.world.get(id);
      if (q) this.hooks.view(q, null, false, reason);
    }
  }

  /** Both confirmed: swap everything in one transaction (or nothing at all). */
  private execute(t: Trade) {
    const pa = this.world.get(t.a.player), pb = this.world.get(t.b.player);
    if (!pa || !pb) return this.cancelBoth(t, 'Somebody left.');
    const got: Record<number, InventoryItem[]> = { [pa.id]: [], [pb.id]: [] };
    try {
      this.checkItems(pa, t.a.items);
      this.checkItems(pb, t.b.items);
      if (pa.walletSen < t.a.sen || pb.walletSen < t.b.sen) throw new GameError('Somebody no longer has the money.');
      this.econ.run(pa, () =>
        this.econ.run(pb, () => {
          const move = (from: OnlinePlayer, to: OnlinePlayer, s: Side) => {
            for (const iid of s.items) {
              const inst = from.inventory.find((i) => i.iid === iid)!;
              this.econ.remove(from, iid);
              got[to.id].push(this.econ.grant(to, inst.itemId, inst.variant, inst.serial, inst.grade ?? 'D').item);
            }
            if (s.sen) {
              this.econ.change(from, -s.sen, 0, 'trade-out', `trade#${t.id}`);
              this.econ.change(to, s.sen, 0, 'trade-in', `trade#${t.id}`);
            }
          };
          move(pa, pb, t.a);
          move(pb, pa, t.b);
        }),
      );
    } catch (err) {
      return this.cancelBoth(t, err instanceof GameError ? err.message : 'The trade failed; nothing changed.');
    }
    this.trades.delete(t.id);
    for (const [p, out, gave] of [[pa, t.a, t.b], [pb, t.b, t.a]] as const) {
      this.hooks.removed(p, out.items);
      this.hooks.items(p, got[p.id]);
      this.hooks.wallet(p, gave.sen - out.sen, 'trade');
      this.hooks.cosmeticsChanged(p);
      p.prog.stats.trades = (p.prog.stats.trades ?? 0) + 1;
      this.hooks.view(p, null, true, 'Trade done! 🤝');
      this.hooks.check(p);
    }
  }

  private cancelBoth(t: Trade, reason: string) {
    this.trades.delete(t.id);
    for (const id of [t.a.player, t.b.player]) {
      const q = this.world.get(id);
      if (q) this.hooks.view(q, null, false, reason);
    }
  }

  /** Send RM and/or items to someone online. */
  gift(from: OnlinePlayer, to: number, sen: number, items: number[]) {
    if (to === from.id) throw new GameError("You can't gift yourself.");
    if (!sen && !items.length) throw new GameError('Pick something to give.');
    if (this.tradeOf(from.id)) throw new GameError('Finish your trade first.');
    const target = this.online(to);
    this.checkItems(from, items);
    if (sen > from.walletSen) throw new GameError('Not enough money.');
    const got: InventoryItem[] = [];
    this.econ.run(from, () =>
      this.econ.run(target, () => {
        for (const iid of items) {
          const inst = from.inventory.find((i) => i.iid === iid)!;
          this.econ.remove(from, iid);
          got.push(this.econ.grant(target, inst.itemId, inst.variant, inst.serial, inst.grade ?? 'D').item);
        }
        if (sen) {
          this.econ.change(from, -sen, 0, 'gift-out', target.name);
          this.econ.change(target, sen, 0, 'gift-in', from.name);
        }
      }),
    );
    this.hooks.removed(from, items);
    this.hooks.wallet(from, -sen, 'gift');
    this.hooks.cosmeticsChanged(from);
    this.hooks.items(target, got);
    this.hooks.wallet(target, sen, 'gift');
    const what = [sen ? formatMoney(sen) : '', got.length ? `${got.length} item${got.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ');
    this.hooks.notice(target, `🎁 ${from.name} sent you ${what}!`, 'good');
    this.hooks.notice(from, `🎁 Sent ${what} to ${target.name}.`, 'good');
    from.prog.stats.giftsSent = (from.prog.stats.giftsSent ?? 0) + 1;
    this.hooks.check(from);
  }

  /** Someone left: their trade ends. */
  leave(p: OnlinePlayer) {
    this.cancel(p, `${p.name} left.`);
    this.requests.delete(p.id);
  }
}

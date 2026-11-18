// Bits every casino game uses: the bet picker (chips scaled to your wealth stage's limits),
// playing cards, today's session line, and watching a shared table.
import { betLimits, cardLabel, cardSuit, formatMoney, type CasinoSession } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { sfx } from '../sound';

const chosen = new Map<string, number>();

/** Chips: the minimum × 1, 2, 5, 10, 25, 100 (capped at the max), plus Max. */
export function betPicker(app: App, game: string, onChange?: () => void) {
  const [min, max] = betLimits(app.cfg.casino, app.store.progress.stage);
  const opts = [...new Set([1, 2, 5, 10, 25, 100].map((k) => Math.min(max, min * k)).concat(max))];
  if (!opts.includes(chosen.get(game) ?? -1)) chosen.set(game, min);
  const row = el('div', { class: 'casino-chips' });
  const paint = () => {
    row.replaceChildren(
      ...opts.map((v) => {
        const b = el('button', { class: `casino-chip${chosen.get(game) === v ? ' on' : ''}`, type: 'button', 'data-bet': String(v) }, v === max ? `Max ${formatMoney(v)}` : formatMoney(v));
        b.addEventListener('click', () => {
          chosen.set(game, v);
          sfx.click();
          paint();
          onChange?.();
        });
        return b;
      }),
    );
  };
  paint();
  return { el: row, get: () => chosen.get(game) ?? min };
}

/** A playing card (-1 = face down). */
export function cardEl(c: number, extra = ''): HTMLElement {
  if (c < 0) return el('span', { class: `pcard back ${extra}` }, '🂠');
  const red = cardSuit(c) === 1 || cardSuit(c) === 2;
  return el('span', { class: `pcard${red ? ' red' : ''} ${extra}` }, cardLabel(c));
}

/** "Today: bet RM X · back RM Y (+RM Z)". */
export function sessionLine(s: CasinoSession | null): HTMLElement {
  const line = el('div', { class: 'casino-session muted small' });
  if (!s) return line;
  const net = s.returnedSen - s.wageredSen;
  line.append(`Today: bet ${formatMoney(s.wageredSen)} · won back ${formatMoney(s.returnedSen)} `, el('b', { class: net >= 0 ? 'pos' : 'neg' }, `(${net >= 0 ? '+' : ''}${formatMoney(net)})`));
  return line;
}

/** Turns an ack into a toast on failure; returns true if it worked. */
export function ok(err: Error | null, res: { ok: boolean; error?: string }): boolean {
  if (err || !res.ok) {
    sfx.error();
    toast(err ? 'No response.' : (res.error ?? 'Something went wrong.'), 'bad');
    return false;
  }
  return true;
}

/** Seconds left until a server time, as "12 s". */
export function secsLeft(app: App, endsAt: number): string {
  return `${Math.max(0, Math.ceil((endsAt - app.store.serverNow()) / 1000))} s`;
}

/**
 * Watch a shared table: the current view now, then every change, until `stop()` is called.
 */
export function watchTable<V>(app: App, game: 'roulette' | 'blackjack' | 'crash' | 'wheel', onView: (v: V) => void, onSession: (s: CasinoSession) => void) {
  const sock = app.socket;
  const handler = (p: { game: string; view: unknown }) => {
    if (p.game === game) onView(p.view as V);
  };
  const sess = (p: { session: CasinoSession }) => onSession(p.session);
  sock?.on('casino:table', handler as never);
  sock?.on('casino:session', sess);
  sock?.timeout(5000).emit('casino:watch', { game }, (err, res) => {
    if (err || !res.ok) return;
    onView(res.view as V);
    onSession(res.session);
  });
  return () => {
    sock?.off('casino:table', handler as never);
    sock?.off('casino:session', sess);
    sock?.emit('casino:unwatch', { game }, () => {});
  };
}

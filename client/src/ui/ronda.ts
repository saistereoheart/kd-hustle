// 🛵 Ronda: the phone's ride-hailing app. Pick a spot on the full map, see the route and the
// fare (both worked out by the server), book it, and a rider takes you there. You can't steer;
// "Get off here" stops the ride early (no refund).
import { formatMoneyExact, type RideQuote } from '@kh/shared';
import type { App } from '../app';
import { sfx } from './sound';
import { el, toast, uiRoot } from './dom';

const distText = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

/** Open the full map in "where to?" mode. */
export function openRonda(app: App) {
  const name = app.cfg.rides.appName;
  const map = app.minimap;
  if (!map) return;
  if (app.rideHud) return void toast(`You're already on a ${name} ride.`);
  if (app.store.job?.kind === 'carwash') return void toast('Finish washing the car first.', 'bad');
  let quote: RideQuote | null = null;
  let seq = 0;

  const sheet = (...children: Array<Node | string>) => map.setSheet(el('div', { class: 'ronda-sheet' }, ...children));
  const ask = (tx: number, ty: number) => {
    const mine = ++seq;
    quote = null;
    map.setRoute(null);
    sheet(el('div', { class: 'ronda-title' }, `🛵 ${name}`), el('p', { class: 'muted' }, 'Finding a rider and a route…'));
    app.socket?.timeout(8000).emit('ride:quote', { x: tx, y: ty }, (err, res) => {
      if (mine !== seq) return; // a newer pick replaced this one
      if (err || !res.ok) {
        sfx.error();
        sheet(el('div', { class: 'ronda-title' }, `🛵 ${name}`), el('p', { class: 'bad-text' }, err ? 'No response. Try again.' : res.ok ? '' : res.error), el('p', { class: 'muted' }, 'Tap another spot on the map.'));
        return;
      }
      quote = res.quote;
      map.setRoute(quote.route);
      const afford = app.store.walletSen >= quote.fareSen;
      const book = el('button', { class: 'btn primary', type: 'button', 'data-action': 'ronda-book', disabled: !afford }, `Book · ${formatMoneyExact(quote.fareSen)}`);
      book.addEventListener('click', () => doBook(book));
      sheet(
        el('div', { class: 'ronda-title' }, `🛵 ${name} to ${quote.destName ?? 'the pin'}`),
        el('div', { class: 'ronda-facts' },
          el('span', {}, `📏 ${distText(quote.meters)}`),
          el('span', {}, `⏱️ ~${quote.etaSec}s`),
          el('span', { class: 'ronda-fare', 'data-testid': 'ronda-fare' }, `💵 ${formatMoneyExact(quote.fareSen)}`),
        ),
        afford ? el('p', { class: 'muted' }, 'Tap elsewhere to change the drop-off.') : el('p', { class: 'bad-text' }, "You can't afford this ride."),
        book,
      );
    });
  };
  const doBook = (btn: HTMLButtonElement) => {
    if (!quote) return;
    btn.disabled = true;
    const q = quote;
    app.socket?.timeout(6000).emit('ride:book', { quoteId: q.quoteId }, (err, res) => {
      if (err || !res.ok) {
        btn.disabled = false;
        sfx.error();
        return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      sfx.coin();
      app.store.walletSen = res.walletSen;
      map.closeFull();
      app.rideHud = new RideHud(app, res.destName, res.pickupMs, res.durationMs, res.route);
      app.store.emit();
      toast(`🛵 Your ${name} rider is here! Hop on.`, 'good');
    });
  };

  map.openFull({
    pick: { hint: `🛵 ${name}: tap where you want to go`, onPick: ask },
    onClose: () => {
      seq++;
      map.setRoute(null);
    },
  });
}

/** The banner while riding: where to, time left, and "Get off here". */
export class RideHud {
  private root: HTMLElement;
  private timer: number;

  constructor(private app: App, destName: string | null, pickupMs: number, durationMs: number, readonly route: number[]) {
    const name = app.cfg.rides.appName;
    const left = el('div', { class: 'job-hud-meta' });
    const stop = el('button', { class: 'btn small', type: 'button', 'data-action': 'ronda-stop' }, 'Get off here');
    stop.addEventListener('click', () => {
      stop.disabled = true;
      app.socket?.timeout(5000).emit('ride:stop', (err, res) => {
        stop.disabled = false;
        if (err || !res.ok) toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      });
    });
    this.root = el('div', { class: 'job-hud ride-hud', 'data-testid': 'ride-hud' },
      el('div', {}, el('div', { class: 'job-hud-title' }, `🛵 ${name} to ${destName ?? 'your pin'}`), left), stop);
    uiRoot().append(this.root);
    const start = performance.now();
    const tick = () => {
      const t = performance.now() - start;
      left.textContent = t < pickupMs ? 'Rider arriving…' : `${Math.max(0, Math.ceil((durationMs - t) / 1000))}s to go`;
    };
    tick();
    this.timer = window.setInterval(tick, 250);
  }

  destroy() {
    clearInterval(this.timer);
    this.root.remove();
  }
}

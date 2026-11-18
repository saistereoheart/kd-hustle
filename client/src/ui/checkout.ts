// Be the cashier at your kedai runcit (spec §8.5): scan every item in the basket (tap them), see
// what the customer hands over, then pick the right change. Right and in time = a 50% bonus on
// the basket; wrong change costs you the difference. The server keeps the basket and checks.
import { formatMoneyExact } from '@kh/shared';
import type { App } from '../app';
import { el, uiRoot } from './dom';
import { sfx } from './sound';

export function openCheckout(app: App) {
  const r = app.cfg.businesses.retail;
  const products = new Map(r.products.map((p) => [p.id, p]));
  const box = el('div', { class: 'carwash-box checkout-box', 'data-testid': 'checkout' });
  const host = el('div', { class: 'reveal-overlay' }, box);
  uiRoot().append(host);
  let raf = 0;
  const close = () => {
    cancelAnimationFrame(raf);
    host.remove();
  };
  let streak = 0;
  let earned = 0;

  const next = () => {
    cancelAnimationFrame(raf);
    box.replaceChildren(el('p', { class: 'muted' }, 'Next customer…'));
    app.socket?.timeout(5000).emit('checkout:start', (err, res) => {
      if (err || !res.ok) {
        sfx.error();
        const quit = el('button', { class: 'btn', type: 'button' }, 'Close');
        quit.addEventListener('click', close);
        box.replaceChildren(el('p', {}, err ? 'No response.' : res.ok ? '' : res.error), el('div', { class: 'cw-foot' }, quit));
        return;
      }
      play(res.checkout);
    });
  };

  const play = (co: { id: number; items: Array<{ product: string; priceSen: number }>; paidSen: number; options: number[] }) => {
    const started = performance.now();
    const scanned = new Set<number>();
    let total = 0;
    const totalEl = el('div', { class: 'checkout-total' }, 'Total: RM 0.00');
    const timer = el('div', { class: 'progress' }, el('i', {}));
    const fill = timer.firstChild as HTMLElement;
    const basket = el('div', { class: 'checkout-basket' });
    const pay = el('div', { class: 'checkout-pay' });
    co.items.forEach((it, i) => {
      const p = products.get(it.product);
      const b = el('button', { class: 'checkout-item', type: 'button', 'data-scan': String(i) }, el('span', { class: 'checkout-icon' }, p?.icon ?? '📦'), el('small', {}, p?.name ?? it.product));
      b.addEventListener('click', () => {
        if (scanned.has(i)) return;
        scanned.add(i);
        sfx.click();
        b.classList.add('scanned');
        b.append(el('b', {}, formatMoneyExact(it.priceSen)));
        total += it.priceSen;
        totalEl.textContent = `Total: ${formatMoneyExact(total)}`;
        if (scanned.size === co.items.length) showPay();
      });
      basket.append(b);
    });
    const showPay = () => {
      const opts = el('div', { class: 'checkout-options' });
      for (const o of co.options) {
        const b = el('button', { class: 'btn', type: 'button', 'data-change': String(o) }, formatMoneyExact(o));
        b.addEventListener('click', () => give(o));
        opts.append(b);
      }
      pay.replaceChildren(el('p', {}, `💵 The customer hands you ${formatMoneyExact(co.paidSen)}. Their change?`), opts);
    };
    let sent = false;
    const give = (change: number) => {
      if (sent) return;
      sent = true;
      // The server wants a real checkout (not instant): wait out the minimum if you were quick.
      const wait = Math.max(0, r.cashierMinMs - (performance.now() - started) + 50);
      window.setTimeout(() =>
        app.socket?.timeout(5000).emit('checkout:finish', { id: co.id, changeSen: change }, (err, res) => {
          cancelAnimationFrame(raf);
          if (err || !res.ok) {
            sfx.error();
            return result(err ? 'No response.' : res.ok ? '' : res.error, false);
          }
          earned += res.gainSen;
          if (res.correct && res.onTime) {
            streak++;
            sfx.reveal(2);
            result(`✅ Correct! +${formatMoneyExact(res.gainSen)} (bonus ${formatMoneyExact(res.bonusSen)})`, true);
          } else {
            streak = 0;
            sfx.error();
            result(res.correct ? `⏱️ Right change, but too slow: +${formatMoneyExact(res.gainSen)} (no bonus)` : `❌ Wrong change! +${formatMoneyExact(res.gainSen)} after the difference`, false);
          }
        }),
      wait);
    };
    const tick = () => {
      const left = Math.max(0, 1 - (performance.now() - started) / r.cashierMaxMs);
      fill.style.width = `${left * 100}%`;
      fill.style.background = left > 0.5 ? '#40c057' : left > 0.25 ? '#fab005' : '#fa5252';
      if (left > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const quit = el('button', { class: 'btn', type: 'button', 'data-action': 'checkout-close' }, 'Close the till');
    quit.addEventListener('click', close);
    box.replaceChildren(
      el('h3', {}, `🧾 Customer${streak ? ` · streak ${streak}` : ''}`),
      el('p', { class: 'muted small' }, 'Tap every item to scan it, then give the right change.'),
      timer,
      basket,
      totalEl,
      pay,
      el('div', { class: 'cw-foot' }, quit),
    );
  };

  const result = (text: string, good: boolean) => {
    const again = el('button', { class: 'btn primary', type: 'button', 'data-action': 'checkout-next' }, 'Next customer');
    again.addEventListener('click', next);
    const quit = el('button', { class: 'btn', type: 'button', 'data-action': 'checkout-close' }, 'Close the till');
    quit.addEventListener('click', close);
    const head = el('div', { class: 'dish-quality' }, good ? 'Ka-ching!' : 'Hmm…');
    head.style.color = good ? '#69db7c' : '#ffa94d';
    box.replaceChildren(head, el('p', {}, text), el('p', { class: 'muted small' }, `This shift: ${formatMoneyExact(earned)}`), el('div', { class: 'cw-foot' }, quit, again));
  };

  next();
}

// Buying ingredients: the same list in the hypermarket (in person) and the phone (delivered, +fee).
import { formatMoney, stockCount, stockItems, stockPriceSen } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { sfx } from '../sound';

export function stockList(app: App, delivery: boolean): HTMLElement {
  const st = app.store.stall;
  const cfg = app.cfg.stalls;
  if (!st) return el('p', { class: 'empty' }, "You don't have a stall yet. 📱 → Business to buy one.");
  const rows = stockItems(cfg, app.cfg.recipes.recipes, st).map((r) => {
    const have = stockCount(st, r.id);
    const btns = el('div', { class: 'stock-btns' });
    for (const pack of cfg.stock.packs) {
      const price = stockPriceSen(cfg, r, st, pack.qty, delivery);
      const b = el(
        'button',
        { class: 'btn small', type: 'button', 'data-action': `stock-${r.id}-${pack.qty}`, disabled: app.store.walletSen < price || have + pack.qty > cfg.stock.maxPerRecipe },
        `+${pack.qty}`,
        el('small', {}, `${formatMoney(price)}${pack.discount ? ` −${Math.round(pack.discount * 100)}%` : ''}`),
      );
      b.addEventListener('click', () => {
        b.disabled = true;
        app.socket?.timeout(5000).emit('stall:stock', { recipe: r.id, qty: pack.qty, delivery }, (err, res) => {
          if (err || !res.ok) {
            sfx.error();
            b.disabled = false;
            return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
          }
          sfx.coin();
          toast(`${r.icon} +${pack.qty} ${r.name} portions`, 'good');
        });
      });
      btns.append(b);
    }
    const qty = el('b', { class: `stock-qty${have <= 0 ? ' out' : have <= 5 ? ' low' : ''}` }, String(have));
    return el(
      'div',
      { class: `stock-row${r.parent ? ' addon' : ''}`, 'data-recipe': r.id },
      el('div', { class: 'stock-name' }, `${r.parent ? '➕ ' : ''}${r.icon} ${r.name}`, el('div', { class: 'muted small' }, qty, ` ${r.parent ? 'in stock (add-on)' : 'portions'} · ${formatMoney(r.ingredientCostSen)} each`)),
      btns,
    );
  });
  const shelf = cfg.stock.shelfLifeGameHours / 24;
  return el(
    'div',
    { class: 'stock-list' },
    ...rows,
    el('p', { class: 'hint' }, `${delivery ? `Delivery adds ${Math.round(cfg.stock.deliveryFee * 100)}%. Buy in person at Gergasi Hypermarket (The Strand) to save it. ` : ''}Ingredients keep ${shelf} in-game days (play time). Bigger packs are cheaper per portion.`),
  );
}

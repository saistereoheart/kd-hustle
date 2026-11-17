// Kedai Pajak Untung: sell items for RM, scrap them into shards, or buy specific items with shards.
import { formatMoney, pawnPriceSen, scrapShards } from '@kh/shared';
import type { App } from '../app';
import { el, toast } from './dom';
import { itemCard, openPanel, tabs, tierOf } from './panel';
import { sfx } from './sound';

export function openPawnPanel(app: App) {
  const panel = openPanel('🏪 Kedai Pajak Untung', { wide: true, testId: 'pawn-panel' });
  const rar = app.cfg.rarities;
  let tab = 0;
  const content = el('div');
  panel.body.append(tabs(['Sell', 'Scrap', 'Shard Shop'], (i) => {
    tab = i;
    render();
  }), content);

  const fail = (err: unknown, res: { ok: false; error: string } | { ok: true }) => {
    sfx.error();
    toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
  };
  const doStack = (event: 'pawn:sell' | 'pawn:scrap', itemId: string, variant: string, count: number) => {
    const sock = app.socket?.timeout(6000);
    if (!sock) return;
    if (event === 'pawn:sell') {
      sock.emit('pawn:sell', { itemId, variant, count }, (err, res) => {
        if (err || !res.ok) return fail(err, res);
        sfx.coin();
        app.store.removeItems(res.removed);
        toast(`Sold for ${formatMoney(res.gainedSen)}`, 'good');
      });
    } else {
      sock.emit('pawn:scrap', { itemId, variant, count }, (err, res) => {
        if (err || !res.ok) return fail(err, res);
        sfx.coin();
        app.store.removeItems(res.removed);
        toast(`+${res.gainedShards} 💎 shards`, 'good');
      });
    }
  };

  const renderStacks = (mode: 'sell' | 'scrap') => {
    const stacks = app.store
      .stacks()
      .filter((s) => s.serial === null)
      .sort((a, b) => tierOf(rar, app.items.get(a.itemId)!.rarity).index - tierOf(rar, app.items.get(b.itemId)!.rarity).index);
    if (!stacks.length) {
      content.replaceChildren(el('p', { class: 'empty' }, 'Nothing to pawn. (Limited items with serial numbers can\'t be pawned.)'));
      return;
    }
    const list = el('div', { class: 'stack-list' });
    for (const s of stacks) {
      const def = app.items.get(s.itemId)!;
      const crate = app.cratesOfItem.get(def.id)!;
      const each = mode === 'sell' ? pawnPriceSen(rar, def, crate, s.variant, app.cfg.economy.pawnRate) : scrapShards(rar, def, s.variant);
      const label = (n: number) => (mode === 'sell' ? formatMoney(each * n) : `${each * n} 💎`);
      const one = el('button', { class: 'btn', type: 'button', 'data-action': `${mode}-one` }, `${mode === 'sell' ? 'Sell' : 'Scrap'} 1`, el('small', {}, label(1)));
      one.addEventListener('click', () => doStack(mode === 'sell' ? 'pawn:sell' : 'pawn:scrap', s.itemId, s.variant, 1));
      const row = el('div', { class: 'stack-row' }, itemCard(rar, def, s.variant, { count: s.items.length, size: 48 }), el('div', { class: 'stack-btns' }, one));
      if (s.items.length > 1) {
        const all = el('button', { class: 'btn', type: 'button' }, `All ×${s.items.length}`, el('small', {}, label(s.items.length)));
        all.addEventListener('click', () => doStack(mode === 'sell' ? 'pawn:sell' : 'pawn:scrap', s.itemId, s.variant, s.items.length));
        row.lastElementChild!.append(all);
      }
      list.append(row);
    }
    content.replaceChildren(
      el('p', { class: 'muted' }, mode === 'sell' ? `The pawn shop pays ${Math.round(app.cfg.economy.pawnRate * 100)}% of an item's value. Worn items are sold last.` : 'Scrap items into 💎 shards, then buy exactly what you want in the Shard Shop.'),
      list,
    );
  };

  const renderShop = () => {
    const prices = app.cfg.economy.shardShopPrices;
    const list = el('div', { class: 'item-grid' });
    for (const def of app.cfg.items.items) {
      const price = prices[def.rarity];
      if (!price || def.limit) continue;
      const known = app.store.index.has(def.id);
      const card = itemCard(rar, def, 'normal', { silhouette: !known, caption: `${price} 💎`, size: 56 });
      if (known) {
        card.classList.add('buyable');
        card.addEventListener('click', () =>
          app.socket?.timeout(6000).emit('shard:buy', { itemId: def.id }, (err, res) => {
            if (err || !res.ok) {
              sfx.error();
              return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
            }
            sfx.coin();
            app.store.addItems([res.item]);
            toast(`Bought ${def.name}`, 'good');
          }),
        );
      }
      list.append(card);
    }
    content.replaceChildren(el('p', { class: 'muted' }, `You have ${app.store.shards} 💎. Only items you've discovered can be bought (Common to Epic).`), list);
  };

  const render = () => (tab === 0 ? renderStacks('sell') : tab === 1 ? renderStacks('scrap') : renderShop());
  const off = app.store.on(render);
  panel.onClose = () => off();
  render();
}

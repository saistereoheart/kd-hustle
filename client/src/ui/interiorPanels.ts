// 🏬 What the designed interiors' props open: a sign / notice / price board, a food lot's menu, the
// potion shop (💎 shards, the same Shard Shop as the pawn shop), the mall directory, and a crate's rare
// prizes. Money and shards are the server's: these only send what you'd like to buy.
import { crateOdds, formatMoney, formatOneIn, isCollectible, potionPower, type MallLot } from '@kh/shared';
import type { App } from '../app';
import { el, toast } from './dom';
import { itemCard, openPanel, tierOf } from './panel';
import { sfx } from './sound';

/** A sign, notice, price board or display: its title and lines. */
export function openInfo(title: string, lines: string[]) {
  const panel = openPanel(title, { testId: 'prop-info' });
  panel.body.append(el('div', { class: 'prop-info' }, ...lines.map((l) => el('p', {}, l))));
}

/** 🍔 A food / drink lot's menu: buy something (RM, a little XP, maybe a small buff). */
export function openFood(app: App, lot: MallLot) {
  const panel = openPanel(`${lot.icon} ${lot.name}`, { testId: 'food-lot' });
  let busy = false;
  const render = () => {
    const rows = lot.menu.map((m) => {
      const b = el('button', { class: 'btn primary small', type: 'button', 'data-food': m.id }, formatMoney(m.priceSen)) as HTMLButtonElement;
      b.disabled = busy || app.store.walletSen < m.priceSen;
      b.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        render();
        app.socket?.timeout(6000).emit('mall:eat', { lot: lot.id, item: m.id }, (err, res) => {
          busy = false;
          if (err || !res.ok) {
            sfx.error();
            toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
            return render();
          }
          sfx.coin();
          app.store.walletSen = res.walletSen;
          app.store.emit();
          toast(res.text, 'good', 4000);
          render();
        });
      });
      const buff = m.buff ? `${m.buff.mult}× ${m.buff.kind === 'jobPay' ? 'job pay' : m.buff.kind === 'passive' ? 'passive income' : m.buff.kind === 'staffSpeed' ? 'cook speed' : m.buff.kind} for ${Math.round(m.buff.durationSec / 60)} min` : '';
      return el('div', { class: 'food-row' }, el('span', { class: 'food-icon' }, m.icon),
        el('span', { class: 'food-info' }, el('b', {}, m.name), el('small', { class: 'muted' }, [m.xp ? `+${m.xp} XP` : '', buff].filter(Boolean).join(' · ') || 'Just tasty.')), b);
    });
    panel.body.replaceChildren(el('p', { class: 'muted small' }, `You have ${formatMoney(app.store.walletSen)}. Eat in: a little XP, and some give a small boost for a while.`), ...rows);
  };
  render();
}

/** 🧪 A potion shop: every potion, for 💎 shards. */
export function openPotionShop(app: App, title: string) {
  const panel = openPanel(title, { testId: 'potion-shop', wide: true });
  const rar = app.cfg.rarities;
  const render = () => {
    const potions = app.cfg.items.items.filter((d) => d.effect && !isCollectible(d)).sort((a, b) => (a.shardPrice ?? 0) - (b.shardPrice ?? 0));
    const cards = potions.map((def) => {
      const price = def.shardPrice ?? app.cfg.economy.shardShopPrices[def.rarity];
      const have = app.store.inventory.filter((i) => i.itemId === def.id).length;
      const card = itemCard(rar, def, 'normal', { caption: price ? `${price} 💎` : 'Not sold', size: 56, count: have || undefined });
      card.title = `${def.name}: ${def.desc ?? ''}`;
      if (price) {
        card.classList.add('buyable');
        card.addEventListener('click', () =>
          app.socket?.timeout(6000).emit('shard:buy', { itemId: def.id }, (err, res) => {
            if (err || !res.ok) {
              sfx.error();
              return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
            }
            sfx.coin();
            app.store.addItems([res.item]);
            toast(`🧪 Bought ${def.name}`, 'good');
            render();
          }),
        );
      }
      return card;
    });
    const eg = potionPower(app.cfg.grades, { mult: 2, durationSec: 600 }, 'S', 'shiny+golden+rainbow');
    panel.body.replaceChildren(
      el('p', { class: 'muted' }, `You have ${app.store.shards} 💎. Tap a potion to buy it (it goes in your bag; drink it from there or the hotbar). Potions with a better tier and variants are stronger: a Striva Luck Potion gives ×${eg.mult} for ${Math.round((eg.durationSec ?? 0) / 60)} min. Reroll them at the Forge.`),
      el('div', { class: 'pool' }, ...cards),
    );
  };
  const off = app.store.on(render);
  panel.onClose = () => off();
  render();
}

/** 🗺️ A mall's directory: its lots, what each one is. */
export function openDirectory(name: string, lots: MallLot[]) {
  const kind = { food: '🍽️ Food', drink: '🥤 Drinks', potion: '🧪 Potions (💎)', retail: '🛍️ Shopping' } as const;
  const panel = openPanel(`🗺️ ${name}: directory`, { testId: 'mall-directory' });
  const groups = (['food', 'drink', 'potion', 'retail'] as const).map((k) => {
    const ls = lots.filter((l) => l.kind === k);
    if (!ls.length) return null;
    return el('div', { class: 'dir-group' }, el('h4', {}, kind[k]), ...ls.map((l) => el('div', { class: 'dir-row' }, `${l.icon} ${l.name}`, l.sale ? el('span', { class: 'dir-sale' }, ` 🔖 ${l.sale}`) : '')));
  });
  panel.body.append(...groups.filter((g): g is HTMLDivElement => !!g));
}

/** ✨ A crate's rarest prizes and their odds (posters and display cases in the capsule shop). */
export function openCratePrizes(app: App, crateId: string, title: string) {
  const crate = app.crates.get(crateId);
  if (!crate) return;
  const rar = app.cfg.rarities;
  const odds = crateOdds(rar, crate, app.items, app.mods().luck);
  const defs = crate.pool.map((id) => app.items.get(id)!).filter(Boolean).sort((a, b) => tierOf(rar, b.rarity).index - tierOf(rar, a.rarity).index).slice(0, 6);
  const panel = openPanel(title, { testId: 'crate-prizes', wide: true });
  panel.body.append(
    el('p', { class: 'muted' }, `From the ${crate.name} (${formatMoney(crate.priceSen)} a roll). The chance of each rarity, with your luck now:`),
    el('div', { class: 'muted small' }, odds.filter((o) => o.p > 0).map((o) => `${o.name} ${formatOneIn(o.oneIn)}`).join(' · ')),
    el('div', { class: 'pool' }, ...defs.map((d) => itemCard(rar, d, 'normal', { silhouette: !app.store.index.has(d.id), size: 56, caption: tierOf(rar, d.rarity).tier?.name }))),
  );
}

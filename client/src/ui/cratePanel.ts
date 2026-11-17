// Crate machine UI: odds (always visible), pity, the pool, and ×1/×5/×10 rolls.
import { crateOdds, formatMoney, formatOneIn, type InventoryItem } from '@kh/shared';
import type { App } from '../app';
import { el, toast } from './dom';
import { itemCard, openPanel } from './panel';
import { playReveal } from './reel';
import { sfx } from './sound';

export function openCratePanel(app: App, crateId: string) {
  const crate = app.crates.get(crateId);
  if (!crate) return;
  const rar = app.cfg.rarities;
  const panel = openPanel(crate.name, { wide: true, testId: 'crate-panel' });
  let busy = false;

  const render = () => {
    const st = app.store;
    const odds = crateOdds(rar, crate, app.items, 1);
    const pity = st.pity[crate.id] ?? { sinceEpic: 0, sinceLegendary: 0 };
    const head = el(
      'div',
      { class: 'crate-head' },
      el('div', { class: 'crate-art' }, el('span', {}, crate.id === 'capsule' ? '🎰' : crate.id === 'luckybag' ? '🧧' : '🎁')),
      el('div', {}, el('div', { class: 'crate-price' }, `${formatMoney(crate.priceSen)} per roll`), el('div', { class: 'muted' }, `You have ${formatMoney(st.walletSen)}`)),
    );
    head.querySelector<HTMLElement>('.crate-art')!.style.setProperty('--crate', crate.color);

    const table = el('table', { class: 'odds-table' }, el('tr', {}, el('th', {}, 'Rarity'), el('th', {}, 'Chance'), el('th', {}, 'Odds')));
    for (const o of odds) {
      const row = el(
        'tr',
        { class: o.p ? '' : 'none' },
        el('td', {}, el('span', { class: 'tier-dot' }), o.name),
        el('td', {}, o.p ? `${(o.p * 100).toFixed(o.p < 0.001 ? 4 : o.p < 0.01 ? 3 : 2)}%` : '—'),
        el('td', {}, o.p ? formatOneIn(o.oneIn) : 'not in this crate'),
      );
      row.querySelector<HTMLElement>('.tier-dot')!.style.background = o.color;
      table.append(row);
    }
    const pityBox = el(
      'div',
      { class: 'pity' },
      el('div', {}, `Epic+ guaranteed in `, el('b', {}, String(crate.pity.epic - pity.sinceEpic)), ' rolls'),
      el('div', {}, `Legendary+ guaranteed in `, el('b', {}, String(crate.pity.legendary - pity.sinceLegendary)), ' rolls'),
    );
    const pool = el('div', { class: 'pool' });
    for (const id of crate.pool) {
      const def = app.items.get(id)!;
      pool.append(itemCard(rar, def, 'normal', { silhouette: !st.index.has(id), size: 48 }));
    }
    const actions = el('div', { class: 'crate-actions' });
    for (const n of [1, 5, 10] as const) {
      const cost = crate.priceSen * n;
      const b = el('button', { class: `btn ${n === 1 ? 'primary' : ''}`, type: 'button', 'data-roll': String(n), disabled: busy || st.walletSen < cost }, `Roll ×${n}`, el('small', {}, formatMoney(cost)));
      b.addEventListener('click', () => roll(n));
      actions.append(b);
    }
    panel.body.replaceChildren(head, actions, el('h4', {}, 'Odds (luck ×1.00)'), table, pityBox, el('h4', {}, `Items (${crate.pool.filter((id) => st.index.has(id)).length}/${crate.pool.length} found)`), pool, el('p', { class: 'hint' }, 'All odds are shown. Rolls happen on the server.'));
  };

  const roll = (count: 1 | 5 | 10) => {
    if (busy || !app.socket?.connected) return;
    busy = true;
    render();
    sfx.click();
    app.socket.timeout(8000).emit('crate:roll', { crateId, count }, (err, res) => {
      busy = false;
      if (err || !res.ok) {
        sfx.error();
        toast(err ? 'The server did not respond.' : res.ok ? '' : res.error, 'bad');
        render();
        return;
      }
      const st = app.store;
      st.walletSen = res.walletSen;
      st.pity = { ...st.pity, [crateId]: res.pity };
      const now = Date.now();
      const items: InventoryItem[] = res.results.map((r) => ({ iid: r.iid, itemId: r.itemId, variant: r.variant, serial: r.serial, obtainedAt: now }));
      st.addItems(items);
      if (res.pageReward) st.pages.add(res.pageReward.crateId);
      panel.root.classList.add('hidden');
      playReveal({
        rar,
        items: app.items,
        crate,
        results: res.results,
        shake: (i) => app.town?.shake(i),
        onDone: (again) => {
          panel.root.classList.remove('hidden');
          if (res.pageReward) {
            sfx.coin();
            toast(`📖 ${crate.name} page complete! +${formatMoney(res.pageReward.sen)}`, 'good', 5000);
          }
          render();
          if (again) roll(count);
        },
      });
    });
  };

  const off = app.store.on(render);
  panel.onClose = () => off();
  render();
}

// Crate machine UI: odds (always visible), pity, the pool, and ×1/×5/×10 rolls.
import { crateOdds, effectivePity, formatMoney, formatOneIn, stageDef, type InventoryItem } from '@kh/shared';
import type { App } from '../app';
import { el, toast } from './dom';
import { itemCard, openPanel } from './panel';
import { playReveal } from './reel';
import { sfx } from './sound';

/** `remote`: a quick roll from the phone (same crate, + economy.phoneRollFee). */
export function openCratePanel(app: App, crateId: string, opts: { remote?: boolean } = {}) {
  const crate = app.crates.get(crateId);
  if (!crate) return;
  const rar = app.cfg.rarities;
  const remote = !!opts.remote;
  const feeMult = remote ? 1 + app.cfg.economy.phoneRollFee : 1;
  const panel = openPanel(`${remote ? '📱 ' : ''}${crate.name}`, { wide: true, testId: 'crate-panel' });
  let busy = false;
  /** Auto-Roll (a Hustle Skill): keep rolling the same count until stopped. */
  let auto = false;

  /** Why we can't roll this crate yet (level / wealth stage), or null. */
  const lockReason = () => {
    const pr = app.store.progress;
    const r = crate.requires;
    if (r.stage && pr.stage < r.stage) return `Opens at wealth stage ${r.stage}: ${stageDef(app.cfg.stages, r.stage).name} (${formatMoney(stageDef(app.cfg.stages, r.stage).minNetWorthSen)} net worth).`;
    if (r.level && pr.level < r.level) return `Opens at Level ${r.level} (you're Level ${pr.level}).`;
    return null;
  };

  const render = () => {
    const st = app.store;
    const mods = app.mods();
    const odds = crateOdds(rar, crate, app.items, mods.luck);
    const pityAt = effectivePity(crate, mods.pityMult);
    const pity = st.pity[crate.id] ?? { sinceEpic: 0, sinceLegendary: 0 };
    const lock = lockReason();
    const head = el(
      'div',
      { class: 'crate-head' },
      el('div', { class: 'crate-art' }, el('span', {}, crate.id === 'capsule' ? '🎰' : crate.id === 'luckybag' ? '🧧' : '🎁')),
      el('div', {}, el('div', { class: 'crate-price' }, `${formatMoney(Math.round(crate.priceSen * feeMult))} per roll`), remote ? el('div', { class: 'muted small' }, `📱 Phone roll: +${Math.round(app.cfg.economy.phoneRollFee * 100)}% fee (free at the machine)`) : null, el('div', { class: 'muted' }, `You have ${formatMoney(st.walletSen)}`)),
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
      el('div', {}, `Epic+ guaranteed in `, el('b', {}, String(Math.max(1, pityAt.epic - pity.sinceEpic))), ' rolls'),
      el('div', {}, `Legendary+ guaranteed in `, el('b', {}, String(Math.max(1, pityAt.legendary - pity.sinceLegendary))), ' rolls'),
    );
    const pool = el('div', { class: 'pool' });
    for (const id of crate.pool) {
      const def = app.items.get(id)!;
      pool.append(itemCard(rar, def, 'normal', { silhouette: !st.index.has(id), size: 48 }));
    }
    const actions = el('div', { class: 'crate-actions' });
    for (const n of [1, 5, 10] as const) {
      const cost = Math.round(crate.priceSen * n * feeMult);
      const b = el('button', { class: `btn ${n === 1 ? 'primary' : ''}`, type: 'button', 'data-roll': String(n), disabled: busy || !!lock || st.walletSen < cost }, `Roll ×${n}`, el('small', {}, formatMoney(cost)));
      b.addEventListener('click', () => roll(n));
      actions.append(b);
    }
    if (mods.autoRoll) {
      const a = el('label', { class: 'auto-toggle' }, el('input', { type: 'checkbox', checked: auto, 'data-action': 'auto-roll' }), ' 🔁 Auto');
      a.querySelector('input')!.addEventListener('change', (e) => (auto = (e.target as HTMLInputElement).checked));
      actions.append(a);
    }
    const luckNote = mods.luck > 1.0001 ? ` · ${mods.luckSources.map((x) => (x.type === 'potion' ? app.items.get(x.label ?? '')?.name ?? 'potion' : x.label ?? x.type)).join(', ')}` : '';
    panel.body.replaceChildren(head, ...(lock ? [el('div', { class: 'crate-lock', 'data-testid': 'crate-lock' }, `🔒 ${lock}`)] : []), actions, el('h4', {}, `Odds (luck ×${mods.luck.toFixed(2)}${luckNote})`), table, pityBox, el('h4', {}, `Items (${crate.pool.filter((id) => st.index.has(id)).length}/${crate.pool.length} found)`), pool, el('p', { class: 'hint' }, 'All odds are shown. Rolls happen on the server.'));
  };

  const roll = (count: 1 | 5 | 10) => {
    if (busy || !app.socket?.connected) return;
    busy = true;
    render();
    sfx.click();
    app.socket.timeout(8000).emit('crate:roll', { crateId, count, ...(remote ? { remote: true } : {}) }, (err, res) => {
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
      const items: InventoryItem[] = res.results.map((r) => ({ iid: r.iid, itemId: r.itemId, variant: r.variant, grade: r.grade, serial: r.serial, obtainedAt: now }));
      st.addItems(items);
      if (res.pageReward) st.pages.add(res.pageReward.crateId);
      panel.root.classList.add('hidden');
      const mods = app.mods();
      playReveal({
        rar,
        grades: app.cfg.grades,
        items: app.items,
        crate,
        results: res.results,
        luck: mods.luck,
        speed: mods.rollSpeed,
        auto: auto ? { isOn: () => auto && app.store.walletSen >= crate.priceSen * count * feeMult && !lockReason(), stop: () => (auto = false) } : undefined,
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

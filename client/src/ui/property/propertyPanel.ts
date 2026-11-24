// At a home's door: the units in this building, who owns them, prices, and Buy / Go in.
import { formatMoney, type BuiltBuilding } from '@kh/shared';
import type { App } from '../../app';
import { el, toast, keepUiState } from '../dom';
import { starName } from '../stars';
import { closePanel, openPanel } from '../panel';
import { sfx } from '../sound';

export function openPropertyPanel(app: App, b: BuiltBuilding) {
  const units = app.listings.filter((u) => u.building === b.id);
  const panel = openPanel(`🏠 ${b.name ?? app.cfg.properties.types[units[0]?.type ?? '']?.name ?? 'Homes'}`, { testId: 'property-panel' });
  const render = () => {
    const rows = units.map((u) => {
      const t = app.cfg.properties.types[u.type];
      const owner = app.store.props.get(u.id);
      const mine = owner?.owner === app.lastInit?.you.id;
      const label = el('div', { class: 'prop-unit-info' }, el('b', {}, `${t.icon} ${units.length > 1 ? `Unit ${u.n} · ` : ''}${t.name}`), el('div', { class: 'muted small' }, `${t.w * t.h} m² · ${u.loc > 1.05 ? `📍 prime location (+${Math.round((u.loc - 1) * 100)}%)` : 'quiet area'}`));
      let action: HTMLElement;
      if (mine) {
        action = el('button', { class: 'btn primary', type: 'button', 'data-enter': u.id }, '🚪 Go in');
        action.addEventListener('click', () => {
          closePanel();
          app.enterHome(u.id);
        });
      } else if (owner) {
        action = el('span', { class: 'muted' }, `Owned by ${starName(owner.ownerName)}${owner.mode === 'airbnb' ? ` · Airbnb ${owner.stars.toFixed(1)}★` : ''}`);
      } else {
        const req = t.requires.stage && app.store.progress.stage < t.requires.stage ? `Needs stage ${t.requires.stage}` : null;
        // Your first home is free (up to a price cap); there's a limit on how many you can own.
        const cl = app.cfg.properties.claim;
        const mine = app.store.myProps.length;
        const free = mine === 0 && u.priceSen <= cl.firstFreeMaxSen;
        const full = mine >= cl.maxHomes;
        const price = free ? 0 : u.priceSen;
        action = el(
          'button',
          { class: `btn${free ? ' primary' : ''}`, type: 'button', 'data-buy-unit': u.id, disabled: !!req || full || app.store.walletSen < price },
          req ?? (full ? `You have ${cl.maxHomes} homes` : free ? '🎁 Claim free (first home)' : `🏷️ Buy ${formatMoney(u.priceSen)}`),
        );
        action.addEventListener('click', () => {
          if (!confirm(free ? `Claim ${t.name}${units.length > 1 ? ` (unit ${u.n})` : ''} as your free first home?` : `Buy ${t.name}${units.length > 1 ? ` (unit ${u.n})` : ''} for ${formatMoney(u.priceSen)}?`)) return;
          app.socket?.timeout(5000).emit('prop:buy', { unit: u.id }, (err, res) => {
            if (err || !res.ok) {
              sfx.error();
              return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
            }
            sfx.fanfare();
            toast(`🔑 It's yours! Go in to decorate, or rent it out from 📱 → Properties.`, 'good', 5000);
          });
        });
      }
      return el('div', { class: `prop-unit${mine ? ' mine' : owner ? ' taken' : ''}` }, label, action);
    });
    panel.body.replaceChildren(
      el('p', { class: 'muted' }, 'Buy a home, then rent it to a tenant or run it as an Airbnb (decorate it for better stars). Manage everything from 📱 → Properties.'),
      el('div', { class: 'prop-units' }, ...rows),
    );
  };
  const off = app.store.on(() => keepUiState(panel.body, render));
  panel.onClose = () => off();
  render();
}

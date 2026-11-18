// At a home's door: the units in this building, who owns them, prices, and Buy / Go in.
import { formatMoney, type BuiltBuilding } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
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
        action = el('span', { class: 'muted' }, `Owned by ${owner.ownerName}${owner.mode === 'airbnb' ? ` · Airbnb ${owner.stars.toFixed(1)}★` : ''}`);
      } else {
        const req = t.requires.stage && app.store.progress.stage < t.requires.stage ? `Needs stage ${t.requires.stage}` : null;
        action = el('button', { class: 'btn', type: 'button', 'data-buy-unit': u.id, disabled: !!req || app.store.walletSen < u.priceSen }, req ?? `🏷️ Buy ${formatMoney(u.priceSen)}`);
        action.addEventListener('click', () => {
          if (!confirm(`Buy ${t.name}${units.length > 1 ? ` (unit ${u.n})` : ''} for ${formatMoney(u.priceSen)}?`)) return;
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
  const off = app.store.on(render);
  panel.onClose = () => off();
  render();
}

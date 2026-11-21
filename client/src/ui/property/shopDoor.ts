// At a shoplot door with a business downstairs and lofts upstairs: go in the shop, or up to the lofts.
import type { BuiltBuilding } from '@kh/shared';
import type { App } from '../../app';
import { el } from '../dom';
import { closePanel, openPanel } from '../panel';
import { openPropertyPanel } from './propertyPanel';

export function openShopDoor(app: App, b: BuiltBuilding, shopButton: string) {
  const me = app.lastInit?.you.id;
  const lofts = app.listings.filter((u) => u.building === b.id);
  const mine = lofts.filter((u) => app.store.props.get(u.id)?.owner === me);
  const free = lofts.filter((u) => !app.store.props.has(u.id)).length;
  const panel = openPanel('🚪 Shoplot', { testId: 'shop-door' });
  const shop = el('button', { class: 'btn primary', type: 'button', 'data-action': 'shop' }, shopButton);
  shop.addEventListener('click', () => {
    closePanel();
    app.enterBuilding(b);
  });
  const loftLabel = mine.length ? '🪜 Up to your loft' : free ? `🏷️ Lofts upstairs · ${free} for sale` : '🪜 Lofts upstairs (all owned)';
  const loft = el('button', { class: 'btn', type: 'button', 'data-action': 'lofts' }, loftLabel);
  loft.addEventListener('click', () => {
    // Your only loft: straight in. Otherwise the list (buy, or pick which).
    if (mine.length === 1 && !free) {
      closePanel();
      app.enterHome(mine[0].id);
    } else openPropertyPanel(app, b);
  });
  panel.body.append(el('div', { class: 'shop-door' }, shop, loft));
}

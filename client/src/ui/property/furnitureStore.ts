// IKEJA, the furniture store: buy Airbnb furniture in person. Pieces are grouped by category;
// each shows its stats (comfort, style, theme, essential/amenity) so you can plan a room.
import { formatMoney } from '@kh/shared';
import type { App } from '../../app';
import { el, toast, keepUiState } from '../dom';
import { itemCard, openPanel, tabs } from '../panel';
import { sfx } from '../sound';

export function openFurnitureStore(app: App) {
  const f = app.cfg.furniture;
  const panel = openPanel(`🛋️ ${f.storeName}`, { wide: true, testId: 'furniture-store' });
  const forSale = Object.entries(f.pieces).filter(([, p]) => p.storeSen);
  const cats = [...new Set(forSale.map(([, p]) => p.category))];
  let cat = 0;
  const grid = el('div', { class: 'item-grid furniture-grid' });
  const render = () => {
    const owned = (id: string) => app.store.inventory.filter((i) => i.itemId === id).length;
    grid.replaceChildren(
      ...forSale
        .filter(([, p]) => p.category === cats[cat])
        .map(([id, p]) => {
          const def = app.items.get(id);
          if (!def) return el('div');
          const card = itemCard(app.cfg.rarities, def, 'normal', { caption: formatMoney(p.storeSen!), count: owned(id) });
          const tags = [
            p.essential ? `⭐ essential: ${p.essential}` : '',
            p.amenity ? `✨ amenity: ${p.amenity}` : '',
            p.theme ? `🎨 ${f.themes[p.theme]?.name ?? p.theme}` : '',
            `🛏️ comfort ${p.comfort} · 💅 style ${p.style} · ${p.w}×${p.h} m${p.wall ? ' · wall' : ''}`,
          ].filter(Boolean);
          const buy = el('button', { class: 'btn small primary', type: 'button', 'data-buy': id }, `Buy ${formatMoney(p.storeSen!)}`);
          buy.addEventListener('click', () => {
            buy.disabled = true;
            app.socket?.timeout(5000).emit('furniture:buy', { item: id, qty: 1 }, (err, res) => {
              buy.disabled = false;
              if (err || !res.ok) {
                sfx.error();
                return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
              }
              sfx.coin();
              toast(`🛋️ Bought ${def.name}. Place it from your home's Decorate mode.`, 'good');
            });
          });
          return el('div', { class: 'furniture-card' }, card, el('div', { class: 'muted small' }, ...tags.map((t) => el('div', {}, t))), buy);
        }),
    );
  };
  const t = tabs(cats.map((c) => c[0].toUpperCase() + c.slice(1)), (i) => {
    cat = i;
    render();
  });
  panel.body.replaceChildren(el('p', { class: 'muted' }, 'Essentials (bed, toilet, shower, kitchen, aircond, wifi) unlock good ratings. Matching themes and rare pieces from the Mall Mystery Box push you towards 5★.'), t, grid);
  const off = app.store.on(() => keepUiState(panel.body, render));
  panel.onClose = () => off();
  render();
}

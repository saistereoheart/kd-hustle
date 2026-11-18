// Gergasi Hypermarket: buy stall ingredients in person (no delivery fee).
import type { App } from '../../app';
import { el, keepUiState } from '../dom';
import { openPanel } from '../panel';
import { stockList } from './stock';

export function openMarketPanel(app: App) {
  const panel = openPanel('🛒 Gergasi Hypermarket', { testId: 'market-panel' });
  const render = () => panel.body.replaceChildren(el('p', { class: 'muted' }, 'Wholesale ingredients for your stall. Cheaper in bulk.'), stockList(app, false));
  const off = app.store.on(() => keepUiState(panel.body, render));
  panel.onClose = () => off();
  render();
}

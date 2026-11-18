// Your stall's stock, down the right-hand side of the screen (instead of a sign over the stall):
// a big drawn icon per dish / add-on with "x <count>". Hover (or tap) stretches it to show the
// name. Shown while your stall is open or you're near it.
import { menuRecipes, stockCount } from '@kh/shared';
import type { App } from '../app';
import { el, uiRoot } from './dom';
import { foodIcon } from './stall/foodArt';

export class StockHud {
  private root = el('div', { class: 'stock-hud hidden', 'data-testid': 'stock-hud' });
  private sig = '';
  private timer: number;
  private off: () => void;

  constructor(private app: App) {
    uiRoot().append(this.root);
    this.off = app.store.on(() => this.render());
    this.timer = window.setInterval(() => this.render(), 1000);
    this.render();
  }

  private visible(): boolean {
    const st = this.app.store.stall;
    if (!st) return false;
    if (this.app.store.stalls.get(st.plot)?.open) return true;
    const plot = this.app.map.stallPlots.find((p) => p.id === st.plot);
    const me = this.app.town?.position;
    const T = this.app.map.tileSize;
    return !!plot && !!me && Math.hypot(me.x / T - plot.x, me.y / T - plot.y) < 40;
  }

  private render() {
    const st = this.app.store.stall;
    const show = this.visible();
    this.root.classList.toggle('hidden', !show);
    if (!show || !st) return;
    const items = menuRecipes(this.app.cfg.stalls, this.app.cfg.recipes.recipes, st).flatMap((r) => [
      { id: r.id, name: r.name, qty: stockCount(st, r.id), addon: false },
      ...r.addons.map((a) => ({ id: a.id, name: a.name, qty: stockCount(st, a.id), addon: true })),
    ]);
    const sig = items.map((i) => `${i.id}:${i.qty}`).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    this.root.replaceChildren(
      ...items.map((i) => {
        const pill = el(
          'button',
          { class: `stock-pill${i.addon ? ' addon' : ''}${i.qty <= 0 ? ' out' : i.qty <= 5 ? ' low' : ''}`, type: 'button', 'data-item': i.id, 'aria-label': `${i.name}: ${i.qty}` },
          foodIcon(i.id, 38),
          el('span', { class: 'stock-pill-name' }, i.name),
          el('b', { class: 'stock-pill-qty' }, `x ${i.qty}`),
        );
        pill.addEventListener('click', () => pill.classList.toggle('open'));
        return pill;
      }),
    );
  }

  destroy() {
    this.off();
    clearInterval(this.timer);
    this.root.remove();
  }
}

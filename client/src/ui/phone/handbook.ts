// 📘 Handbook: step-by-step guides on how to play (text in guide.json), plus every tip.
import type { PhoneCtx } from './phone';
import { closePanel } from '../panel';
import { el } from '../dom';

let open = 'start';

export function renderHandbook({ app, rerender }: PhoneCtx): HTMLElement[] {
  const g = app.cfg.guide;
  const chapters = g.handbook.map((c) => {
    const isOpen = c.id === open;
    const head = el('button', { class: `hb-head${isOpen ? ' open' : ''}`, type: 'button', 'data-chapter': c.id }, el('span', { class: 'hb-icon' }, c.icon), el('span', {}, c.title), el('span', { class: 'hb-caret' }, isOpen ? '▾' : '▸'));
    head.addEventListener('click', () => {
      open = isOpen ? '' : c.id;
      rerender();
    });
    const body = isOpen ? el('ol', { class: 'hb-steps' }, ...c.steps.map((s) => el('li', {}, s))) : null;
    return el('div', { class: 'hb-chapter' }, head, ...(body ? [body] : []));
  });
  // Shortcut to the map's signposts.
  const places = el('div', { class: 'hb-places' }, el('h4', {}, '📍 Take me to…'), ...app.guide!.pois.filter((p) => p.kind !== 'soon').map((p) => {
    const b = el('button', { class: 'btn small', type: 'button' }, `${p.icon} ${p.label}`);
    b.addEventListener('click', () => {
      app.guide?.point(p.id);
      closePanel();
    });
    return b;
  }));
  const tips = el('details', { class: 'hb-tips' }, el('summary', {}, `💡 All tips (${g.hints.length})`), el('ul', {}, ...g.hints.map((h) => el('li', {}, h))));
  return [el('p', { class: 'hint' }, 'New here? Start at the top. Tap a chapter to open it.'), ...chapters, places, tips];
}

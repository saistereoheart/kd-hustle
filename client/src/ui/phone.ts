// 📱 Phone (key P). For now: order or ride vehicles, plus shortcuts. Phase 3 grows it into the
// full HustlePhone (quests, skills, leaderboards...).
import { formatMoney } from '@kh/shared';
import type { App } from '../app';
import { el } from './dom';
import { closePanel, openPanel } from './panel';

export function openPhonePanel(app: App) {
  const panel = openPanel('📱 Phone', { testId: 'phone-panel' });
  const render = () => {
    const st = app.store;
    const rides = Object.entries(app.cfg.vehicles.vehicles).map(([id, v]) => {
      const owned = st.vehicles.includes(id);
      const riding = st.riding === id;
      const actions = el('div', { class: 'phone-actions' });
      const button = (label: string, action: string, fn: () => void, primary = true, disabled = false) => {
        const b = el('button', { class: `btn${primary ? ' primary' : ''}`, type: 'button', 'data-action': action, disabled }, label);
        b.addEventListener('click', fn);
        actions.append(b);
      };
      if (riding) button(v.orderSen ? 'Return it' : 'Hop off', `ride-off-${id}`, () => app.ride(null), false);
      else if (owned) button('Ride', `ride-${id}`, () => app.ride(id));
      else if (v.orderSen) {
        button(`Order · ${formatMoney(v.orderSen)}`, `order-${id}`, () => app.orderVehicle(id), true, st.walletSen < v.orderSen || st.job?.kind === 'carwash');
      }
      if (!st.hotbar.some((h) => h?.kind === 'vehicle' && h.id === id) && (owned || v.orderSen)) {
        button('Add to hotbar', `hotbar-${id}`, () => {
          const free = st.hotbar.findIndex((h) => !h);
          if (free >= 0) app.setHotbarSlot(free, { kind: 'vehicle', id });
        }, false, !st.hotbar.some((h) => !h));
      }
      const note = v.starter
        ? 'Yours to keep. Rides on paths, sidewalks and footbridges, not highways.'
        : v.orderSen
          ? `Delivered to you right away. ${v.grid === 'drive' ? 'Roads and highways; fast tips on deliveries.' : ''} Returned when you hop off.`
          : '';
      return el(
        'div',
        { class: `job-card phone-ride${riding ? ' active' : ''}`, 'data-ride': id },
        el('div', { class: 'job-icon' }, v.icon),
        el('div', { class: 'job-info' }, el('h4', {}, v.name, riding ? el('span', { class: 'lv-badge' }, 'Riding') : null), el('p', {}, note)),
        actions,
      );
    });
    const shortcut = (icon: string, label: string, fn: () => void) => {
      const b = el('button', { class: 'phone-app', type: 'button' }, el('span', {}, icon), label);
      b.addEventListener('click', () => {
        closePanel();
        fn();
      });
      return b;
    };
    panel.body.replaceChildren(
      el('h4', { class: 'phone-section' }, '🚦 Rides'),
      ...rides,
      el('h4', { class: 'phone-section' }, 'Apps'),
      el(
        'div',
        { class: 'phone-apps' },
        shortcut('🗺️', 'Map', () => app.minimap?.openFull()),
        shortcut('🎒', 'Bag', () => app.openBag()),
        shortcut('⚙️', 'Settings', () => app.openSettingsPanel()),
      ),
      el('p', { class: 'hint' }, 'More apps (quests, skills, leaderboards) arrive with the HustlePhone in Phase 3.'),
    );
  };
  const off = app.store.on(render);
  panel.onClose = () => off();
  render();
}

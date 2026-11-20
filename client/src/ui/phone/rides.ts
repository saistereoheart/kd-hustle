// HustlePhone → Ronda: hail a ride (point A to point B for a fare), or hop on a vehicle you own.
import { formatMoneyExact } from '@kh/shared';
import { el } from '../dom';
import { isShowroomVehicle, resolveLook, vehicleIconUrl } from '../../items/carArt';
import type { PhoneCtx } from './phone';

export function renderRides({ app }: PhoneCtx): HTMLElement[] {
  const st = app.store;
  const rc = app.cfg.rides;
  const hail = el('button', { class: 'btn primary', type: 'button', 'data-action': 'open-ronda', disabled: !!app.rideHud || st.job?.kind === 'carwash' }, app.rideHud ? 'On a ride' : 'Where to?');
  hail.addEventListener('click', () => app.openRonda());
  const ronda = el(
    'div',
    { class: 'job-card phone-ride ronda-card', 'data-ride': 'ronda' },
    el('div', { class: 'job-icon' }, '🛵'),
    el('div', { class: 'job-info' },
      el('h4', {}, rc.appName),
      el('p', {}, `Pick a spot on the map and a kapcai rider takes you there along the roads. From ${formatMoneyExact(rc.minFareSen)}: ${formatMoneyExact(rc.baseFareSen)} + ${formatMoneyExact(rc.perKmSen)}/km.`)),
    el('div', { class: 'phone-actions' }, hail),
  );
  const ownLook = (id: string) => {
    const o = st.garage?.owned[id];
    return o ? { paint: o.paint, wheel: o.wheel, exhaust: o.exhaust } : null;
  };
  // Rides you own (the starter bicycle for now).
  const rides = Object.entries(app.cfg.vehicles.vehicles).filter(([id]) => st.vehicles.includes(id)).map(([id, v]) => {
    const riding = st.riding === id;
    const actions = el('div', { class: 'phone-actions' });
    const button = (label: string, action: string, fn: () => void, primary = true, disabled = false) => {
      const b = el('button', { class: `btn${primary ? ' primary' : ''}`, type: 'button', 'data-action': action, disabled }, label);
      b.addEventListener('click', fn);
      actions.append(b);
    };
    const out = app.town ? st.myParked(app.town.selfId) : null;
    if (riding) button('Park + get out', `ride-off-${id}`, () => app.ride(null), false);
    else button(out?.vehicle === id ? 'Bring it here' : 'Put it down', `ride-${id}`, () => app.ride(id), true, !!app.rideHud);
    if (out?.vehicle === id && !riding) button('Put away', `ride-away-${id}`, () => app.putAwayVehicle(), false);
    if (!st.hotbar.some((h) => h?.kind === 'vehicle' && h.id === id)) {
      button('Add to hotbar', `hotbar-${id}`, () => {
        const free = st.hotbar.findIndex((h) => !h);
        if (free >= 0) app.setHotbarSlot(free, { kind: 'vehicle', id });
      }, false, !st.hotbar.some((h) => !h));
    }
    const note = v.starter ? 'Yours to keep. Rides on paths, sidewalks and footbridges, not highways.' : '';
    return el(
      'div',
      { class: `job-card phone-ride${riding ? ' active' : ''}`, 'data-ride': id },
      el('div', { class: 'job-icon' }, isShowroomVehicle(id) ? el('img', { src: vehicleIconUrl(id, resolveLook(id, ownLook(id)), 96), alt: v.name, class: 'vehicle-icon' }) : v.icon),
      el('div', { class: 'job-info' }, el('h4', {}, v.name, riding ? el('span', { class: 'lv-badge' }, 'Riding') : null), el('p', {}, note)),
      actions,
    );
  });
  return [ronda, ...rides];
}

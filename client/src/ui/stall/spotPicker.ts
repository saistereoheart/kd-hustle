// Pick where your stall goes: a free spot of a tier (for a kopitiam: any free shoplot in town),
// nearest to you first, or a random one. Used when buying a tier and when moving (moving only
// costs the tier's moving fee; you keep everything).
import { formatMoney, tierDef } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { closePanel, openPanel } from '../panel';
import { sfx } from '../sound';

export function openSpotPicker(app: App, tier: number, mode: 'buy' | 'move') {
  const def = tierDef(app.cfg.stalls, tier);
  const panel = openPanel(mode === 'buy' ? `${def.icon} Pick your ${def.name} spot` : `🚚 Move your ${def.name}`, { testId: 'spot-picker' });
  const taken = new Set([...app.store.stalls.values()].map((s) => s.plot));
  const ventureLots = new Set(app.store.shoplots.map((s) => s.building));
  for (const p of app.map.stallPlots) if (p.building && ventureLots.has(p.building)) taken.add(p.id);
  const mine = app.store.stall?.plot;
  const T = app.map.tileSize;
  const me = app.town?.position ?? app.map.spawnPx;
  const free = app.map.stallPlots
    .filter((p) => p.tier === tier && !taken.has(p.id) && p.id !== mine)
    .map((p) => ({ p, d: Math.hypot(p.x - me.x / T, p.y - me.y / T) * app.map.metersPerTile }))
    .sort((a, b) => a.d - b.d);
  // A place name for a spot: the nearest signposted place.
  const near = (x: number, y: number) => {
    let best: { label: string; d: number } | null = null;
    for (const poi of app.guide?.pois ?? []) {
      const d = Math.hypot(poi.x - x, poi.y - y);
      if (!best || d < best.d) best = { label: poi.label, d };
    }
    return best ? `near ${best.label[0]}${best.label.slice(1).toLowerCase()}` : '';
  };
  const cost = mode === 'buy' ? def.priceSen : def.moveFeeSen;
  const send = (plot?: string) => {
    const done = (err: Error | null, res: { ok: boolean; error?: string }) => {
      if (err || !res.ok) {
        sfx.error();
        return void toast(err ? 'No response.' : (res.error ?? ''), 'bad');
      }
      sfx.fanfare();
      closePanel();
      toast(mode === 'buy' ? `${def.icon} Your ${def.name} is ready!` : `🚚 Moved! Your stock, staff, upgrades and reputation came along.`, 'good', 5000);
      const p = app.map.stallPlots.find((x) => x.id === app.store.stall?.plot);
      if (p) app.guide?.pointAt({ id: p.id, label: `YOUR ${def.name.toUpperCase()}`, icon: def.icon, x: p.x, y: p.y });
    };
    if (mode === 'buy') app.socket?.timeout(6000).emit('stall:buy', { tier, ...(plot ? { plot } : {}) }, done as never);
    else app.socket?.timeout(6000).emit('stall:move', plot ? { plot } : {}, done as never);
  };
  const rnd = el('button', { class: 'btn primary', type: 'button', 'data-action': 'spot-random', disabled: !free.length || app.store.walletSen < cost }, `🎲 Any free spot`, el('small', {}, cost ? formatMoney(cost) : 'free'));
  rnd.addEventListener('click', () => send());
  const rows = free.slice(0, 15).map(({ p, d }) => {
    const pick = el('button', { class: 'btn small primary', type: 'button', 'data-spot': p.id, disabled: app.store.walletSen < cost }, 'Choose');
    pick.addEventListener('click', () => {
      if (confirm(`${mode === 'buy' ? 'Open' : 'Move'} your ${def.name} here (${Math.round(d)} m away)${cost ? ` for ${formatMoney(cost)}` : ''}?`)) send(p.id);
    });
    const show = el('button', { class: 'btn small', type: 'button' }, '📍 Show');
    show.addEventListener('click', () => {
      closePanel();
      app.guide?.pointAt({ id: p.id, label: `FREE ${def.name.toUpperCase()} SPOT`, icon: def.icon, x: p.x, y: p.y });
    });
    return el('div', { class: 'prop-unit' }, el('div', { class: 'prop-unit-info' }, el('b', {}, `${def.icon} ${p.building ? 'Shoplot' : 'Spot'} ${near(p.x, p.y)}`), el('div', { class: 'muted small' }, `${Math.round(d)} m from you`)), el('span', {}, show, ' ', pick));
  });
  panel.body.replaceChildren(
    el('p', { class: 'muted' }, mode === 'buy'
      ? `${free.length} free spots. ${tier === app.cfg.stalls.cashierFromTier ? 'Any free shoplot in town can be your kopitiam: walk near the area you like and open this again to see the closest ones.' : ''}`
      : `Moving costs ${cost ? formatMoney(cost) : 'nothing'}, not the ${def.name} price again. You keep your stock, cooks, upgrades and reputation; the queue stays behind.`),
    rnd,
    el('h4', {}, 'Closest to you'),
    free.length ? el('div', { class: 'prop-units' }, ...rows) : el('p', { class: 'empty' }, `All the ${def.name} spots are taken.`),
  );
}

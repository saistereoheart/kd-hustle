// 🏪 Move a Venture to another free shoplot: the closest free ones to you (show it on the map or
// move there), for the moving fee. A shoplot holds one business: a Venture or a kopitiam.
import { formatMoney } from '@kh/shared';
import type { App } from '../app';
import { el, toast } from './dom';
import { closePanel, openPanel } from './panel';
import { sfx } from './sound';

export function openVentureSpotPicker(app: App, type: string) {
  const t = app.cfg.businesses.types.find((x) => x.id === type);
  if (!t) return;
  const fee = app.cfg.businesses.moveFeeSen;
  const panel = openPanel(`🚚 Move your ${t.name}`, { testId: 'venture-spot-picker' });
  const T = app.map.tileSize;
  const me = app.town?.position ?? app.map.spawnPx;
  // Free: a kopitiam shoplot nobody uses (no kopitiam there, no Venture there).
  const kopitiams = new Set([...app.store.stalls.values()].map((s) => app.map.stallPlots.find((p) => p.id === s.plot)?.building).filter(Boolean));
  const ventures = new Set(app.store.shoplots.map((s) => s.building));
  const seen = new Set<string>();
  const free = app.map.stallPlots
    .filter((p) => p.building && p.tier >= app.cfg.stalls.cashierFromTier && !kopitiams.has(p.building) && !ventures.has(p.building))
    .filter((p) => (seen.has(p.building!) ? false : (seen.add(p.building!), true)))
    .map((p) => ({ building: p.building!, x: p.x, y: p.y, d: Math.hypot(p.x - me.x / T, p.y - me.y / T) * app.map.metersPerTile }))
    .sort((a, b) => a.d - b.d);
  const near = (x: number, y: number) => {
    let best: { label: string; d: number } | null = null;
    for (const poi of app.guide?.pois ?? []) {
      const d = Math.hypot(poi.x - x, poi.y - y);
      if (!best || d < best.d) best = { label: poi.label, d };
    }
    return best ? `near ${best.label[0]}${best.label.slice(1).toLowerCase()}` : '';
  };
  const rows = free.slice(0, 15).map((f) => {
    const pick = el('button', { class: 'btn small primary', type: 'button', 'data-shoplot': f.building, disabled: app.store.walletSen < fee }, 'Move here');
    pick.addEventListener('click', () => {
      if (!confirm(`Move your ${t.name} to this shoplot (${Math.round(f.d)} m away)${fee ? ` for ${formatMoney(fee)}` : ''}?`)) return;
      app.socket?.timeout(6000).emit('biz:move', { type, building: f.building }, (err, res) => {
        if (err || !res.ok) {
          sfx.error();
          return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        }
        sfx.fanfare();
        closePanel();
        toast(`🚚 ${t.name} moved!`, 'good', 4000);
        app.guide?.pointAt({ id: `biz:${type}`, label: `YOUR ${t.name.toUpperCase()}`, icon: t.icon, x: f.x, y: f.y });
      });
    });
    const show = el('button', { class: 'btn small', type: 'button' }, '📍 Show');
    show.addEventListener('click', () => {
      closePanel();
      app.guide?.pointAt({ id: `lot:${f.building}`, label: 'FREE SHOPLOT', icon: '🏪', x: f.x, y: f.y });
    });
    return el('div', { class: 'prop-unit' }, el('div', { class: 'prop-unit-info' }, el('b', {}, `🏪 Shoplot ${near(f.x, f.y)}`), el('div', { class: 'muted small' }, `${Math.round(f.d)} m from you`)), el('span', {}, show, ' ', pick));
  });
  panel.body.replaceChildren(
    el('p', { class: 'muted' }, `${free.length} free shoplots. Walk near the area you like and open this again to see the closest ones. Moving costs ${fee ? formatMoney(fee) : 'nothing'}; levels, managers and earnings stay.`),
    el('h4', {}, 'Closest to you'),
    free.length ? el('div', { class: 'prop-units' }, ...rows) : el('p', { class: 'empty' }, 'Every shoplot in town is taken.'),
  );
}

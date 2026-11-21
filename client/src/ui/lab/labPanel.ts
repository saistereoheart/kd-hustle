// 🗝️ Labirin Purba in the phone: your coins, how deep you've been, and the way in.
import { labFloor, type LabSelf } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { closePanel, openPanel } from '../panel';
import { coinIcon } from './labHud';

export function openLabPanel(app: App) {
  const lc = app.cfg.lab;
  const panel = openPanel(`🗝️ ${lc.name}`, { testId: 'lab-panel' });
  const body = el('div', { class: 'lab-panel' }, el('p', { class: 'muted' }, 'Loading…'));
  panel.body.append(body);
  const render = (s: LabSelf) => {
    const saveFloor = lc.floors[s.save.floor];
    const atEntrance = s.save.floor === 0 && s.save.room === labFloor(lc, 0).start;
    const enter = (at: 'save' | 'entrance') => {
      if (app.interior || app.home) return void toast('Step outside first.', 'bad');
      app.socket?.timeout(6000).emit('lab:enter', { at }, (err, res) => {
        if (err || !res.ok) return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        closePanel();
        app.enterLab(res.view);
      });
    };
    const main = el('button', { class: 'btn primary', type: 'button', 'data-action': 'lab-enter' }, atEntrance ? '▶ Enter the labyrinth' : `▶ Continue at your rest chamber (B${s.save.floor + 1} · ${saveFloor.name})`);
    main.addEventListener('click', () => enter('save'));
    const fromTop = atEntrance ? null : el('button', { class: 'btn', type: 'button' }, '🏙️ Start at the entrance hall');
    fromTop?.addEventListener('click', () => enter('entrance'));
    body.replaceChildren(
      el('p', {}, "Walk it yourself, room by room. Down here you're in a weakened state: your town gear, luck and skills stay outside. Find loot boxes, keys to locked treasure rooms, and the hidden 🔥 rest chamber on each floor (your save point)."),
      el('div', { class: 'lab-stats' },
        el('div', {}, coinIcon(), el('b', {}, ` ${s.coins}`), el('span', { class: 'muted small' }, ' Syiling Purba (only spent down there)')),
        el('div', {}, el('b', {}, `B${s.deepest + 1}`), el('span', { class: 'muted small' }, ` deepest of ${lc.floors.length} floors`)),
      ),
      el('div', { class: 'actions' }, main, fromTop),
      el('p', { class: 'muted small' }, 'Coins you pick up are carried until you rest at a campfire or leave. Leave from the entrance hall or a rest chamber.'),
    );
  };
  app.socket?.timeout(6000).emit('lab:self', (err, res) => {
    if (err || !res.ok) return void body.replaceChildren(el('p', { class: 'muted' }, 'No response.'));
    render(res.self);
  });
}

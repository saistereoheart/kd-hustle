// 🗝️ Labirin Purba in the phone: your coins, how deep you've been, and the way in.
import { labFloor, type LabSelf } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { closePanel, openPanel } from '../panel';
import { coinIcon } from './labHud';
import { openLabBag } from './labBag';
import { openLabParty } from './labParty';
import { startWarp } from './warp';

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
      // 🌀 The warp starts at once and covers the switch (it waits for the server's answer).
      const warp = startWarp();
      app.socket?.timeout(6000).emit('lab:enter', { at }, (err, res) => {
        if (err || !res.ok) {
          warp.cancel();
          return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        }
        closePanel();
        warp.done(() => app.enterLab(res.view, res.battle));
      });
    };
    const main = el('button', { class: 'btn primary', type: 'button', 'data-action': 'lab-enter' }, atEntrance ? '▶ Enter the labyrinth' : `▶ Continue at your rest chamber (B${s.save.floor + 1} · ${saveFloor.name})`);
    main.addEventListener('click', () => enter('save'));
    const fromTop = atEntrance ? null : el('button', { class: 'btn', type: 'button' }, '🏙️ Start at the entrance hall');
    fromTop?.addEventListener('click', () => enter('entrance'));
    const bag = el('button', { class: 'btn', type: 'button', 'data-action': 'lab-bag' }, '🎒 Gear & potions');
    bag.addEventListener('click', () => openLabBag(app, 'gear'));
    const party = el('button', { class: 'btn', type: 'button', 'data-action': 'lab-party' }, app.labParty ? `👥 Party (${app.labParty.members.length})` : '👥 Party');
    party.addEventListener('click', () => openLabParty(app));
    body.replaceChildren(
      el('p', {}, "Walk it yourself, room by room. Down here you're in a weakened state: your town gear, luck and skills stay outside, and your Teman don't fight. Monsters jump out in some rooms (Pokémon style). Find loot boxes, keys to locked treasure rooms, and the hidden 🔥 rest chamber on each floor (your save point; it heals you)."),
      el('div', { class: 'lab-stats' },
        el('div', {}, coinIcon(), el('b', {}, ` ${s.coins}`), el('span', { class: 'muted small' }, ' Syiling Purba (only spent down there)')),
        el('div', {}, el('b', {}, `B${s.deepest + 1}`), el('span', { class: 'muted small' }, ` deepest of ${lc.floors.length} floors`)),
        el('div', {}, el('b', {}, `❤️ ${s.hp}/${s.maxHp} · 🔷 ${s.mana}/${s.maxMana}`), el('span', { class: 'muted small' }, ' HP · mana down there')),
        el('div', { title: 'Teman stay out of the fights down there. Your lead Teman (first in your team) gives a small boost by rarity, tier and variant.' }, el('b', {}, `🐾 +${(s.boost * 100).toFixed(1)}%`), el('span', { class: 'muted small' }, ' lead Teman boost (ATK, DEF, HP)')),
      ),
      el('div', { class: 'lab-stats' },
        el('div', {}, el('b', {}, `⚔️ ${s.stats.atk} · 🛡️ ${s.stats.def}`), el('span', { class: 'muted small' }, ' ATK · DEF with your Labirin gear')),
        el('div', {}, el('b', {}, `🧪 ${Object.values(s.potions).reduce((a, n) => a + n, 0)}`), el('span', { class: 'muted small' }, ' potions carried')),
      ),
      el('div', { class: 'actions' }, main, fromTop, bag, party),
      el('p', { class: 'muted small' }, 'Coins you pick up are carried until you rest at a campfire or leave. Leave from the entrance hall or a rest chamber. Gear and potions are sold by Tok Peraih in the entrance hall and every rest chamber.'),
    );
  };
  app.socket?.timeout(6000).emit('lab:self', (err, res) => {
    if (err || !res.ok) return void body.replaceChildren(el('p', { class: 'muted' }, 'No response.'));
    render(res.self);
  });
}

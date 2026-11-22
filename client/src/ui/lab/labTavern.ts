// 🍵 Labirin Purba: the tavern in the entrance hall. A drink buffs you for your next few fights
// (one at a time: a new one replaces the old). Paid in Syiling, carried first. The server checks it.
import type { LabSelf } from '@kh/shared';
import type { App } from '../../app';
import { el, labSay } from '../dom';
import { openPanel } from '../panel';
import { sfx } from '../sound';
import { coinIcon } from './labHud';

export function openLabTavern(app: App) {
  const t = app.cfg.lab.tavern;
  const panel = openPanel(`🍵 ${t.name}`, { testId: 'lab-tavern' });
  const body = el('div', { class: 'lab-tavern' });
  panel.body.append(body);
  let self: LabSelf | null = app.labHud?.self ?? null;
  let busy = false;

  const render = () => {
    const s = self;
    const active = s?.drink ? t.drinks.find((d) => d.id === s.drink!.id) : undefined;
    body.replaceChildren(
      el('p', { class: 'lab-tavern-line' }, el('b', {}, `${t.keeper}: `), `"${t.line}"`),
      el('p', { class: 'muted small' }, 'A drink works for your next few fights. One at a time: a new one replaces the one you have.'),
      active && s?.drink
        ? el('div', { class: 'lab-tavern-active' }, `${active.icon} ${active.name} is working: `, el('b', {}, `${s.drink.left} fight${s.drink.left === 1 ? '' : 's'} left`))
        : el('div', { class: 'lab-tavern-active none' }, 'No drink working right now.'),
      (() => {
        const r = app.cfg.lab.spells.roll;
        const b = el('button', { class: 'btn primary small', type: 'button', 'data-action': 'lab-roll' }, s?.rolled ? '✓ Rolled today' : '🎲 Roll ', s?.rolled ? '' : coinIcon(), s?.rolled ? '' : ` ${r.price}`) as HTMLButtonElement;
        b.disabled = busy || !!s?.rolled;
        b.addEventListener('click', roll);
        return el('div', { class: 'lab-tavern-roll' },
          el('div', { class: 'lab-tavern-icon' }, '🎲'),
          el('div', { class: 'lab-tavern-text' }, el('b', {}, 'Daily roll: Kitab Bertuah'), el('small', {}, `Once a day: ${Math.round(r.bookChance * 100)}% chance of a 📜 spell book you don't have (even one ${app.cfg.lab.merchant.name} never sells). Otherwise a drink on the house.`)),
          b);
      })(),
      el('div', { class: 'lab-tavern-list' },
        ...t.drinks.map((d) => {
          const buy = el('button', { class: 'btn primary small', type: 'button', 'data-drink': d.id }, coinIcon(), ` ${d.price}`) as HTMLButtonElement;
          buy.disabled = busy;
          buy.addEventListener('click', () => order(d.id));
          return el('div', { class: 'lab-tavern-item' },
            el('div', { class: 'lab-tavern-icon' }, d.icon),
            el('div', { class: 'lab-tavern-text' }, el('b', {}, d.name), el('small', {}, d.desc)),
            buy);
        })),
      s ? el('div', { class: 'muted small' }, coinIcon(), ` ${s.coins + s.carried} Syiling (${s.coins} banked${s.carried ? ` + ${s.carried} carried` : ''})`) : '',
    );
  };

  const roll = () => {
    if (busy) return;
    busy = true;
    render();
    app.socket?.timeout(6000).emit('lab:roll', (err, res) => {
      busy = false;
      if (err || !res.ok) {
        sfx.error();
        labSay(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        return render();
      }
      sfx.coin();
      self = res.self;
      app.labHud?.updateSelf(res.self);
      labSay(res.text, 'good', 5000);
      render();
    });
  };

  const order = (id: string) => {
    if (busy) return;
    busy = true;
    render();
    app.socket?.timeout(6000).emit('lab:drink', { id }, (err, res) => {
      busy = false;
      if (err || !res.ok) {
        sfx.error();
        labSay(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        return render();
      }
      sfx.coin();
      self = res.self;
      app.labHud?.updateSelf(res.self);
      labSay(res.text, 'good');
      render();
    });
  };
  render();
  if (!self)
    app.socket?.timeout(5000).emit('lab:self', (err, res) => {
      if (!err && res.ok) (self = res.self), render();
    });
}

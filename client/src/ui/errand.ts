// An NPC asks for help: accept or decline. Accepting points the guide arrow at the place.
import { formatMoney } from '@kh/shared';
import type { App } from '../app';
import { el, toast, uiRoot } from './dom';
import { sfx } from './sound';

export function openErrandOffer(app: App, npc: number, offer: { text: string; rewardSen: number; xp: number }) {
  const yes = el('button', { class: 'btn primary', type: 'button', 'data-action': 'errand-accept' }, 'Sure, I can help!');
  const no = el('button', { class: 'btn', type: 'button' }, 'Not now');
  const box = el(
    'div',
    { class: 'modal errand-offer', role: 'dialog', 'data-testid': 'errand-offer' },
    el('h3', {}, '🧺 A little favour?'),
    el('p', {}, offer.text),
    el('p', { class: 'muted' }, `Reward: ${formatMoney(offer.rewardSen)} + ${offer.xp} XP`),
    el('div', { class: 'actions' }, yes, no),
  );
  const back = el('div', { class: 'modal-backdrop' }, box);
  const close = () => back.remove();
  no.addEventListener('click', close);
  back.addEventListener('click', (e) => e.target === back && close());
  yes.addEventListener('click', () => {
    yes.disabled = true;
    app.socket?.timeout(5000).emit('npc:accept', { npc }, (err, res) => {
      close();
      if (err || !res.ok) return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      sfx.chime();
      app.store.errand = res.errand;
      app.store.emit();
      toast(`🧺 Go to ${res.errand.place.name}. Follow the arrow!`, 'info', 4000);
    });
  });
  uiRoot().append(back);
}

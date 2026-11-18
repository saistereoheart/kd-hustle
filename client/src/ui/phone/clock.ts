// 🕰️ Clock: the in-game time, what's open, and the vote to skip the night.
import { canStartSkipVote, dayPhase, formatClock, gameTime, inHours } from '@kh/shared';
import type { PhoneCtx } from './phone';
import { el } from '../dom';
import { voteSkip } from '../voteBanner';

export function renderClock({ app, rerender }: PhoneCtx): HTMLElement[] {
  const t = gameTime(app.cfg.time, app.store.serverNow());
  const phase = dayPhase(app.cfg.time, t.hourF);
  const v = app.store.vote;
  const sv = app.cfg.time.skipVote;
  const big = el('div', { class: 'clock-big' }, `${phase === 'day' ? '☀️' : phase === 'dawn' ? '🌅' : phase === 'dusk' ? '🌇' : '🌙'} ${formatClock(t)}`);
  const open = app.cfg.stalls.tiers.map((tier) => el('div', { class: 'setting-row' }, el('span', {}, `${tier.icon} ${tier.name}`), el('span', { class: inHours(t.hourF, tier.hours[0], tier.hours[1]) ? 'good' : 'muted' }, inHours(t.hourF, tier.hours[0], tier.hours[1]) ? 'Open now' : `Opens ${tier.hours[0]}:00`)));
  const box = el('div', { class: 'vote-box' });
  if (v?.active) {
    const left = Math.max(0, Math.round((v.endsAt - app.store.serverNow()) / 1000));
    const yes = el('button', { class: 'btn primary', type: 'button', 'data-action': 'vote-yes' }, '👍 Skip it');
    const no = el('button', { class: 'btn', type: 'button', 'data-action': 'vote-no' }, '👎 Keep night');
    yes.addEventListener('click', () => voteSkip(app, true, rerender));
    no.addEventListener('click', () => voteSkip(app, false, rerender));
    box.append(el('h4', {}, `🗳️ ${v.startedBy ?? 'Someone'} wants to skip the night`), el('p', {}, `${v.yes} yes · ${v.no} no · ${v.needed} of ${v.online} needed · ${left} s left`), el('div', { class: 'actions' }, yes, no));
  } else {
    const now = app.store.serverNow();
    const can = canStartSkipVote(app.cfg.time, now, v);
    const start = el('button', { class: 'btn primary', type: 'button', 'data-action': 'vote-start', disabled: !can }, '🌅 Vote to skip the night');
    start.addEventListener('click', () => voteSkip(app, true, rerender));
    const why = v && !can ? (now < v.cooldownUntil ? `Next vote in ${Math.ceil((v.cooldownUntil - now) / 1000)} s.` : `You can skip from ${sv.allowedHours[0]}:00 to ${sv.allowedHours[1]}:00.`) : '';
    box.append(el('h4', {}, '🌙 Skip the night'), el('p', { class: 'muted' }, `Jumps everyone to ${sv.skipToHour}:00 AM. More than half of the players online must say yes. ${why}`), start);
  }
  if (!v) box.append(el('p', { class: 'muted' }, 'Waiting for the server…'));
  return [big, el('p', { class: 'muted' }, `Day ${t.day % 1000} · 1 in-game hour = 1 real minute`), box, el('h4', {}, 'Stalls'), ...open];
}

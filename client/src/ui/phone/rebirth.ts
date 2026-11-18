// HustlePhone → Rebirth (spec §13): at wealth stage 6, start a new life for Rebirth Tokens, and
// spend tokens on permanent perks. Shows exactly what resets and what you keep.
import { perkCost, stageDef } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

let lastFetch = 0;

export function renderRebirth({ app }: PhoneCtx): HTMLElement[] {
  const rc = app.cfg.rebirth;
  if (Date.now() - lastFetch > 5000) {
    lastFetch = Date.now();
    app.socket?.timeout(5000).emit('rebirth:view', (err, res) => {
      if (err || !res.ok) return;
      app.store.rebirth = res.view;
      app.store.emit();
    });
  }
  const v = app.store.rebirth;
  if (!v) return [el('p', { class: 'muted' }, 'Loading…')];
  const go = el('button', { class: 'btn primary', type: 'button', 'data-action': 'rebirth-do', disabled: !v.can }, v.can ? `⭐ Be reborn (+${v.tokensNow} tokens)` : `🔒 ${v.reason}`);
  go.addEventListener('click', () => {
    const typed = prompt(`Start a new life?\n\nYou LOSE: your cash, homes, businesses and shop, your stall, your loans, and you go back to wealth stage 1.\nYou KEEP: your items (cosmetics, furniture…), the Item Index, titles, level, skills and Rebirth perks.\nYou GET: ${v.tokensNow} Rebirth Tokens.\n\nType REBIRTH to confirm.`);
    if (typed?.trim().toUpperCase() !== 'REBIRTH') return;
    app.socket?.timeout(8000).emit('rebirth:do', { confirm: 'REBIRTH' }, (err, res) => {
      if (err || !res.ok) return (sfx.error(), toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad'));
      sfx.fanfare();
      toast(`⭐ Reborn! +${res.tokens} Rebirth Tokens. Spend them below.`, 'good', 6000);
    });
  });
  const perks = rc.shop.map((p) => {
    const lv = v.shop[p.id] ?? 0;
    const maxed = lv >= p.maxLevel;
    const cost = maxed ? 0 : perkCost(rc, p.id, lv);
    const b = el('button', { class: 'btn small primary', type: 'button', 'data-perk': p.id, disabled: maxed || v.tokens < cost }, maxed ? 'Maxed' : `Lv ${lv + 1}`, maxed ? null : el('small', {}, `${cost} ⭐`));
    b.addEventListener('click', () =>
      app.socket?.timeout(5000).emit('rebirth:buy', { perk: p.id }, (err, res) => {
        if (err || !res.ok) return (sfx.error(), toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad'));
        sfx.coin();
        toast(`${p.icon} ${p.name} Lv ${lv + 1}`, 'good');
      }),
    );
    return el('div', { class: 'job-card skill-card', 'data-perk-card': p.id }, el('div', { class: 'job-icon' }, p.icon),
      el('div', { class: 'job-info' }, el('h4', {}, p.name, el('span', { class: 'lv-badge' }, `Lv ${lv}/${p.maxLevel}`)), el('p', {}, p.desc)), b);
  });
  return [
    el('div', { class: 'job-card' }, el('div', { class: 'job-icon' }, '⭐'),
      el('div', { class: 'job-info' },
        el('h4', {}, v.count ? `Reborn ${v.count}×` : 'Not reborn yet', el('span', { class: 'lv-badge' }, `${v.tokens} tokens`)),
        el('p', {}, `At wealth stage ${v.minStage} (${stageDef(app.cfg.stages, v.minStage).name}) you can start over with Rebirth Tokens: more for a bigger net worth (${v.tokensNow} right now).`))),
    go,
    el('h4', { class: 'phone-section' }, 'Rebirth Shop (permanent)'),
    ...perks,
    el('p', { class: 'hint' }, 'Your rebirths show as ⭐ by your name for everyone.'),
  ];
}

// HustlePhone → Rebirth (spec §13, reworked): at wealth stage 6, start a new life. Everything
// resets except your XP and level, and every rebirth doubles the cash you earn (×2, ×4, ×8...).
import { stageDef } from '@kh/shared';
import { el, toast } from '../dom';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

let lastFetch = 0;

export function renderRebirth({ app }: PhoneCtx): HTMLElement[] {
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
  const go = el('button', { class: 'btn primary', type: 'button', 'data-action': 'rebirth-do', disabled: !v.can }, v.can ? `⭐ Be reborn (cash ×${v.multNext})` : `🔒 ${v.reason}`);
  go.addEventListener('click', () => {
    const typed = prompt(
      `Start a new life?\n\nEVERYTHING resets: cash, items (cosmetics, furniture, chefs), the Item Index, shards, skills, titles, job levels, homes, businesses, your stall, loans and your wealth stage.\nYou KEEP: your XP and level.\nYou GET: everything you earn pays ×${v.multNext} (now ×${v.multNow}).\n\nType REBIRTH to confirm.`,
    );
    if (typed?.trim().toUpperCase() !== 'REBIRTH') return;
    app.socket?.timeout(10_000).emit('rebirth:do', { confirm: 'REBIRTH' }, (err, res) => {
      if (err || !res.ok) return (sfx.error(), toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad'));
      sfx.fanfare();
      toast(`⭐ Reborn! Rebirth #${res.count}: your cash income is now ×${res.mult}. Starting your new life…`, 'good', 6000);
      // Fresh state everywhere: reload (the session token logs you straight back in).
      setTimeout(() => location.reload(), 2500);
    });
  });
  const row = (icon: string, text: string) => el('li', {}, `${icon} ${text}`);
  return [
    el('div', { class: 'job-card' }, el('div', { class: 'job-icon' }, '⭐'),
      el('div', { class: 'job-info' },
        el('h4', {}, v.count ? `Reborn ${v.count}×` : 'Not reborn yet', el('span', { class: 'lv-badge' }, `cash ×${v.multNow}`)),
        el('p', {}, `At wealth stage ${v.minStage} (${stageDef(app.cfg.stages, v.minStage).name}) you can start over. Each rebirth doubles everything you earn: jobs, stall sales, manifesting, ventures, rent and Airbnb.`))),
    go,
    el('h4', { class: 'phone-section' }, 'What happens'),
    el('ul', { class: 'bonus-list' },
      row('🔄', 'Reset: cash, items, Item Index, shards, skills, titles, job levels'),
      row('🔄', 'Reset: homes, businesses, stall, loans, wealth stage'),
      row('✅', 'Kept: XP and level'),
      row('💰', `Next life: ×${v.multNext} cash income (compounds every rebirth)`)),
    el('p', { class: 'hint' }, 'Take your things off Pasar Online and the Butik shelf first. Your rebirths show as ⭐ by your name.'),
  ];
}

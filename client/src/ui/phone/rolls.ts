// 🎰 Quick Rolls: roll any crate from anywhere (a small phone fee; free at the machine).
import { formatMoney, stageDef } from '@kh/shared';
import { openCratePanel } from '../cratePanel';
import { el } from '../dom';
import { closePanel } from '../panel';
import type { PhoneCtx } from './phone';

export function renderRolls({ app }: PhoneCtx): HTMLElement[] {
  const fee = app.cfg.economy.phoneRollFee;
  const pr = app.store.progress;
  // Event crates (Durian Season...) only show while their event runs.
  const ev = app.store.event && app.store.event.endsAt > app.store.serverNow() ? app.store.event.id : null;
  const cards = app.cfg.crates.crates.filter((c) => !c.event || c.event === ev).map((c) => {
    const r = c.requires;
    const lock = r.stage && pr.stage < r.stage ? `Wealth stage ${r.stage} (${stageDef(app.cfg.stages, r.stage).name})` : r.level && pr.level < r.level ? `Level ${r.level}` : null;
    const open = el('button', { class: 'btn primary', type: 'button', 'data-action': `quick-roll-${c.id}`, disabled: !!lock }, lock ? '🔒' : 'Roll');
    open.addEventListener('click', () => {
      closePanel();
      openCratePanel(app, c.id, { remote: true });
    });
    const found = c.pool.filter((id) => app.store.index.has(id)).length;
    return el(
      'div',
      { class: 'job-card' },
      el('div', { class: 'job-icon' }, c.id === 'capsule' ? '🎰' : c.id === 'luckybag' ? '🧧' : c.id === 'chefs' ? '👨‍🍳' : '🎁'),
      el('div', { class: 'job-info' }, el('h4', {}, c.name), el('p', {}, lock ? `Opens at ${lock}` : `${c.priceShards ? `${c.priceShards} 💎` : formatMoney(Math.round(c.priceSen * (1 + fee)))} a roll · ${found}/${c.pool.length} found`)),
      open,
    );
  });
  return [el('p', { class: 'muted' }, `Roll from anywhere: +${Math.round(fee * 100)}% phone fee. Rolling at the machine itself is free.`), ...cards];
}

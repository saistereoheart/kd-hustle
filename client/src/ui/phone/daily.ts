// HustlePhone → Daily: the 7-day login streak (spec §15). Claim once per day; miss a day and
// the streak starts again at day 1. Day 7 gives a free crate roll.
import { formatMoney, type InventoryItem, type Reward } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { closePanel } from '../panel';
import { playReveal } from '../reel';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

export function rewardText(app: App, r: Reward): string {
  const parts: string[] = [];
  if (r.sen) parts.push(formatMoney(r.sen));
  if (r.crate) parts.push(`free ${app.crates.get(r.crate)?.name ?? r.crate} roll`);
  for (const id of r.items ?? []) parts.push(app.items.get(id)?.name ?? id);
  if (r.shards) parts.push(`${r.shards} 💎`);
  if (r.xp) parts.push(`${r.xp} XP`);
  return parts.join(' + ');
}

export function renderDaily({ app, rerender }: PhoneCtx): HTMLElement[] {
  const pr = app.store.progress;
  const d = pr.daily;
  const days = el('div', { class: 'daily-days' });
  app.cfg.quests.login.forEach((r, i) => {
    const day = i + 1;
    // Days already claimed this streak (only if the streak continues today).
    const claimed = d.canClaim ? day < d.nextDay : day <= d.streak;
    const today = d.canClaim && day === d.nextDay;
    days.append(
      el(
        'div',
        { class: `daily-day${claimed ? ' claimed' : ''}${today ? ' today' : ''}${day === 7 ? ' big' : ''}`, 'data-day': String(day) },
        el('div', { class: 'daily-n' }, `Day ${day}`),
        el('div', { class: 'daily-icon' }, claimed ? '✅' : day === 7 ? '🎁' : r.items?.length ? '🧪' : '💵'),
        el('div', { class: 'daily-r' }, rewardText(app, r)),
      ),
    );
  });
  const btn = el('button', { class: 'btn primary', type: 'button', 'data-action': 'daily-claim', disabled: !d.canClaim }, d.canClaim ? `Claim day ${d.nextDay}` : 'Come back tomorrow ✓');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    app.socket?.timeout(8000).emit('daily:claim', (err, res) => {
      if (err || !res.ok) {
        sfx.error();
        rerender();
        return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      sfx.coin();
      toast(`🎁 Day ${res.day} reward claimed!`, 'good');
      if (res.roll) {
        // Day 7: a free crate roll, played with the normal reel.
        const crate = app.crates.get(res.roll.crateId);
        const now = Date.now();
        const items: InventoryItem[] = res.roll.results.map((r) => ({ iid: r.iid, itemId: r.itemId, variant: r.variant, serial: r.serial, obtainedAt: now }));
        app.store.addItems(items);
        if (crate) {
          closePanel();
          playReveal({ rar: app.cfg.rarities, items: app.items, crate, results: res.roll.results, shake: (i) => app.town?.shake(i), onDone: () => {}, luck: app.mods().luck });
        }
      }
    });
  });
  return [
    el('p', { class: 'muted' }, d.canClaim ? (d.nextDay === 1 && d.streak > 0 ? 'Your streak reset. Log in every day to keep it going!' : `Log in every day for bigger rewards. Day 7: a free ${rewardText(app, app.cfg.quests.login[6])}!`) : `Streak: day ${d.streak}. Next reward tomorrow.`),
    days,
    btn,
    el('p', { class: 'hint' }, `Best streak: ${pr.stats.bestLoginStreak ?? 0} day${(pr.stats.bestLoginStreak ?? 0) === 1 ? '' : 's'}. The day resets at midnight.`),
  ];
}

// HustlePhone → Quests: today's 3 daily quests (new ones every day at midnight).
import { formatMoney, questProgress, questText } from '@kh/shared';
import { el, toast } from '../dom';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

export function renderQuests({ app, rerender }: PhoneCtx): HTMLElement[] {
  const pr = app.store.progress;
  if (!pr.quests.length) return [el('p', { class: 'empty' }, 'No quests yet. They arrive as soon as you start playing today.')];
  const cards = pr.quests.map((q) => {
    const def = app.cfg.quests.daily.find((d) => d.id === q.id);
    if (!def) return el('div');
    const prog = questProgress(def, q, pr.stats);
    const fmt = (n: number) => (def.format === 'money' ? formatMoney(n) : def.format === 'minutes' ? `${Math.floor(n / 60)}/${Math.round(q.target / 60)} min` : `${n}`);
    const count = def.format === 'minutes' ? fmt(prog.cur) : `${fmt(prog.cur)} / ${fmt(q.target)}`;
    const bar = el('div', { class: 'progress' }, el('i', {}));
    (bar.firstChild as HTMLElement).style.width = `${(prog.cur / q.target) * 100}%`;
    const reward = [q.senReward ? formatMoney(q.senReward) : '', `${def.reward.xp} XP`, ...(def.reward.items ?? []).map((id) => app.items.get(id)?.name ?? id)].filter(Boolean).join(' + ');
    const btn = el(
      'button',
      { class: `btn${prog.done && !q.claimed ? ' primary' : ''}`, type: 'button', 'data-action': `quest-claim-${q.id}`, disabled: q.claimed || !prog.done },
      q.claimed ? 'Claimed ✓' : prog.done ? 'Claim' : count,
    );
    btn.addEventListener('click', () => {
      btn.disabled = true;
      app.socket?.timeout(6000).emit('quest:claim', { id: q.id }, (err, res) => {
        if (err || !res.ok) {
          sfx.error();
          rerender();
          return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        }
        sfx.coin();
        toast(`📋 Quest complete: +${reward}`, 'good');
      });
    });
    return el(
      'div',
      { class: `quest-card${q.claimed ? ' claimed' : prog.done ? ' ready' : ''}`, 'data-quest': q.id },
      el('div', { class: 'quest-icon' }, def.icon),
      el('div', { class: 'quest-info' }, el('div', { class: 'quest-text' }, questText(def, q.target, formatMoney)), bar, el('div', { class: 'muted small' }, `Reward: ${reward}`)),
      btn,
    );
  });
  return [...cards, el('p', { class: 'hint' }, `Quests done in total: ${pr.stats.questsDone ?? 0}. New quests every day at midnight.`)];
}

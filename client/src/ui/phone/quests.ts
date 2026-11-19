import { closePanel } from '../panel';
// HustlePhone → Quests: today's 3 daily quests (new ones every day at midnight) and this week's
// bigger ones (new every Monday).
import { formatMoney, questProgress, questText, type QuestDef, type QuestState } from '@kh/shared';
import { el, toast } from '../dom';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

export function renderQuests({ app, rerender }: PhoneCtx): HTMLElement[] {
  const pr = app.store.progress;
  if (!pr.quests.length && !pr.weekly?.length) return [el('p', { class: 'empty' }, 'No quests yet. They arrive as soon as you start playing today.')];
  const card = (q: QuestState, defs: QuestDef[]) => {
    const def = defs.find((d) => d.id === q.id);
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
    // 📍 Where do I do this? Points the guide arrow at the place.
    const where = !q.claimed && !prog.done ? app.guide?.questTarget(q.id) : null;
    const whereBtn = where ? el('button', { class: 'btn small where-btn', type: 'button', title: `Show me: ${where.label}` }, `📍 ${where.label}`) : null;
    whereBtn?.addEventListener('click', () => {
      app.guide?.point(where!.id);
      closePanel();
    });
    return el(
      'div',
      { class: `quest-card${q.claimed ? ' claimed' : prog.done ? ' ready' : ''}`, 'data-quest': q.id },
      el('div', { class: 'quest-icon' }, def.icon),
      el('div', { class: 'quest-info' }, el('div', { class: 'quest-text' }, questText(def, q.target, formatMoney)), bar, el('div', { class: 'muted small' }, `Reward: ${reward}`), ...(whereBtn ? [whereBtn] : [])),
      btn,
    );
  };
  const daily = pr.quests.map((q) => card(q, app.cfg.quests.daily));
  const weekly = (pr.weekly ?? []).map((q) => card(q, app.cfg.quests.weekly));
  const now = new Date();
  const daysLeft = 7 - ((now.getDay() + 6) % 7);
  return [
    el('h3', { class: 'quest-head' }, '📋 Today'),
    ...daily,
    ...(weekly.length ? [el('h3', { class: 'quest-head' }, `📅 This week `, el('span', { class: 'muted small' }, `(${daysLeft} day${daysLeft > 1 ? 's' : ''} left)`)), ...weekly] : []),
    el('p', { class: 'hint' }, `Quests done in total: ${pr.stats.questsDone ?? 0} daily, ${pr.stats.weeklyQuestsDone ?? 0} weekly. New daily quests every midnight; weekly ones every Monday.`),
  ];
}

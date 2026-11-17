// HustlePhone → Hustle Path: the guided goals for a new player's first couple of hours.
// Goals complete in order; each pays a reward the moment it's done.
import { conditionProgress } from '@kh/shared';
import { el } from '../dom';
import { progressLabel } from '../progressHud';
import { rewardText } from './daily';
import type { PhoneCtx } from './phone';

export function renderPath({ app }: PhoneCtx): HTMLElement[] {
  const pr = app.store.progress;
  const snap = app.snapshot();
  const goals = app.cfg.goals.goals;
  const list = el('ol', { class: 'path-list' });
  goals.forEach((g, i) => {
    const done = i < pr.path;
    const current = i === pr.path;
    const p = conditionProgress(g.cond, snap, app.cfg.stages);
    const pct = done ? 100 : (p.cur / Math.max(1e-9, p.target)) * 100;
    const bar = current ? el('div', { class: 'progress' }, el('i', {})) : null;
    if (bar) (bar.firstChild as HTMLElement).style.width = `${pct}%`;
    list.append(
      el(
        'li',
        { class: `path-goal${done ? ' done' : ''}${current ? ' current' : ''}${i > pr.path ? ' later' : ''}`, 'data-goal': g.id },
        el('span', { class: 'path-dot' }, done ? '✓' : String(i + 1)),
        el(
          'div',
          { class: 'path-info' },
          el('div', { class: 'path-text' }, g.text, current ? el('span', { class: 'path-count' }, ` ${progressLabel(p)}`) : null),
          current && g.hint ? el('div', { class: 'muted small' }, g.hint) : null,
          bar,
          el('div', { class: 'path-reward' }, `🎁 ${rewardText(app, g.reward) || 'Bragging rights'}`),
        ),
      ),
    );
  });
  const doneAll = pr.path >= goals.length;
  return [
    el('p', { class: 'muted' }, doneAll ? '🎉 You finished the Hustle Path! The HUD now tracks your next wealth stage.' : `${pr.path} of ${goals.length} done. Every goal pays out as soon as you reach it.`),
    list,
  ];
}

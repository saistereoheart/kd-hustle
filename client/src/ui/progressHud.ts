// Under the top-left pill (spec §1, §16): the next-goal tracker, the daily reward + quest chips,
// the luck readout and active potion timers. Ticks once a second so timers count down.
import { conditionProgress, dayPhase, formatClock, formatMoney, formatMoneyExact, gameTime, nextStage, questProgress, rushHour, type CondProgress } from '@kh/shared';
import type { App } from '../app';
import { el, uiRoot } from './dom';

export function progressLabel(p: CondProgress): string {
  const f = (n: number) => (p.unit === 'money' ? formatMoney(n) : p.unit === 'minutes' ? `${Math.floor(n / 60)} min` : p.unit === 'pct' ? `${Math.floor(n)}%` : `${Math.floor(n).toLocaleString('en-US')}`);
  if (p.unit === 'level') return `Lv ${p.cur} / ${p.target}`;
  return `${f(p.cur)} / ${f(p.target)}`;
}

/** The goal to show right now: the next Hustle Path goal, or the next wealth stage after that. */
export function currentGoal(app: App): { text: string; hint?: string; progress: CondProgress } | null {
  const pr = app.store.progress;
  const snap = app.snapshot();
  const goal = app.cfg.goals.goals[pr.path];
  if (goal) return { text: goal.text, hint: goal.hint, progress: conditionProgress(goal.cond, snap, app.cfg.stages) };
  const next = nextStage(app.cfg.stages, pr.stage);
  if (!next) return null;
  return {
    text: `Become a ${next.name}`,
    hint: `Net worth ${formatMoneyExact(next.minNetWorthSen)}. Unlocks: ${next.unlocks.join(', ')}`,
    progress: conditionProgress({ type: 'stage', n: next.n }, snap, app.cfg.stages),
  };
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class ProgressHud {
  private root: HTMLElement;
  private goal: HTMLElement;
  private chips: HTMLElement;
  private luck: HTMLElement;
  private timer: number;
  private off: () => void;
  private expanded = false;

  constructor(private app: App) {
    this.goal = el('button', { class: 'goal-card', type: 'button', 'data-testid': 'goal-tracker' });
    this.goal.addEventListener('click', (e) => {
      e.stopPropagation();
      // First tap shows the hint; second opens the full path in the phone.
      if (!this.expanded) {
        this.expanded = true;
        this.render();
      } else app.openPhone('path');
    });
    this.chips = el('div', { class: 'hud-chips' });
    this.root = el('div', { class: 'progress-hud' }, this.goal, this.chips);
    this.luck = el('button', { class: 'hud-luck', type: 'button', title: 'Your luck on every crate', 'data-testid': 'hud-luck' });
    this.luck.addEventListener('click', () => app.openPhone('profile'));
    app.hud?.moneyRow.append(this.luck);
    uiRoot().append(this.root);
    this.off = app.store.on(() => this.render());
    this.timer = window.setInterval(() => this.render(), 1000);
    this.render();
  }

  render() {
    const app = this.app;
    const st = app.store;
    const pr = st.progress;
    // In-game clock in the pill.
    const gt = gameTime(app.cfg.time, st.serverNow());
    const phase = dayPhase(app.cfg.time, gt.hourF);
    const rush = rushHour(app.cfg.time, gt.hourF);
    app.hud?.setClock(`${phase === 'day' ? '☀️' : phase === 'dawn' ? '🌅' : phase === 'dusk' ? '🌇' : '🌙'} ${formatClock(gt)}${rush ? ' 🍽️' : ''}`);
    // Sit just under the pill, whatever its height on this screen.
    const pill = app.hud?.pill.getBoundingClientRect();
    if (pill) this.root.style.top = `${Math.round(pill.bottom + 6)}px`;

    const g = currentGoal(app);
    if (g) {
      const pct = Math.min(100, (g.progress.cur / Math.max(1e-9, g.progress.target)) * 100);
      const bar = el('div', { class: 'progress goal-progress' }, el('i', {}));
      (bar.firstChild as HTMLElement).style.width = `${pct}%`;
      // Where: a "📍 Show me" line when the goal happens somewhere (toggles the guide arrow).
      const where = app.guide?.goalTarget();
      const whereLine: HTMLElement[] = [];
      if (where) {
        const pos = app.town?.debugSelf();
        const m = pos ? app.guide!.goalDistance(pos.x, pos.y) : null;
        const on = app.guide!.following;
        const w = el('span', { class: `goal-where${on ? ' on' : ''}`, role: 'button', 'data-testid': 'goal-where' }, `${on ? '🧭 Following' : '📍 Show me'}: ${where.icon} ${where.label}${m !== null ? ` · ${m} m` : ''}`);
        w.addEventListener('click', (e) => {
          e.stopPropagation();
          app.guide?.toggleGoal();
        });
        whereLine.push(w);
      }
      this.goal.replaceChildren(
        el('div', { class: 'goal-head' }, el('span', { class: 'goal-label' }, '🎯 Next goal'), el('span', { class: 'goal-count' }, progressLabel(g.progress))),
        el('div', { class: 'goal-text' }, g.text),
        bar,
        ...whereLine,
        ...(this.expanded && g.hint ? [el('div', { class: 'goal-hint' }, `💡 How: ${g.hint}`, el('span', { class: 'goal-more' }, ' Tap again for the full path →'))] : []),
      );
      this.goal.classList.remove('hidden');
    } else this.goal.classList.add('hidden');

    const chips: HTMLElement[] = [];
    const chip = (cls: string, text: string, onClick: () => void, testId?: string) => {
      const b = el('button', { class: `hud-chip ${cls}`, type: 'button', 'data-testid': testId }, text);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      chips.push(b);
    };
    const er = st.errand;
    if (er) {
      chip('errand-chip', `🧺 ${er.stage === 'go' ? `Errand: go to ${er.place.name}` : `Errand: back to ${er.npcName}`} · ${mmss(er.expiresAt - st.serverNow())}`, () => {
        if (confirm(`Give up ${er.npcName}'s errand?`)) app.cancelErrand();
      }, 'errand-chip');
    }
    if (pr.daily.canClaim) chip('pulse gift', `🎁 Day ${pr.daily.nextDay} reward`, () => app.openPhone('daily'), 'daily-chip');
    if (pr.quests.length) {
      let ready = 0;
      let done = 0;
      for (const q of pr.quests) {
        const def = app.cfg.quests.daily.find((d) => d.id === q.id);
        if (!def) continue;
        if (q.claimed) done++;
        else if (questProgress(def, q, pr.stats).done) ready++;
      }
      for (const q of pr.weekly ?? []) {
        const def = app.cfg.quests.weekly.find((d) => d.id === q.id);
        if (def && !q.claimed && questProgress(def, q, pr.stats).done) ready++;
      }
      chip(ready ? 'pulse ready' : '', ready ? `📋 ${ready} quest${ready > 1 ? 's' : ''} ready!` : `📋 Quests ${done}/${pr.quests.length}`, () => app.openPhone('quests'), 'quest-chip');
    }
    for (const b of st.buffs()) {
      const def = app.items.get(b.item);
      const icon = b.kind === 'luck' ? '🍀' : b.kind === 'xp' ? '📚' : b.kind === 'passive' ? '📈' : '☕';
      chip(`buff buff-${b.kind}`, `${icon} ${b.mult}× ${mmss(b.leftMs)}`, () => app.openPhone('profile'));
      chips[chips.length - 1].title = def ? `${def.name}: ${def.desc ?? ''}` : b.item;
    }
    const luck = app.mods().luck;
    // Narrow phones have no room for luck in the pill: show it here while it's boosted.
    if (luck > 1.0001) chip('narrow-only luck-chip', `🍀 ×${luck.toFixed(2)} luck`, () => app.openPhone('profile'));
    this.chips.replaceChildren(...chips);

    this.luck.textContent = `🍀 ×${luck.toFixed(2)}`;
    this.luck.classList.toggle('boosted', luck > 1.0001);
  }

  destroy() {
    clearInterval(this.timer);
    this.off();
    this.luck.remove();
    this.root.remove();
  }
}

// HustlePhone → Leaderboards: everyone who has played (offline players from their last visit).
import { formatMoney, LEADERBOARDS, type BoardEntry, type BoardId } from '@kh/shared';
import type { App } from '../../app';
import { el } from '../dom';
import { tabStrip } from '../tabStrip';
import { starName } from '../stars';
import type { PhoneCtx } from './phone';

let board: BoardId = 'netWorth';
let entries: BoardEntry[] = [];
let lastFetch = 0;

function fmt(id: BoardId, e: BoardEntry): string {
  const v = e.scores[id];
  const def = LEADERBOARDS.find((b) => b.id === id)!;
  if (def.money) return formatMoney(v);
  if (id === 'rarest') return e.notes?.rarest ?? '—';
  if (id === 'collection') return `${v}%`;
  if (id === 'airbnb') return v ? `${v.toFixed(1)}★` : '—';
  return String(v);
}

export function renderBoards({ app, rerender }: PhoneCtx): HTMLElement[] {
  if (Date.now() - lastFetch > 5000) {
    lastFetch = Date.now();
    app.socket?.timeout(5000).emit('board:view', (err, res) => {
      if (err || !res.ok) return;
      entries = res.entries;
      rerender();
    });
  }
  const tabs = tabStrip();
  for (const b of LEADERBOARDS) {
    const t = el('button', { class: `branch-tab${b.id === board ? ' active' : ''}`, type: 'button', 'data-board': b.id }, `${b.icon} ${b.name}`);
    t.addEventListener('click', () => {
      board = b.id;
      rerender();
    });
    tabs.append(t);
  }
  const me = app.lastInit?.you.id;
  const sorted = [...entries].sort((a, b) => b.scores[board] - a.scores[board]);
  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`);
  return [
    tabs,
    ...sorted.map((e, i) =>
      el('div', { class: `board-row${e.player === me ? ' mine' : ''}`, 'data-rank': String(i + 1) },
        el('span', { class: 'board-rank' }, medal(i)),
        el('span', { class: 'board-name' }, starName(e.name), e.online ? el('span', { class: 'board-online', title: 'online' }, ' ●') : null),
        el('b', {}, fmt(board, e)))),
    el('p', { class: 'hint' }, 'Offline players show their numbers from their last visit.'),
  ];
}

// ❤️ / 🔷 Labirin bars with their numbers inside them (fight cards and the HUD).
import { el } from '../dom';

export function statBar(kind: 'hp' | 'mp', v: number, max: number): HTMLElement {
  const pct = max ? Math.max(0, Math.min(100, Math.round((v / max) * 100))) : 0;
  const tone = kind === 'hp' ? (pct < 25 ? ' low' : pct < 55 ? ' mid' : '') : '';
  return el('div', { class: `lb-bar ${kind}${tone}`, title: kind === 'hp' ? 'HP' : '🔷 Mana (💥 skills use it)' },
    el('i', { style: `width:${pct}%` }),
    el('span', {}, `${kind === 'hp' ? '❤️' : '🔷'} ${Math.max(0, Math.round(v))} / ${Math.round(max)}`));
}

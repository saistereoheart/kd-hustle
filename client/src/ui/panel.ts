// Shared UI bits: a modal panel shell with optional tabs, and item cards.
import { formatMoney, type ItemDef, type RaritiesConfig } from '@kh/shared';
import { drawItemIcon } from '../items/itemArt';
import { el, uiRoot } from './dom';

export interface Panel {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
  onClose?: () => void;
}

let open: Panel | null = null;

export function isPanelOpen() {
  return open !== null;
}

export function closePanel() {
  open?.close();
}

/** Opens a modal panel (closing any other). Esc or ✕ closes it. */
export function openPanel(title: string, opts: { wide?: boolean; testId?: string; cls?: string } = {}): Panel {
  open?.close();
  const closeBtn = el('button', { class: 'icon-btn panel-close', type: 'button', 'aria-label': 'Close' }, '✕');
  const body = el('div', { class: 'panel-body' });
  const box = el('div', { class: `panel${opts.wide ? ' wide' : ''}${opts.cls ? ` ${opts.cls}` : ''}`, role: 'dialog', 'aria-label': title, 'data-testid': opts.testId }, el('div', { class: 'panel-head' }, el('h3', {}, title), closeBtn), body);
  const root = el('div', { class: 'modal-backdrop panel-backdrop' }, box);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') panel.close();
  };
  const panel: Panel = {
    root,
    body,
    close: () => {
      root.remove();
      window.removeEventListener('keydown', onKey);
      if (open === panel) open = null;
      panel.onClose?.();
    },
  };
  closeBtn.addEventListener('click', () => panel.close());
  root.addEventListener('click', (e) => {
    if (e.target === root) panel.close();
  });
  window.addEventListener('keydown', onKey);
  uiRoot().append(root);
  open = panel;
  return panel;
}

export function tabs(names: string[], onPick: (i: number) => void, initial = 0) {
  const bar = el('div', { class: 'tabs' });
  const buttons = names.map((n, i) => {
    const b = el('button', { type: 'button', class: i === initial ? 'active' : '', 'data-tab': n.toLowerCase().replace(/\W+/g, '-') }, n);
    b.addEventListener('click', () => {
      buttons.forEach((x, k) => x.classList.toggle('active', k === i));
      onPick(i);
    });
    return b;
  });
  bar.append(...buttons);
  return bar;
}

const iconCache = new Map<string, string>();
/** Data URL of an item icon (cached). */
export function iconUrl(def: ItemDef, variant: string, size = 72, silhouette = false): string {
  const key = `${def.id}|${variant}|${size}|${silhouette}`;
  let url = iconCache.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = c.height = size * 2;
    const ctx = c.getContext('2d')!;
    drawItemIcon(ctx, def, variant, size * 2, silhouette);
    url = c.toDataURL();
    iconCache.set(key, url);
  }
  return url;
}

export function tierOf(rar: RaritiesConfig, id: string) {
  const i = rar.tiers.findIndex((t) => t.id === id);
  return { tier: rar.tiers[i], index: i };
}

/** A square item card with rarity frame, variant badge and optional count / caption. */
export function itemCard(
  rar: RaritiesConfig,
  def: ItemDef,
  variant: string,
  opts: { count?: number; caption?: string; silhouette?: boolean; equipped?: boolean; serial?: number | null; size?: number; grade?: string; gradeColor?: string } = {},
) {
  const { tier } = tierOf(rar, def.rarity);
  const img = el('img', { src: iconUrl(def, variant, opts.size ?? 72, opts.silhouette), alt: opts.silhouette ? '???' : def.name, draggable: 'false' });
  const card = el(
    'div',
    { class: `item-card tier-${def.rarity}${opts.silhouette ? ' unknown' : ''}${variant !== 'normal' ? ` v-${variant}` : ''}`, title: opts.silhouette ? '???' : def.name },
    img,
    el('div', { class: 'item-name' }, opts.silhouette ? '???' : def.name),
    opts.caption ? el('div', { class: 'item-caption' }, opts.caption) : null,
    opts.count && opts.count > 1 ? el('span', { class: 'item-count' }, `×${opts.count}`) : null,
    variant !== 'normal' && !opts.silhouette ? el('span', { class: 'item-variant' }, variant) : null,
    opts.serial ? el('span', { class: 'item-serial' }, `#${opts.serial}`) : null,
    opts.equipped ? el('span', { class: 'item-equipped' }, '✓ worn') : null,
    opts.grade && !opts.silhouette ? el('span', { class: `item-grade g-${opts.grade}`, title: `Tier ${opts.grade}` }, opts.grade) : null,
  );
  if (opts.gradeColor) card.querySelector<HTMLElement>('.item-grade')?.style.setProperty('--grade', opts.gradeColor);
  card.style.setProperty('--tier', tier?.color ?? '#adb5bd');
  return card;
}

export const money = formatMoney;

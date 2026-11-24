// Shared UI bits: a modal panel shell with optional tabs, and item cards.
import { striva, strivaTag } from './striva';
import { topVariant, variantParts, formatMoney, type ItemDef, type RaritiesConfig } from '@kh/shared';
import { drawItemIcon } from '../items/itemArt';
import { el, resumeUi, uiRoot } from './dom';

export interface Panel {
  root: HTMLElement;
  body: HTMLElement;
  /** Go back to the window this one was opened from (or close it if there is none). */
  close: () => void;
  /** Close this window and every window behind it. */
  closeAll: () => void;
  onClose?: () => void;
  /** Called when you come back to this window from one opened on top of it. */
  onResume?: () => void;
  /**
   * A separate box beside the window (to its right on a wide screen, a strip above it on a
   * phone) for things you want to see while using the window: stock counts, what you're
   * wearing... Created on first use; `title` labels it.
   */
  side: (title: string) => HTMLElement;
}

interface Entry extends Panel {
  key: string;
  title: string;
  destroy: () => void;
}

/**
 * Windows form a stack: opening one from another hides the first and gives the new one a
 * ‹ Back button, so you can always step back to where you were. ✕ (or tapping outside) closes
 * the lot; Esc goes back one. Opening a window that's already in the stack goes back to it
 * (no loops of copies). Every window has a fixed size; long content scrolls inside it.
 */
const stack: Entry[] = [];

export function isPanelOpen() {
  return stack.length > 0;
}

/** Closes every open window. */
export function closePanel() {
  while (stack.length) stack[stack.length - 1].destroy();
}

function top() {
  return stack[stack.length - 1] ?? null;
}

function showTop() {
  const t = top();
  if (!t) return;
  t.root.classList.remove('panel-hidden');
  resumeUi(t.root); // the updates it skipped while hidden
  t.onResume?.();
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !stack.length) return;
  // Typing in a box: Esc just leaves the box.
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && top()?.root.contains(a)) return void a.blur();
  top()!.close();
});

/** Opens a window on top of the current one (see the stack above). */
export function openPanel(title: string, opts: { wide?: boolean; testId?: string; cls?: string } = {}): Panel {
  const key = opts.testId ?? title;
  // Already open somewhere in the stack: go back to that point and open it fresh there.
  const at = stack.findIndex((p) => p.key === key);
  if (at >= 0) while (stack.length > at) stack[stack.length - 1].destroy();
  const prev = top();
  prev?.root.classList.add('panel-hidden');

  const closeBtn = el('button', { class: 'icon-btn panel-close', type: 'button', 'aria-label': 'Close', title: 'Close (all windows)' }, '✕');
  const backBtn = prev
    ? el('button', { class: 'btn small panel-back', type: 'button', 'data-action': 'panel-back', 'aria-label': `Back to ${prev.title}`, title: `Back to ${prev.title} (Esc)` }, '‹ Back')
    : null;
  const body = el('div', { class: 'panel-body' });
  const box = el(
    'div',
    { class: `panel${opts.wide ? ' wide' : ''}${opts.cls ? ` ${opts.cls}` : ''}`, role: 'dialog', 'aria-label': title, 'data-testid': opts.testId },
    el('div', { class: 'panel-head' }, backBtn, el('h3', {}, title), closeBtn),
    body,
  );
  const frame = el('div', { class: `panel-frame${opts.wide ? ' wide' : ''}${opts.cls ? ` ${opts.cls}-frame` : ''}` }, box);
  const root = el('div', { class: 'modal-backdrop panel-backdrop' }, frame);
  let sideBox: HTMLElement | null = null;
  let sideBody: HTMLElement | null = null;
  let sideTitle: HTMLElement | null = null;

  const panel: Entry = {
    key,
    title,
    root,
    body,
    close: () => {
      const wasTop = top() === panel;
      panel.destroy();
      if (wasTop) showTop();
    },
    closeAll: () => closePanel(),
    side: (t: string) => {
      if (!sideBox) {
        sideTitle = el('h4', { class: 'panel-side-title' });
        sideBody = el('div', { class: 'panel-side-body' });
        sideBox = el('aside', { class: 'panel-side', 'aria-label': t }, sideTitle, sideBody);
        frame.append(sideBox);
        frame.classList.add('has-side');
      }
      sideTitle!.textContent = t;
      return sideBody!;
    },
    destroy: () => {
      const i = stack.indexOf(panel);
      if (i < 0) return;
      stack.splice(i, 1);
      root.remove();
      panel.onClose?.();
    },
  };
  closeBtn.addEventListener('click', () => closePanel());
  backBtn?.addEventListener('click', () => panel.close());
  root.addEventListener('click', (e) => {
    if (e.target === root) closePanel();
  });
  uiRoot().append(root);
  stack.push(panel);
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
    { class: `item-card tier-${def.rarity}${opts.silhouette ? ' unknown' : ''}${variant !== 'normal' ? ` v-${topVariant(variant)}` : ''}`, title: opts.silhouette ? '???' : def.name },
    img,
    el('div', { class: 'item-name' }, opts.silhouette ? '???' : def.name),
    opts.caption ? el('div', { class: 'item-caption' }, opts.caption) : null,
    opts.count && opts.count > 1 ? el('span', { class: 'item-count' }, `×${opts.count}`) : null,
    variant !== 'normal' && !opts.silhouette && !striva(opts.grade, variant) ? el('span', { class: 'item-variant' }, variantParts(variant).join(' + ')) : null,
    opts.serial ? el('span', { class: 'item-serial' }, `#${opts.serial}`) : null,
    opts.equipped ? el('span', { class: 'item-equipped' }, '✓ worn') : null,
    opts.grade && !opts.silhouette ? (striva(opts.grade, variant) ? strivaTag('item-striva') : el('span', { class: `item-grade g-${opts.grade}`, title: `Tier ${opts.grade}` }, opts.grade)) : null,
  );
  if (opts.gradeColor) card.querySelector<HTMLElement>('.item-grade')?.style.setProperty('--grade', opts.gradeColor);
  card.style.setProperty('--tier', tier?.color ?? '#adb5bd');
  return card;
}

export const money = formatMoney;

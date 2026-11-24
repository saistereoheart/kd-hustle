// A row of tabs that scrolls sideways (Upgrades branches, Bank, Market…): no scrollbar, a ‹ and ›
// arrow at the ends instead, each shown only when there's more that way. The arrows live inside
// the row (flex `order` keeps them at the ends, `position: sticky` keeps them in view), so the
// callers just append their tab buttons as before.
//
// Screens re-render often (every store update, every tab click) and build a NEW row each time, so
// the row remembers where it was scrolled (by its tabs' labels) and comes back there, instead of
// jumping back to the start. The arrows' shown/hidden state sits on the arrows, not on the row:
// keepUiState finds scrolled boxes by their classes, and a changing class lost the row.
import { el } from './dom';

/** Where each row was scrolled, by its tabs' labels. */
const remembered = new Map<string, number>();

export function tabStrip(cls = 'branch-tabs'): HTMLElement {
  const strip = el('div', { class: `${cls} tab-strip` });
  addArrows(strip);
  return strip;
}

function signature(strip: HTMLElement): string {
  let s = '';
  for (const c of strip.children) if (!c.classList.contains('tab-arrow')) s += `${c.textContent}|`;
  return s;
}

/** Adds the arrows to an existing row (again after `replaceChildren` took them out). */
export function addArrows(strip: HTMLElement) {
  strip.classList.add('tab-strip');
  if (strip.querySelector(':scope > .tab-arrow')) return;
  const mk = (dir: -1 | 1) => {
    const b = el('button', { class: `tab-arrow ${dir < 0 ? 'left' : 'right'}`, type: 'button', tabindex: '-1', 'aria-label': dir < 0 ? 'Scroll left' : 'Scroll right' }, dir < 0 ? '‹' : '›');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      strip.scrollBy({ left: dir * Math.max(80, strip.clientWidth * 0.7), behavior: 'smooth' });
    });
    return b;
  };
  strip.prepend(mk(-1));
  strip.append(mk(1));
  const w = strip as HTMLElement & { _arrowsWatched?: boolean; _placed?: boolean };
  if (w._arrowsWatched) return;
  w._arrowsWatched = true;

  const update = () => {
    const max = strip.scrollWidth - strip.clientWidth;
    strip.querySelector(':scope > .tab-arrow.left')?.classList.toggle('show', strip.scrollLeft > 2);
    strip.querySelector(':scope > .tab-arrow.right')?.classList.toggle('show', strip.scrollLeft < max - 2);
  };
  /** Once it has its tabs and a size: back to where this row was, or else show the chosen tab. */
  const place = () => {
    if (w._placed || !strip.isConnected || !strip.clientWidth) return;
    const sig = signature(strip);
    if (!sig) return;
    w._placed = true;
    if (strip.scrollLeft > 0) return; // already put back (keepUiState)
    const at = remembered.get(sig);
    if (at !== undefined) strip.scrollLeft = at;
    else {
      const active = strip.querySelector<HTMLElement>(':scope > .active');
      if (active && active.offsetLeft + active.offsetWidth > strip.clientWidth) strip.scrollLeft = active.offsetLeft - strip.clientWidth / 3;
    }
  };
  strip.addEventListener(
    'scroll',
    () => {
      if (w._placed) remembered.set(signature(strip), strip.scrollLeft);
      update();
    },
    { passive: true },
  );
  // Tabs are appended after this, and the row can change size: look again then.
  new ResizeObserver(() => {
    place();
    update();
  }).observe(strip);
  new MutationObserver(() => {
    if (!strip.querySelector(':scope > .tab-arrow')) addArrows(strip);
    place();
    update();
  }).observe(strip, { childList: true });
  requestAnimationFrame(() => {
    place();
    update();
  });
}

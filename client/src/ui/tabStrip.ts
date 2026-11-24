// A row of tabs that scrolls sideways (Upgrades branches, Bank, Market…): no scrollbar, a ‹ and ›
// arrow at the ends instead, each shown only when there's more that way. The arrows live inside
// the row (flex `order` keeps them at the ends, `position: sticky` keeps them in view), so the
// callers just append their tab buttons as before.
import { el } from './dom';

export function tabStrip(cls = 'branch-tabs'): HTMLElement {
  const strip = el('div', { class: `${cls} tab-strip` });
  addArrows(strip);
  return strip;
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
  const update = () => {
    const max = strip.scrollWidth - strip.clientWidth;
    strip.classList.toggle('more-left', strip.scrollLeft > 2);
    strip.classList.toggle('more-right', strip.scrollLeft < max - 2);
  };
  strip.addEventListener('scroll', update, { passive: true });
  if (!(strip as { _arrowsWatched?: boolean })._arrowsWatched) {
    (strip as { _arrowsWatched?: boolean })._arrowsWatched = true;
    // Tabs are appended after this, and the row can change size: look again then.
    new ResizeObserver(update).observe(strip);
    new MutationObserver(() => {
      if (!strip.querySelector(':scope > .tab-arrow')) addArrows(strip);
      update();
    }).observe(strip, { childList: true });
  }
  requestAnimationFrame(update);
}

// Tiny DOM helper. Text is always inserted as text nodes (never innerHTML), so player-
// supplied strings like chat or usernames can't inject HTML.
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export const uiRoot = () => document.getElementById('ui')!;

let toastBox: HTMLElement | null = null;
export function toast(text: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 2600) {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = el('div', { class: 'toasts' });
    uiRoot().append(toastBox);
  }
  const t = el('div', { class: `toast ${kind}` }, text);
  toastBox.append(t);
  setTimeout(() => t.remove(), ms);
}

export function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

export function messageOverlay(title: string, body: string, button?: { label: string; onClick: () => void }) {
  const card = el('div', { class: 'card' }, el('h2', {}, title), el('p', {}, body));
  if (button) {
    const b = el('button', { class: 'btn primary' }, button.label);
    b.addEventListener('click', button.onClick);
    card.append(b);
  }
  const o = el('div', { class: 'overlay-msg' }, card);
  uiRoot().append(o);
  return o;
}

// ------------------------------------------------------------------ re-render without losing state
/** A stable-ish key for an element inside `root`: each ancestor's tag, data-* attributes and
 *  classes, plus its position among same-looking siblings. */
function uiKey(node: Element, root: Element): string {
  const parts: string[] = [];
  for (let n: Element | null = node; n && n !== root; n = n.parentElement) {
    let sig = n.tagName;
    for (const a of n.attributes) if (a.name.startsWith('data-') || a.name === 'class' || a.name === 'name' || a.name === 'type') sig += `[${a.name}=${a.value.replace(/\b(active|primary|on|sel|selected)\b/g, '')}]`;
    let i = 0;
    for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName && s.className === n.className) i++;
    parts.push(`${sig}#${i}`);
  }
  return parts.reverse().join('>');
}

/**
 * Runs `rebuild` (which replaces `root`'s contents) and puts back what the player was doing:
 * scroll positions of scrolled boxes (e.g. a tab row), values they typed into inputs but haven't
 * sent yet, and the focused input with its caret. Use for panels that re-render on store updates.
 */
// Re-renders are scheduled, not run blindly:
//  - at most one per root every MIN_GAP_MS (the store can change several times a second);
//  - never while a finger / mouse button is down (a button rebuilt between press and release
//    loses the click), but straight after the release;
//  - not while the window is hidden under another one (done when you come back to it).
const MIN_GAP_MS = 300;
const pendingRebuild = new Map<HTMLElement, () => void>();
const lastRebuild = new WeakMap<HTMLElement, number>();
const rebuildTimer = new Map<HTMLElement, number>();
let pointerIsDown = false;
let pressedAt = 0;
addEventListener('pointerdown', () => ((pointerIsDown = true), (pressedAt = performance.now())), true);
const released = () => {
  if (!pointerIsDown) return;
  pointerIsDown = false;
  // After the click that follows this release has been handled.
  setTimeout(() => {
    for (const r of [...pendingRebuild.keys()]) scheduleRebuild(r);
  }, 60);
};
addEventListener('pointerup', released, true);
addEventListener('pointercancel', released, true);
addEventListener('blur', released); // released outside the window

function scheduleRebuild(root: HTMLElement) {
  if (rebuildTimer.has(root)) return;
  const wait = (lastRebuild.get(root) ?? -1e9) + MIN_GAP_MS - performance.now();
  if (wait <= 0) return runRebuild(root);
  rebuildTimer.set(root, window.setTimeout(() => {
    rebuildTimer.delete(root);
    runRebuild(root);
  }, wait));
}

function runRebuild(root: HTMLElement) {
  const fn = pendingRebuild.get(root);
  if (!fn) return;
  if (!root.isConnected) {
    pendingRebuild.delete(root); // closed: nothing to show
    return;
  }
  // Later (on release / resumeUi). A press held over 3 s (a drag, a long-press) doesn't block it.
  if (pointerIsDown && performance.now() - pressedAt < 3000) {
    window.setTimeout(() => scheduleRebuild(root), 3100 - (performance.now() - pressedAt));
    return;
  }
  if (root.closest('.panel-hidden')) return;
  pendingRebuild.delete(root);
  lastRebuild.set(root, performance.now());
  rebuildKeepingState(root, fn);
}

/** A window came back to the front: run the re-renders it skipped while hidden. */
export function resumeUi(container: HTMLElement) {
  for (const r of [...pendingRebuild.keys()]) if (container.contains(r)) scheduleRebuild(r);
}

/**
 * Re-renders `root` (see the scheduling rules above) and puts back what the player was doing:
 * scroll positions, values typed but not sent, and the focused input with its caret.
 */
export function keepUiState(root: HTMLElement, rebuild: () => void) {
  pendingRebuild.set(root, rebuild);
  scheduleRebuild(root);
}

/** Re-renders `root` right now (after a click in it), keeping scroll positions, typing and focus. */
export function rebuildNow(root: HTMLElement, rebuild: () => void) {
  pendingRebuild.delete(root);
  lastRebuild.set(root, performance.now());
  rebuildKeepingState(root, rebuild);
}

function rebuildKeepingState(root: HTMLElement, rebuild: () => void) {
  const scrolls = new Map<string, [number, number]>();
  const typed = new Map<string, string>();
  let focus: { key: string; start: number | null; end: number | null } | null = null;
  for (const n of root.querySelectorAll<HTMLElement>('*')) {
    if (n.scrollLeft || n.scrollTop) scrolls.set(uiKey(n, root), [n.scrollLeft, n.scrollTop]);
    if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement || n instanceof HTMLSelectElement) {
      const def = n instanceof HTMLSelectElement ? null : n instanceof HTMLTextAreaElement ? n.defaultValue : n.getAttribute('value') ?? '';
      const edited = n instanceof HTMLInputElement && (n.type === 'checkbox' || n.type === 'radio') ? false : def === null ? false : n.value !== def;
      if (edited) typed.set(uiKey(n, root), n.value);
    }
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && root.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
    let start: number | null = null;
    let end: number | null = null;
    try {
      start = active.selectionStart;
      end = active.selectionEnd;
    } catch {
      /* number inputs have no selection */
    }
    focus = { key: uiKey(active, root), start, end };
  }
  // The root itself scrolls too (a panel body, the phone screen): querySelectorAll skips it, and a
  // rebuild that reads layout half-way (or swaps in shorter content for a moment) would snap it back
  // to the top while you're scrolling (report #12).
  const rootScroll = [root.scrollLeft, root.scrollTop] as const;
  rebuild();
  if (root.scrollTop !== rootScroll[1]) root.scrollTop = rootScroll[1];
  if (root.scrollLeft !== rootScroll[0]) root.scrollLeft = rootScroll[0];
  if (!scrolls.size && !typed.size && !focus) return;
  // Only elements that could match: same tag as something we saved.
  const tags = new Set<string>();
  for (const k of [...scrolls.keys(), ...typed.keys(), ...(focus ? [focus.key] : [])]) tags.add(/(?:^|>)([A-Z0-9]+)[^>]*$/.exec(k)?.[1] ?? '');
  for (const n of root.querySelectorAll<HTMLElement>('*')) {
    if (!tags.has(n.tagName)) continue;
    const k = uiKey(n, root);
    const sc = scrolls.get(k);
    if (sc) {
      n.scrollLeft = sc[0];
      n.scrollTop = sc[1];
    }
    if ((n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) && typed.has(k)) n.value = typed.get(k)!;
    if (focus && focus.key === k && (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement)) {
      n.focus({ preventScroll: true });
      try {
        if (focus.start !== null) n.setSelectionRange(focus.start, focus.end);
      } catch {
        /* ignore */
      }
    }
  }
}

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
export function keepUiState(root: HTMLElement, rebuild: () => void) {
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
  rebuild();
  if (!scrolls.size && !typed.size && !focus) return;
  for (const n of root.querySelectorAll<HTMLElement>('*')) {
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

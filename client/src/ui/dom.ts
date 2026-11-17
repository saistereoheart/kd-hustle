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

// Hotbar: 10 quick-use slots along the bottom (keys 1–9, 0; tap on phones).
// A slot holds a vehicle (hop on/off) or an item from the bag (wear/take off). Fill slots from
// the Bag ("Add to hotbar"); right-click or long-press a slot to clear it.
import type { HotbarRef } from '@kh/shared';
import type { App } from '../app';
import { el, toast, uiRoot } from './dom';
import { is3dVehicle, resolveLook, vehicleIconUrl } from '../items/carArt';
import { iconUrl } from './panel';

const KEY_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export class Hotbar {
  private root: HTMLElement;
  private slots: HTMLButtonElement[] = [];
  private off: () => void;

  constructor(private app: App) {
    this.root = el('div', { class: 'hotbar', 'data-testid': 'hotbar' });
    KEY_LABELS.forEach((key, i) => {
      const b = el('button', { class: 'hotbar-slot', type: 'button', 'data-slot': String(i) });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        app.useHotbar(i);
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.clear(i);
      });
      // Long-press (phones) clears the slot too.
      let timer = 0;
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        timer = window.setTimeout(() => {
          timer = 0;
          this.clear(i);
        }, 650);
      });
      const cancel = () => {
        clearTimeout(timer);
        timer = 0;
      };
      b.addEventListener('pointerup', cancel);
      b.addEventListener('pointerleave', cancel);
      b.dataset.key = key;
      this.slots.push(b);
      this.root.append(b);
    });
    uiRoot().append(this.root);
    this.off = app.store.on(() => this.render());
    this.render();
  }

  /** Put something right above the hotbar, exactly as wide (the Labirin's ❤️/🔷 bars): it rides on the
   *  bar itself, absolutely placed, so it follows it on every screen size. */
  mountAbove(node: HTMLElement) {
    node.classList.add('hotbar-above');
    this.root.append(node);
  }

  private clear(i: number) {
    if (!this.app.store.hotbar[i]) return;
    this.app.setHotbarSlot(i, null);
    toast(`Slot ${KEY_LABELS[i]} cleared.`);
  }

  /** Is this slot's thing in use right now (riding it / wearing it)? */
  private active(ref: HotbarRef): boolean {
    const st = this.app.store;
    if (ref.kind === 'vehicle') return st.riding === ref.id;
    const worn = new Set(Object.values(st.equipped));
    return st.inventory.some((i) => worn.has(i.iid) && i.itemId === ref.itemId && i.variant === ref.variant);
  }

  render() {
    const st = this.app.store;
    this.slots.forEach((b, i) => {
      const ref = st.hotbar[i] ?? null;
      const label = el('span', { class: 'hotbar-key' }, KEY_LABELS[i]);
      b.className = 'hotbar-slot';
      if (!ref) {
        b.title = `Empty slot (${KEY_LABELS[i]}). Add things from the Bag.`;
        b.replaceChildren(label);
        return;
      }
      let icon: Node;
      let name: string;
      let missing = false;
      let count = 0;
      if (ref.kind === 'vehicle') {
        const v = this.app.cfg.vehicles.vehicles[ref.id];
        name = v?.name ?? ref.id;
        // Showroom cars and bikes get a cartoon picture of the real model (in your paint job).
        if (is3dVehicle(ref.id)) {
          const o = st.garage?.owned[ref.id];
          icon = el('img', { src: vehicleIconUrl(ref.id, resolveLook(ref.id, o ? { paint: o.paint, wheel: o.wheel, exhaust: o.exhaust } : null), 80), alt: name, draggable: 'false', class: 'hotbar-vehicle' });
        } else icon = el('span', { class: 'hotbar-emoji' }, v?.icon ?? '🚗');
        missing = !st.vehicles.includes(ref.id);
      } else {
        const def = this.app.items.get(ref.itemId);
        name = def ? `${def.name}${ref.variant !== 'normal' ? ` (${ref.variant})` : ''}` : ref.itemId;
        icon = def ? el('img', { src: iconUrl(def, ref.variant, 40), alt: name, draggable: 'false' }) : el('span', { class: 'hotbar-emoji' }, '❔');
        count = st.inventory.filter((it) => it.itemId === ref.itemId && it.variant === ref.variant).length;
        missing = count === 0;
      }
      b.title = `${name} (${KEY_LABELS[i]})${missing ? ': you no longer have this' : ''}`;
      b.classList.toggle('active', this.active(ref));
      b.classList.toggle('missing', missing);
      b.replaceChildren(icon, label, count > 1 ? el('span', { class: 'hotbar-count' }, `×${count}`) : '');
    });
  }

  destroy() {
    this.off();
    this.root.remove();
  }
}

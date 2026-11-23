// 🌀 The abyss hotbar: down in the Labirin your town hotbar (vehicles, outfits) stays up top, and this one
// takes its place: your Labirin potions on keys 1–9, with how many you carry. Out of a fight it drinks one
// (heals, mana, 🧵 home); fight-only potions are used from 🧪 Items in the fight.
import type { LabSelf } from '@kh/shared';
import type { App } from '../../app';
import { el, labSay, uiRoot } from '../dom';
import { sfx } from '../sound';

export class LabHotbar {
  readonly root: HTMLElement;
  private slots: HTMLButtonElement[] = [];
  private self: LabSelf | null = null;
  private busy = false;

  constructor(private app: App) {
    this.root = el('div', { class: 'hotbar lab-hotbar', 'data-testid': 'lab-hotbar' });
    app.cfg.lab.potions.list.slice(0, 9).forEach((p, i) => {
      const b = el('button', { class: 'hotbar-slot', type: 'button', 'data-potion': p.id },
        el('span', { class: 'hotbar-key' }, String(i + 1)),
        el('span', { class: 'hotbar-emoji' }, p.icon),
        el('span', { class: 'hotbar-count' }, '0')) as HTMLButtonElement;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.use(i);
      });
      this.slots.push(b);
      this.root.append(b);
    });
    uiRoot().append(this.root);
  }

  destroy() {
    this.root.remove();
  }

  update(self: LabSelf) {
    this.self = self;
    this.app.cfg.lab.potions.list.slice(0, 9).forEach((p, i) => {
      const b = this.slots[i];
      const n = self.potions[p.id] ?? 0;
      const fightOnly = !p.heal && !p.mana && !p.home;
      (b.querySelector('.hotbar-count') as HTMLElement).textContent = n ? String(n) : '';
      b.classList.toggle('missing', !n || fightOnly);
      b.title = `${p.name} ×${n}: ${p.desc}${fightOnly ? ' (in a fight: 🧪 Items)' : ''}`;
    });
  }

  /** Key i (0-based) / a tap: drink that potion (out of a fight). */
  use(i: number) {
    const p = this.app.cfg.lab.potions.list[i];
    if (!p || this.busy || this.app.labBattle) return;
    if (!(this.self?.potions[p.id] ?? 0)) return void labSay(`No ${p.name} left. ${this.app.cfg.lab.merchant.name} sells them.`, 'bad');
    if (!p.heal && !p.mana && !p.home) return void labSay(`${p.icon} ${p.name} only works in a fight (🧪 Items).`, 'info');
    this.busy = true;
    this.app.socket?.timeout(6000).emit('lab:item', { id: p.id }, (err, res) => {
      this.busy = false;
      if (err || !res.ok) {
        sfx.error();
        return void labSay(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      sfx.coin();
      labSay(res.text, 'good');
      if (res.left) return void this.app.exitLab(res.self);
      this.app.labHud?.updateSelf(res.self);
    });
  }
}

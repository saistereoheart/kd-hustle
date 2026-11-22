// 🗝️ Labirin Purba: your loadout, down the left of the screen. The four gear slots (weapon, shield,
// armour, charm): what you wear, in its tier's colour, with its name and stats; an empty slot shows
// the dashed outline of what goes there. Tap one to open your bag. (Plus the tavern drink, if any.)
import { LAB_SLOTS, gearLine, labGear, type LabSelf, type LabSlot } from '@kh/shared';
import type { App } from '../../app';
import { el } from '../dom';
import { openLabBag } from './labBag';

/** Each slot's shape (24×24 SVG path): a keris, a round shield, a vest, an amulet. */
const SHAPES: Record<LabSlot, string> = {
  weapon: 'M12 2 L14 4 C13 6 15 8 14 10 C13 12 14 14 13 15 L13 17 L16 17 L16 19 L13 19 L13 22 L11 22 L11 19 L8 19 L8 17 L11 17 L11 15 C10 13 11 11 10 9 C9 7 11 5 10 4 Z',
  shield: 'M12 2 L20 5 C20 13 17 18 12 22 C7 18 4 13 4 5 Z M12 6 L12 18',
  armour: 'M8 3 L10 5 L14 5 L16 3 L20 6 L18 10 L17 9 L17 21 L7 21 L7 9 L6 10 L4 6 Z',
  charm: 'M6 3 C6 9 18 9 18 3 M12 9 L12 11 M12 11 C15 11 17 14 17 16 C17 19 15 21 12 21 C9 21 7 19 7 16 C7 14 9 11 12 11 Z',
};
const NAMES: Record<LabSlot, string> = { weapon: 'Weapon', shield: 'Shield', armour: 'Armour', charm: 'Charm' };

function shape(slot: LabSlot, color: string | null) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'lab-slot-shape');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', SHAPES[slot]);
  if (color) {
    p.setAttribute('fill', color);
    p.setAttribute('stroke', '#111');
    p.setAttribute('stroke-width', '1');
  } else {
    // Empty: just a dashed outline of the shape.
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'rgba(255,255,255,0.4)');
    p.setAttribute('stroke-width', '1.2');
    p.setAttribute('stroke-dasharray', '2 1.6');
  }
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export class LabLoadout {
  private root: HTMLElement;

  constructor(private app: App) {
    this.root = el('div', { class: 'lab-loadout', 'data-testid': 'lab-loadout', 'aria-label': 'Your Labirin loadout' });
    document.body.append(this.root);
  }

  destroy() {
    this.root.remove();
  }

  update(s: LabSelf) {
    const cfg = this.app.cfg.lab;
    const slots = LAB_SLOTS.map((slot) => {
      const g = labGear(cfg, s.gear[slot]);
      const b = el(
        'button',
        { class: `lab-slot${g ? ' on' : ''}`, type: 'button', 'data-slot': slot, title: g ? `${g.name}: ${gearLine(g)}` : `${NAMES[slot]}: nothing worn (buy one from ${cfg.merchant.name})`, style: g ? `--tier:${g.color}` : '' },
        el('span', { class: 'lab-slot-icon' }, shape(slot, g ? g.color : null)),
        el('span', { class: 'lab-slot-text' }, el('b', {}, g ? g.name : NAMES[slot]), el('small', {}, g ? gearLine(g) : 'empty')),
      );
      b.addEventListener('click', () => openLabBag(this.app, 'gear'));
      return b;
    });
    const d = s.drink ? cfg.tavern.drinks.find((x) => x.id === s.drink!.id) : undefined;
    const drink = d && s.drink
      ? el('div', { class: 'lab-slot drink on', title: `${d.name}: ${d.desc}` }, el('span', { class: 'lab-slot-icon emoji' }, d.icon), el('span', { class: 'lab-slot-text' }, el('b', {}, d.name), el('small', {}, `${s.drink.left} fight${s.drink.left === 1 ? '' : 's'} left`)))
      : null;
    this.root.replaceChildren(el('div', { class: 'lab-loadout-head' }, '⚔️ Loadout'), ...slots, ...(drink ? [drink] : []));
  }
}

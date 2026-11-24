// What an active buff is called: a potion (its item), mall food (food:<lot>:<item>), or an event.
import type { App } from '../app';

export function buffName(app: App, item: string): { name: string; desc: string } {
  if (item.startsWith('food:')) {
    const [, lot, id] = item.split(':');
    const l = app.cfg.interiors.content.lots.find((x) => x.id === lot);
    const m = l?.menu.find((x) => x.id === id);
    return { name: m ? `${m.icon} ${m.name}` : '🍽️ Food', desc: l ? `From ${l.name}` : '' };
  }
  const def = app.items.get(item);
  return { name: def?.name ?? item.replace(/^event:/, ''), desc: def?.desc ?? '' };
}

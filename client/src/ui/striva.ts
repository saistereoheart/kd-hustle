// 🌈 STRIVA: an item at the top tier with every special variant (S + Shiny + Golden + Rainbow). Shown as
// one word in animated rainbow colours instead of "S · Shiny + Golden + Rainbow".
import { isStriva, type PublicConfig } from '@kh/shared';
import { el } from './dom';

let cfg: PublicConfig | null = null;

/** Called once the config is loaded. */
export function setStrivaConfig(c: PublicConfig) {
  cfg = c;
}

export function striva(grade: string | undefined, variant: string | undefined): boolean {
  return !!cfg && isStriva(cfg.grades, cfg.rarities.variants, grade, variant);
}

export function strivaTag(cls = ''): HTMLElement {
  return el('span', { class: `striva${cls ? ` ${cls}` : ''}`, title: 'STRIVA: Tier S with Shiny + Golden + Rainbow' }, 'STRIVA');
}

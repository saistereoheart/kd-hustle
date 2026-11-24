// 🚶 Faces for the crowd: passers-by, stall customers and cooks. Every different look is its own
// character picture on the graphics card (~1.5 MB), and dozens of strangers came and went, each
// with a brand-new face. Now the seed picks one of a few shared looks (how many: the memory budget).
// Named people (shopkeepers, cashiers, the walking NPCs) keep their own faces.
import { randomAppearance, seededRandom, type Appearance, type CharacterConfig } from '@kh/shared';
import { memoryBudget } from '../perf/memory';

export function crowdLook(cfg: CharacterConfig, seed: number): Appearance {
  const n = Math.max(1, memoryBudget().crowdLooks);
  const k = ((Math.floor(seed) % n) + n) % n;
  return randomAppearance(cfg, seededRandom(0x5eed + k * 7919));
}

import { describe, expect, it } from 'vitest';
import { mayVisit } from './visits';

describe('player visits', () => {
  it('everyone by default, minus the blocked; only the picked; nobody', () => {
    expect(mayVisit({ mode: 'all', allow: [], block: [] }, 1, 2)).toBe(true);
    expect(mayVisit({ mode: 'all', allow: [], block: [2] }, 1, 2)).toBe(false);
    expect(mayVisit({ mode: 'only', allow: [3], block: [] }, 1, 2)).toBe(false);
    expect(mayVisit({ mode: 'only', allow: [2], block: [] }, 1, 2)).toBe(true);
    expect(mayVisit({ mode: 'none', allow: [2], block: [] }, 1, 2)).toBe(false);
    expect(mayVisit({ mode: 'none', allow: [], block: [] }, 1, 1)).toBe(true); // your own
  });
});

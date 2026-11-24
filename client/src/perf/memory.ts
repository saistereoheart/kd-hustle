// 🧠 Keeping the game's memory low, so an 8 GB PC (or a phone) can play while doing other things.
//
// A web page can't set a hard limit on its own memory, so the game keeps itself inside a budget:
//  - Settings → Memory: "Low" (the default) keeps fewer, slightly softer map pictures; "Normal" is
//    the old, sharper map that uses about twice as much; "Very low" is for a PC with ~500 MB free.
//  - Signs over buildings are only made when they come near the screen (each text label is its own
//    canvas plus a picture on the graphics card, even while hidden: 500+ FOR SALE signs cost ~80 MB).
//  - A character picture holds walking, standing and riding; each emote is drawn on first use.
//  - Pictures that nobody on screen uses any more (a character's old outfit sheet, ~4.6 MB each,
//    and the vehicle pictures for an old paint job) are removed after a minute. Before, every
//    outfit change by any player made a new sheet that stayed for the rest of the session.
//  - A check every 20 s: if the pictures go over budget, everything that can go goes at once; if
//    the page's JS memory keeps growing past the limit anyway (a leak), the page reloads itself
//    (the server has everything, so nothing is lost) rather than eat the whole PC.
import Phaser from 'phaser';
import { loadPrefs } from '../ui/settings';

export interface MemoryBudget {
  /** Map chunk pictures kept in memory (MB): the ones around you always stay. */
  chunkMB: number;
  /** The sharpest the map is drawn (texels per world pixel). */
  maxChunkRes: number;
  /** How far past the screen edge chunks are drawn ahead of time (in chunks). */
  prefetch: number;
  /** All pictures together (MB): over this, everything unused is let go at once. */
  textureMB: number;
  /** JS memory (MB, where the browser tells us) that means something is leaking: reload. */
  heapMB: number;
  /** How many different faces the passers-by, customers and cooks share (each look is one picture). */
  crowdLooks: number;
  /** The most canvas pixels the game draws (the screen picture lives on the graphics card). */
  maxPixels: number;
}

// "Very low" is for a PC with only ~500 MB free: the map at one texel per world pixel, fewer chunks
// drawn ahead of you, the crowd sharing 6 faces and the canvas capped near 1366 × 768 pixels.
const TINY: MemoryBudget = { chunkMB: 20, maxChunkRes: 1, prefetch: 0.35, textureMB: 140, heapMB: 600, crowdLooks: 6, maxPixels: 1_100_000 };
const LOW: MemoryBudget = { chunkMB: 48, maxChunkRes: 1.25, prefetch: 0.6, textureMB: 320, heapMB: 1100, crowdLooks: 10, maxPixels: 3_700_000 };
const NORMAL: MemoryBudget = { chunkMB: 112, maxChunkRes: 2.5, prefetch: 1.1, textureMB: 700, heapMB: 2000, crowdLooks: 24, maxPixels: 3_700_000 };

export function memoryBudget(): MemoryBudget {
  const m = loadPrefs().memory;
  return m === 'normal' ? NORMAL : m === 'tiny' ? TINY : LOW;
}

// ------------------------------------------------------------------ pictures that can go
type Holder = Phaser.GameObjects.GameObject & { texture?: Phaser.Textures.Texture };

/** Which pictures can be removed when unused, and what goes with them (one group goes together). */
function groupOf(key: string): string | null {
  if (key.startsWith('char_')) return key.split(':')[0]; // the sheet and its head badge
  if (key.startsWith('sr_')) return key.replace(/_(side|front|back|dfront|dback)$/, ''); // a vehicle's five views
  return null;
}

const holders = new Map<string, Set<Holder>>();
const idleSince = new Map<string, number>();

/** Something now shows one of the removable pictures: it stays while that object lives. */
export function holdTexture(obj: Holder | null | undefined) {
  const key = obj?.texture?.key;
  const g = key ? groupOf(key) : null;
  if (!g) return;
  let s = holders.get(g);
  if (!s) holders.set(g, (s = new Set()));
  s.add(obj!);
  idleSince.delete(g);
}

/** Every texture group something on screen (or a live holder) still uses. */
function groupsInUse(game: Phaser.Game): Set<string> {
  const used = new Set<string>();
  const visit = (o: Phaser.GameObjects.GameObject) => {
    const k = (o as Holder).texture?.key;
    const g = k ? groupOf(k) : null;
    if (g) used.add(g);
    const list = (o as Phaser.GameObjects.Container).list;
    if (Array.isArray(list)) for (const c of list) visit(c);
  };
  for (const sc of game.scene.getScenes(false)) for (const o of sc.sys.displayList?.list ?? []) visit(o);
  for (const [g, s] of holders) {
    for (const o of s) {
      // Destroyed, or showing something else now: no longer holds this group.
      if (!o.scene || !o.texture || groupOf(o.texture.key) !== g) s.delete(o);
      else used.add(g);
    }
    if (!s.size) holders.delete(g);
  }
  return used;
}

/** Removes pictures nothing has used for `idleMs`. Returns how many groups went. */
export function sweepTextures(game: Phaser.Game, idleMs: number): number {
  const now = performance.now();
  const used = groupsInUse(game);
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(game.textures.list)) {
    const g = groupOf(key);
    if (g) groups.set(g, [...(groups.get(g) ?? []), key]);
  }
  let removed = 0;
  for (const [g, keys] of groups) {
    if (used.has(g)) {
      idleSince.delete(g);
      continue;
    }
    const since = idleSince.get(g) ?? now;
    idleSince.set(g, since);
    if (now - since < idleMs) continue;
    for (const k of keys) game.textures.remove(k);
    // A character's animations point at its sheet: they go too (made again with the sheet).
    const anims = (game.anims as unknown as { anims: Phaser.Structs.Map<string, unknown> }).anims;
    for (const a of [...anims.keys()]) if (a.startsWith(`${g}:`)) game.anims.remove(a);
    idleSince.delete(g);
    removed++;
  }
  for (const g of idleSince.keys()) if (!groups.has(g)) idleSince.delete(g);
  return removed;
}

// ------------------------------------------------------------------ measuring
export interface MemoryStats {
  /** JS memory in use (MB), or null where the browser doesn't say (Firefox, Safari). */
  heapMB: number | null;
  /** Pictures: how many, and about how big (MB, uncompressed, as on the graphics card). */
  textures: number;
  textureMB: number;
}

export function memoryStats(game: Phaser.Game | null | undefined): MemoryStats {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  let bytes = 0, n = 0;
  if (game) {
    for (const [k, t] of Object.entries(game.textures.list)) {
      if (k.startsWith('__')) continue;
      n++;
      for (const s of t.source) bytes += (s.width || 0) * (s.height || 0) * 4;
    }
  }
  return { heapMB: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null, textures: n, textureMB: Math.round(bytes / 1e6) };
}

// ------------------------------------------------------------------ the watch
const CHECK_MS = 20_000;
/** Unused pictures go after this long (walk away and back within it: nothing is redrawn). */
const IDLE_MS = 60_000;
/** Checks in a row over the JS limit before reloading (a big moment can spike it briefly). */
const STRIKES = 3;

export function startMemoryWatch(opts: {
  game: () => Phaser.Game | null | undefined;
  /** Drop every map chunk that isn't on screen. */
  trimMap: () => void;
  /** Reload the page (after telling the player). */
  reload: (why: string) => void;
}) {
  let strikes = 0;
  const check = () => {
    const game = opts.game();
    if (!game || document.hidden) return;
    const b = memoryBudget();
    sweepTextures(game, IDLE_MS);
    let s = memoryStats(game);
    if (s.textureMB > b.textureMB) {
      sweepTextures(game, 0);
      opts.trimMap();
      s = memoryStats(game);
      console.warn(`[memory] pictures over budget: trimmed to ${s.textureMB} MB (${s.textures})`);
    }
    if (s.heapMB !== null && s.heapMB > b.heapMB) {
      strikes++;
      console.warn(`[memory] JS memory ${s.heapMB} MB is over ${b.heapMB} MB (${strikes}/${STRIKES})`);
      if (strikes >= STRIKES) opts.reload(`${s.heapMB} MB`);
    } else strikes = 0;
  };
  return window.setInterval(check, CHECK_MS);
}

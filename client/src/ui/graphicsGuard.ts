// Graphics watchdog. Browsers (Firefox especially) sometimes throw away a page's graphics memory:
// the graphics card was busy or reset, its driver restarted, or the tab sat in the background for
// a long time. Then every drawn picture (the map, characters, trees, the minimap) goes blank and
// only text is left: a green screen with names floating on it. The game can't stop the browser
// doing that, so it notices and reloads itself (everything is saved on the server, so nothing is
// lost). If it keeps happening, it stops reloading and says what to try instead.
import { el, uiRoot } from './dom';

const RELOADS_KEY = 'kh_gfx_reloads';
/** Reading pixels back makes the GPU finish its work first (a small hitch on integrated
 *  graphics), so check rarely and read only two pixels. */
const CHECK_MS = 15000;

/** A 2D canvas that should never be empty (e.g. the minimap's painted map). */
type Probe = () => HTMLCanvasElement | null;

let shown = false;

function recentReloads(): number[] {
  try {
    const now = Date.now();
    return (JSON.parse(sessionStorage.getItem(RELOADS_KEY) ?? '[]') as number[]).filter((t) => now - t < 5 * 60_000);
  } catch {
    return [];
  }
}

function reload() {
  try {
    sessionStorage.setItem(RELOADS_KEY, JSON.stringify([...recentReloads(), Date.now()]));
  } catch {
    /* private mode: still reload */
  }
  location.reload();
}

function lost(why: string) {
  if (shown) return;
  shown = true;
  console.warn(`Graphics lost (${why}): reloading`);
  const tooMany = recentReloads().length >= 2;
  const btn = el('button', { class: 'btn primary', type: 'button', 'data-action': 'gfx-reload' }, 'Reload now');
  btn.addEventListener('click', reload);
  const note = el('p', {}, tooMany
    ? 'This keeps happening on this device. Try ⚙️ Settings → Graphics → Battery saver, close other heavy tabs, or play in Chrome / Edge.'
    : 'Your progress is saved. Reloading in a moment…');
  uiRoot().append(
    el('div', { class: 'overlay-msg gfx-lost', 'data-testid': 'gfx-lost' },
      el('div', { class: 'card' }, el('h2', {}, '🎨 The browser reset the graphics'), el('p', {}, 'The map and characters went blank (this happens in some browsers when the graphics card is busy or the tab was in the background a long time).'), note, btn)),
  );
  if (!tooMany) window.setTimeout(reload, 2500);
}

/** Is this canvas blank (its pixels wiped)? Samples a few points; a painted map is never clear. */
function blank(c: HTMLCanvasElement): boolean {
  try {
    const ctx = c.getContext('2d', { willReadFrequently: false });
    if (!ctx) return false;
    const pts = [[0.5, 0.5], [0.3, 0.7]];
    for (const [fx, fy] of pts) {
      const d = ctx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
      if (d[3] !== 0) return false;
    }
    return true;
  } catch {
    return false; // can't tell (e.g. privacy settings block reading pixels): assume fine
  }
}

/**
 * Watches the game's WebGL canvas (context lost) and a painted 2D canvas (wiped). Call once the
 * town is up.
 */
export function watchGraphics(gameCanvas: HTMLCanvasElement | null, probe: Probe) {
  gameCanvas?.addEventListener('webglcontextlost', () => lost('webgl'));
  const c = probe();
  c?.addEventListener('contextlost', () => lost('2d'));
  // Some browsers wipe 2D canvases without an event: check now and then (and on coming back to
  // the tab, when it's most likely). Only after it has been seen painted once.
  let seenPainted = false;
  const check = () => {
    const cv = probe();
    if (!cv) return;
    const isBlank = blank(cv);
    if (!isBlank) seenPainted = true;
    else if (seenPainted) lost('2d-wiped');
  };
  window.setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') window.setTimeout(check, 300);
  });
  check();
}

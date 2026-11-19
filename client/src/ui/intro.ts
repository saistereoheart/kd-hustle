// The start-game transition: after START GAME the screen goes dark with a small glowing dot in
// the middle while the town loads, then the town opens out of that dot (an iris wipe) and the
// lofi music fades in. Nothing pops in half-drawn.
import { lofi } from './lofi';

let cover: HTMLElement | null = null;
let fallback = 0;
let opening = false;

/** Dark cover + pulsing dot, shown while connecting and building the town. */
export function introCover() {
  if (cover) return;
  opening = false;
  cover = document.createElement('div');
  cover.className = 'intro-cover';
  cover.append(Object.assign(document.createElement('div'), { className: 'intro-dot' }));
  document.body.append(cover);
  requestAnimationFrame(() => cover?.classList.add('show'));
  // Never leave anyone stuck behind it.
  fallback = window.setTimeout(() => introReveal(), 20_000);
}

/** The town is drawn: open it up from the dot. */
export function introReveal() {
  const c = cover;
  if (!c || opening) return;
  opening = true;
  clearTimeout(fallback);
  // Two frames so the first town frame is on screen under the cover.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      c.classList.add('opening');
      const max = Math.hypot(window.innerWidth, window.innerHeight) / 2 + 30;
      const t0 = performance.now();
      const dur = 1100;
      const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      const frame = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const r = 6 + (max - 6) * ease(k);
        const mask = `radial-gradient(circle at 50% 50%, transparent ${r}px, #000 ${r + 1.5}px)`;
        c.style.maskImage = mask;
        c.style.setProperty('-webkit-mask-image', mask);
        if (k < 1) requestAnimationFrame(frame);
        else {
          c.remove();
          if (cover === c) cover = null;
        }
      };
      requestAnimationFrame(frame);
      lofi.begin();
    }),
  );
}

/** Back to the title (connection failed): just remove it. */
export function introCancel() {
  clearTimeout(fallback);
  cover?.remove();
  cover = null;
}

// 🌀 The Labirin portal's warp: the screen zooms into a purple swirl, the world changes behind it,
// then it unzooms into the new place. Only CSS transforms and opacity (the compositor does the work:
// no extra canvas, no per-frame script), about a second all told.
//
//   const w = startWarp();          // starts zooming in at once (while the server answers)
//   w.done(() => app.enterLab(...)); // swaps the world when fully covered, then unzooms
//   w.cancel();                      // the server said no: fade away
import { el } from '../dom';

const IN_MS = 520;
const OUT_MS = 620;

export interface Warp {
  done(swap: () => void): void;
  cancel(): void;
}

export function startWarp(): Warp {
  const box = el('div', { class: 'lab-warp', 'data-testid': 'lab-warp' }, el('i', { class: 'lw-glow' }), el('i', { class: 'lw-swirl' }), el('i', { class: 'lw-swirl b' }), el('i', { class: 'lw-core' }));
  document.body.append(box);
  document.body.classList.add('lab-warp-in');
  // Next frame: start the zoom in (so the starting state is drawn first).
  requestAnimationFrame(() => box.classList.add('in'));
  const covered = new Promise<void>((r) => window.setTimeout(r, IN_MS));
  let over = false;
  const end = () => {
    window.setTimeout(() => {
      box.remove();
      document.body.classList.remove('lab-warp-out');
    }, OUT_MS + 40);
  };
  return {
    done(swap) {
      if (over) return;
      over = true;
      void covered.then(() => {
        try {
          swap();
        } finally {
          document.body.classList.remove('lab-warp-in');
          document.body.classList.add('lab-warp-out');
          box.classList.add('out');
          end();
        }
      });
    },
    cancel() {
      if (over) return;
      over = true;
      document.body.classList.remove('lab-warp-in');
      box.classList.add('gone');
      end();
    },
  };
}

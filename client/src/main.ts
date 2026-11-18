import './styles.css';
import { makeDish } from '@kh/shared';
import { App } from './app';
import { playDish } from './ui/stall/cook';
import { cookStock } from './ui/stall/stallPanel';

const app = new App();
void app.start();

// Read-only debug hook (used by the Playwright smoke test and handy in the console).
declare global {
  interface Window {
    __kh: unknown;
  }
}
window.__kh = {
  state: () => document.body.dataset.state,
  self: () => app.town?.debugSelf() ?? null,
  remotes: () => app.town?.debugRemotes() ?? [],
  chat: () => app.chat?.lines() ?? [],
  lastSavedAt: () => app.lastSavedAt,
  wallet: () => ({ sen: app.store.walletSen, shards: app.store.shards, items: app.store.inventory.length }),
  job: () => app.store.job,
  progress: () => app.store.progress,
  stall: () => app.store.stall,
  stalls: () => [...app.store.stalls.values()],
  dish: () => app.cookingDish,
  openStall: (plot: string) => app.openStallAt(plot),
  plotPos: (plot: string) => app.map?.stallPlots.find((p) => p.id === plot) ?? null,
  luck: () => app.mods().luck,
  /** Inside a building? (its id, our room position, the stations) */
  interior: () => app.interior?.debugInfo() ?? null,
  inv: () => app.store.inventory.map((i) => ({ iid: i.iid, itemId: i.itemId })),
  myProps: () => app.store.myProps,
  home: () => app.home?.debugInfo() ?? null,
  /** Tests: place furniture in the home you're in (decorate mode). */
  homePlace: (iid: number, item: string, x: number, y: number, rot = 0) => app.home?.debugPlace(iid, item, x, y, rot),
  /** Tests: buy one piece of furniture (you must be inside the store; the server checks). */
  buyFurniture: (item: string) => app.socket?.emit('furniture:buy', { item, qty: 1 }, () => {}),
  /** Where to stand to use an interactable (tile coords for /tp). */
  spotOf: (id: string) => {
    const it = app.map?.interactables.find((i) => i.id === id);
    return it ? { x: Math.floor(it.x), y: Math.floor(it.y) } : null;
  },
  /** Where to stand to enter a building (door front, tile coords). */
  doorOf: (id: string) => {
    const d = app.map?.buildings.find((b) => b.id === id)?.door;
    return d ? { x: d.frontX + 0.5, y: d.frontY + 0.5 } : null;
  },
  /** Open the UI of an interactable by id (the server still checks you are standing there). */
  open: (id: string) => {
    const it = app.map?.interactables.find((i) => i.id === id);
    if (it) app.openInteractable(it);
  },
  // Dev only: move the CAMERA (not the player) to look around, for screenshots.
  ...(import.meta.env.DEV
    ? {
        peek: (x: number, y: number) => app.town?.debugPeek(x, y),
        /** Dev/tests: play a recipe's cooking screens locally (nothing is sent; for looking at the art). */
        previewDish: (recipeId: string, addons: string[] = []) => {
          const r = app.cfg.recipes.recipes.find((x) => x.id === recipeId);
          if (!r) return;
          const steps = makeDish(r, (n: number) => Math.floor(Math.random() * n), addons);
          const dish = { dishId: 'preview', recipe: r.id, customerId: 0, steps, windowMult: 1, blogger: false };
          app.cookingDish = dish;
          void playDish(app.cfg.recipes, dish, `${r.icon} ${r.name}`, () => {}, () => cookStock(app, r.id));
        },
        /** Dev/tests: every door of a building (front tile centre + outward normal). */
        doors: (id: string) => app.map?.buildings.find((b) => b.id === id)?.doors.map((d) => ({ x: d.frontX + 0.5, y: d.frontY + 0.5, nx: d.nx, ny: d.ny })) ?? [],
        /** Dev/tests: zoom the town camera (1 = normal) for close-up screenshots. */
        zoom: (z: number) => {
          app.town?.cameras.main.setZoom(z * app.dpr);
        },
        /** Dev/tests: send any socket message (the server still checks everything). */
        emit: (event: string, ...args: unknown[]) => (app.socket as unknown as { emit: (e: string, ...a: unknown[]) => void } | null)?.emit(event, ...args, () => {}),
        /** Dev/tests: show an errand's beacon without walking to an NPC (client-side only). */
        fakeErrand: (e: unknown) => {
          app.store.errand = e as typeof app.store.errand;
          app.store.emit();
        },
      }
    : {}),
};

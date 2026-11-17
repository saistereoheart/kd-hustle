import './styles.css';
import { App } from './app';

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
  // Dev only: move the CAMERA (not the player) to look around, for screenshots.
  ...(import.meta.env.DEV ? { peek: (x: number, y: number) => app.town?.debugPeek(x, y) } : {}),
};

// Phase 4 acceptance: buy a pasar malam stall, open it at night, customers queue (the other
// player sees them), cook a real Nasi Lemak through the mini-games, use a Perfect Cook Token,
// buy stock at the hypermarket, and the stall survives a reload.
import { expect, test, type Browser, type Page } from '@playwright/test';

const SHOTS = 'test-results/screenshots';
type Stall = { tier: number; plot: string; stock: Record<string, Array<{ qty: number }>>; perfectTokens: number };
type PubStall = { owner: number; plot: string; open: boolean; queue: Array<{ id: number }> };
type KH = {
  wallet: () => { sen: number; items: number };
  stall: () => Stall | null;
  stalls: () => PubStall[];
  plotPos: (id: string) => { x: number; y: number } | null;
  open: (id: string) => void;
  progress: () => { stats: Record<string, number> };
};
const kh = <T>(p: Page, fn: (k: KH) => T) => p.evaluate((src) => new Function('k', `return (${src})(k)`)((window as unknown as { __kh: KH }).__kh), fn.toString()) as Promise<T>;

/** Teleport (admin /tp) to where an interactable is used: its spot, or its building's door. */
async function goTo(p: Page, id: string) {
  const s = await p.evaluate((i) => (window as unknown as { __kh: { spotOf: (i: string) => { x: number; y: number } } }).__kh.spotOf(i), id);
  await p.keyboard.press('Enter');
  await p.fill('#chat-input', `/tp ${s.x} ${s.y}`);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
}

async function player(browser: Browser, name: string, mobile: boolean, errors: string[]) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] ${m.text()}`));
  await page.goto('/');
  await page.waitForSelector('#auth');
  await page.fill('input[name=username]', name);
  await page.fill('input[name=password]', 'secret123');
  await page.fill('input[name=confirm]', 'secret123');
  await page.click('#auth button[type=submit]');
  await page.click('[data-testid=title-start]'); // then the start screen
  await page.waitForSelector('#creator');
  await page.click('[data-action=save]');
  await page.waitForFunction(() => document.body.dataset.state === 'town');
  return { ctx, page };
}

async function chat(p: Page, text: string) {
  await p.keyboard.press('Enter');
  await p.fill('#chat-input', text);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
}

/** Plays the current dish perfectly-ish from inside the page (real pointer/keyboard events). */
async function playDish(p: Page) {
  await p.waitForSelector('[data-testid=cook-canvas]');
  await p.evaluate(async () => {
    type Step = { kind: string; zone?: [number, number]; fillMs?: number; targetMs?: number; beats?: number[]; order?: string[]; want?: string[]; points?: Array<[number, number]>; durationMs?: number; rise?: number; fall?: number };
    const dish = (window as unknown as { __kh: { dish: () => { steps: Step[] } } }).__kh.dish();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const key = (type: 'keydown' | 'keyup') => window.dispatchEvent(new KeyboardEvent(type, { code: 'Space', key: ' ' }));
    const canvas = document.querySelector('[data-testid=cook-canvas]') as HTMLCanvasElement;
    for (let i = 0; i < dish.steps.length; i++) {
      const s = dish.steps[i];
      for (let k = 0; k < 300 && !document.querySelector(`.cw-stage[data-step="${i}"].active`); k++) await sleep(10);
      const t0 = performance.now();
      if (s.kind === 'hold') {
        key('keydown');
        await sleep(((s.zone![0] + s.zone![1]) / 2) * s.fillMs! - 8);
        key('keyup');
      } else if (s.kind === 'timing') {
        await sleep(Math.max(0, s.targetMs! - (performance.now() - t0) - 10));
        key('keydown');
        key('keyup');
      } else if (s.kind === 'rhythm') {
        for (const b of s.beats!) {
          await sleep(Math.max(0, b - (performance.now() - t0)));
          key('keydown');
          key('keyup');
        }
      } else if (s.kind === 'sequence') {
        for (const id of s.order!) {
          (document.querySelector(`[data-opt="${id}"]`) as HTMLButtonElement).click();
          await sleep(120);
        }
      } else if (s.kind === 'assemble') {
        // Tap each ingredient box the order asks for (any order); the last one serves it.
        for (const id of s.want!) {
          (document.querySelector(`.cook-boxes [data-opt="${id}"]`) as HTMLButtonElement).click();
          await sleep(150);
        }
      } else if (s.kind === 'path') {
        const r = canvas.getBoundingClientRect();
        const ev = (type: string, x: number, y: number) =>
          canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: r.left + x * r.width, clientY: r.top + y * r.height, buttons: 1, pointerId: 7, pointerType: 'mouse', isPrimary: true }));
        const pts = s.points!;
        ev('pointerdown', pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) {
          for (let f = 1; f <= 6; f++) {
            ev('pointermove', pts[k - 1][0] + ((pts[k][0] - pts[k - 1][0]) * f) / 6, pts[k - 1][1] + ((pts[k][1] - pts[k - 1][1]) * f) / 6);
            await sleep(16);
          }
        }
        ev('pointerup', pts[pts.length - 1][0], pts[pts.length - 1][1]);
      } else if (s.kind === 'meter') {
        const c = (s.zone![0] + s.zone![1]) / 2;
        key('keydown');
        await sleep(((c - 0.15) / s.rise!) * 1000);
        key('keyup');
        const f = s.fall! / (s.rise! + s.fall!);
        while (performance.now() - t0 < s.durationMs!) {
          key('keydown');
          await sleep(200 * f);
          key('keyup');
          await sleep(200 * (1 - f));
        }
      }
    }
  });
}

test('phase 4: a pasar malam stall, customers, cooking and stock', async ({ browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const tag = Date.now().toString(36).slice(-5);
  const A = await player(browser, `chef_${tag}`, false, errors);
  const B = await player(browser, `makan_${tag}`, true, errors);

  // --- Become a Hustler, make it night, buy a stall from the phone ---
  await chat(A.page, '/setstage me 2');
  await chat(A.page, '/time 20');
  await expect(A.page.getByTestId('hud-clock')).toContainText('8:');
  await A.page.keyboard.press('p');
  await A.page.click('[data-app=business]');
  await A.page.screenshot({ path: `${SHOTS}/p4-1-business-buy.png` });
  const w0 = (await kh(A.page, (k) => k.wallet())).sen;
  await A.page.click('[data-action=stall-buy-1]');
  await expect.poll(async () => (await kh(A.page, (k) => k.stall()))?.tier).toBe(1);
  expect((await kh(A.page, (k) => k.wallet())).sen).toBeLessThan(w0);
  await A.page.waitForTimeout(400);
  await A.page.screenshot({ path: `${SHOTS}/p4-2-business-stall.png` });
  await A.page.keyboard.press('Escape');

  // --- Walk (teleport) to the stall; B comes to watch ---
  const plot = (await kh(A.page, (k) => k.stall()))!.plot;
  const pos = (await A.page.evaluate((id) => (window as unknown as { __kh: KH }).__kh.plotPos(id), plot))!;
  await chat(A.page, `/tp ${Math.floor(pos.x)} ${Math.floor(pos.y) + 1}`);
  await chat(B.page, `/tp ${Math.floor(pos.x) + 3} ${Math.floor(pos.y) + 4}`);
  // A Customer Rush brings people in faster.
  await chat(A.page, '/give me item customer_rush');
  await A.page.keyboard.press('b');
  await A.page.click('.item-card[data-item=customer_rush]');
  await A.page.click('[data-action=use]');
  await A.page.keyboard.press('Escape');
  await expect.poll(async () => (await kh(A.page, (k) => k.stalls())).find((s) => s.plot === plot)?.queue.length ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
  // The other player sees the open stall and its queue.
  await expect.poll(async () => (await kh(B.page, (k) => k.stalls())).find((s) => s.plot === plot)?.queue.length ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
  await A.page.waitForTimeout(1500);
  await A.page.screenshot({ path: `${SHOTS}/p4-3-stall-at-night.png` });
  await B.page.screenshot({ path: `${SHOTS}/p4-3b-stall-seen-on-phone.png` });

  // --- Cook a real Nasi Lemak ---
  await A.page.keyboard.press('e');
  await A.page.waitForSelector('[data-testid=stall-panel]');
  await A.page.screenshot({ path: `${SHOTS}/p4-4-stall-panel.png` });
  const before = (await kh(A.page, (k) => k.wallet())).sen;
  await A.page.click('[data-action=cook-next]');
  await A.page.waitForSelector('[data-testid=cook]');
  await A.page.waitForTimeout(300);
  await A.page.screenshot({ path: `${SHOTS}/p4-5-cooking.png` });
  await expect(A.page.locator('[data-testid=cook-stock]')).toBeVisible(); // stock shown while cooking
  await playDish(A.page);
  await A.page.waitForSelector('[data-testid=dish-result]', { timeout: 30_000 });
  await A.page.screenshot({ path: `${SHOTS}/p4-6-dish-result.png` });
  const quality = await A.page.locator('.dish-quality').textContent();
  expect(quality).not.toContain('Burnt');
  expect((await kh(A.page, (k) => k.wallet())).sen).toBeGreaterThan(before);
  expect((await kh(A.page, (k) => k.progress())).stats.dishes).toBe(1);
  await A.page.click('[data-action=dish-done]');

  // --- A Perfect Cook Token serves a Perfect dish without the mini-game ---
  await A.page.keyboard.press('Escape');
  await chat(A.page, '/give me item perfect_token');
  await A.page.keyboard.press('b');
  await A.page.click('.item-card[data-item=perfect_token]');
  await A.page.click('[data-action=use]');
  await expect.poll(async () => (await kh(A.page, (k) => k.stall()))?.perfectTokens).toBe(10);
  await A.page.keyboard.press('Escape');
  await expect.poll(async () => (await kh(A.page, (k) => k.stalls())).find((s) => s.plot === plot)?.queue.length ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
  await A.page.keyboard.press('e');
  await A.page.click('[data-action=cook-token]');
  await A.page.waitForSelector('[data-testid=dish-result]');
  await expect(A.page.locator('.dish-quality')).toContainText('PERFECT');
  await A.page.click('[data-action=dish-done]');
  await A.page.keyboard.press('Escape');

  // --- Buy stock in person at Gergasi Hypermarket ---
  await goTo(A.page, 'gergasi');
  const stockBefore = (await kh(A.page, (k) => k.stall()))!.stock.nasi_lemak?.reduce((a, b) => a + b.qty, 0) ?? 0;
  await kh(A.page, (k) => k.open('gergasi'));
  await A.page.waitForSelector('[data-testid=market-panel]');
  await A.page.click('[data-action=stock-nasi_lemak-50]');
  await expect.poll(async () => (await kh(A.page, (k) => k.stall()))!.stock.nasi_lemak.reduce((a, b) => a + b.qty, 0)).toBe(stockBefore + 50);
  await A.page.screenshot({ path: `${SHOTS}/p4-7-hypermarket.png` });
  await A.page.keyboard.press('Escape');

  // --- The phone's Business app on a phone ---
  await B.page.click('[data-action=phone]');
  await B.page.click('[data-app=business]');
  await B.page.screenshot({ path: `${SHOTS}/p4-8-business-on-phone.png` });
  await B.page.click('.panel-close');

  // --- Survives a reload ---
  await A.page.reload();
  await A.page.click('[data-testid=title-start]');
  await A.page.waitForFunction(() => document.body.dataset.state === 'town');
  expect((await kh(A.page, (k) => k.stall()))?.tier).toBe(1);
  expect((await kh(A.page, (k) => k.stall()))?.perfectTokens).toBe(9);

  expect(errors).toEqual([]);
  await A.ctx.close();
  await B.ctx.close();
});

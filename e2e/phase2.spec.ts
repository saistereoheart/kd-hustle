// Phase 2 acceptance: earn RM from a job, roll crates with a visible reel, equip a hat the
// other player can see, pawn an item, use the hotbar bicycle, and take a Ronda ride.
import { expect, test, type Browser, type Page } from '@playwright/test';

const SHOTS = 'test-results/screenshots';
type KH = {
  state: () => string;
  wallet: () => { sen: number; shards: number; items: number };
  job: () => { kind: string } | null;
  open: (id: string) => void;
  remotes: () => Array<{ name: string; cosmetics: Record<string, { itemId: string; variant: string }>; vehicle: string | null }>;
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
const wallet = (p: Page) => kh(p, (k) => k.wallet());

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

test('phase 2: crates, cosmetics, pawn shop and jobs', async ({ browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const tag = Date.now().toString(36).slice(-5);
  const A = await player(browser, `rich_${tag}`, false, errors);
  const B = await player(browser, `watch_${tag}`, true, errors);

  // Everyone starts with RM 300.
  expect((await wallet(A.page)).sen).toBe(30000);
  await expect(A.page.getByTestId('wallet')).toHaveText('RM 300');

  // --- Capsule Machine: ×1 reel, then ×10 grid ---
  await goTo(A.page, 'capsule_machine');
  await kh(A.page, (k) => k.open('capsule_machine'));
  await A.page.waitForSelector('[data-testid=crate-panel]');
  await A.page.screenshot({ path: `${SHOTS}/p2-1-crate-panel.png` });
  await A.page.click('[data-roll="1"]');
  await A.page.waitForSelector('[data-testid=reveal]');
  await A.page.waitForTimeout(1500);
  await A.page.screenshot({ path: `${SHOTS}/p2-2-reel-spinning.png` });
  await A.page.locator('[data-action=skip]').click({ timeout: 3000 }).catch(() => {}); // may have stopped already
  await A.page.waitForSelector('[data-action=reveal-ok]');
  await A.page.screenshot({ path: `${SHOTS}/p2-3-reel-result.png` });
  await A.page.click('[data-action=reveal-ok]');
  expect((await wallet(A.page)).sen).toBeGreaterThanOrEqual(28000 - 1); // RM 20 spent (+ maybe a page reward)
  await A.page.click('[data-roll="10"]');
  await A.page.waitForSelector('[data-testid=reveal]');
  await A.page.waitForTimeout(1200);
  await A.page.locator('[data-action=skip]').click({ timeout: 3000 }).catch(() => {}); // may have stopped already
  await A.page.waitForSelector('[data-action=reveal-ok]');
  await A.page.screenshot({ path: `${SHOTS}/p2-4-grid.png` });
  await A.page.click('[data-action=reveal-ok]');
  expect((await wallet(A.page)).items).toBe(11);
  await A.page.keyboard.press('Escape');

  // --- Admin /give, then wear a Golden Crown that the other player sees ---
  await A.page.keyboard.press('Enter');
  await A.page.fill('#chat-input', '/give me item golden_crown golden');
  await A.page.keyboard.press('Enter');
  await expect.poll(async () => (await wallet(A.page)).items).toBe(12);
  await A.page.keyboard.press('b');
  await A.page.waitForSelector('[data-testid=bag-panel]');
  await A.page.click('.item-card[data-item=golden_crown]');
  await A.page.click('[data-action=equip]');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0]?.cosmetics?.hat?.itemId, { timeout: 10_000 }).toBe('golden_crown');
  await A.page.screenshot({ path: `${SHOTS}/p2-5-bag.png` });
  await A.page.keyboard.press('Escape');
  await A.page.waitForTimeout(500);
  await A.page.screenshot({ path: `${SHOTS}/p2-6-crown-worn.png` });
  await B.page.screenshot({ path: `${SHOTS}/p2-6b-crown-seen-on-phone.png` });

  // --- Kedai Pajak: sell one item ---
  const beforeSell = (await wallet(A.page)).sen;
  await goTo(A.page, 'kedai_pajak');
  await kh(A.page, (k) => k.open('kedai_pajak'));
  await A.page.waitForSelector('[data-testid=pawn-panel]');
  await A.page.click('[data-action=sell-one] >> nth=0');
  await expect.poll(async () => (await wallet(A.page)).sen).toBeGreaterThan(beforeSell);
  await A.page.keyboard.press('Escape');

  // --- Hotbar: key 1 hops on the starter bicycle (the other player sees it), 1 again hops off ---
  await A.page.keyboard.press('1');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0]?.vehicle, { timeout: 10_000 }).toBe('bicycle');
  await A.page.screenshot({ path: `${SHOTS}/p2-7a-bicycle.png` });
  await A.page.keyboard.press('1');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0]?.vehicle, { timeout: 10_000 }).toBeNull();

  // --- Car wash job at Kilat Car Wash: play all three stages ---
  await goTo(A.page, 'carwash');
  const beforeWash = (await wallet(A.page)).sen;
  await kh(A.page, (k) => k.open('carwash'));
  await A.page.click('[data-job=carwash]');
  const canvas = A.page.getByTestId('carwash');
  await canvas.waitFor();
  type Wash = { spots: Array<[number, number, number]>; rinse: { area: [number, number, number, number]; rows: number }; polish: { spots: Array<[number, number]>; intervalMs: number } };
  const wash = (await kh(A.page, (k) => k.job())) as unknown as Wash;
  // Play all three stages from inside the page (Playwright's own mouse calls take ~0.3 s each in
  // headless Chrome, far too slow for a 55 s timer). Same pointer events a finger/mouse makes.
  await A.page.evaluate(async (w: Wash) => {
    const c = document.querySelector('[data-testid=carwash]') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
    const mv = async (x: number, y: number) => {
      c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + x * r.width, clientY: r.top + y * r.height, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      await sleep(16);
    };
    const scrub = async (x: number, y: number, n: number, amp: number) => {
      for (let i = 0; i < n; i++) await mv(x + (i % 2 ? amp : -amp), y);
    };
    const until = async (stage: number) => {
      for (let i = 0; i < 200 && !document.querySelector(`.cw-stage[data-stage="${stage}"]`)?.classList.contains('active'); i++) await sleep(10);
    };
    // 1. Soap: scrub every spot (stubborn ones need more strokes).
    for (const [sx, sy, hits] of w.spots) await scrub(sx, sy, hits + 3, 0.025);
    await until(1);
    // 2. Rinse: sweep the hose along each row of the grid, twice.
    const [x0, y0, x1, y1] = w.rinse.area;
    for (let row = 0; row < w.rinse.rows; row++) {
      const y = y0 + ((row + 0.5) / w.rinse.rows) * (y1 - y0);
      for (let pass = 0; pass < 2; pass++) for (let x = x0 + 0.01; x < x1 - 0.005; x += 0.02) await mv(x, y);
    }
    await until(2);
    // 3. Polish: each shine mark shows for a while, one after another. Buff each in its window.
    const t0 = performance.now();
    for (const [k, [mx, my]] of w.polish.spots.entries()) {
      const wait = t0 + k * w.polish.intervalMs + 250 - performance.now();
      if (wait > 0) await sleep(wait);
      await scrub(mx, my, 8, 0.03);
    }
  }, wash);
  await A.page.screenshot({ path: `${SHOTS}/p2-7b-carwash.png` });
  await expect.poll(async () => (await wallet(A.page)).sen, { timeout: 15_000 }).toBeGreaterThan(beforeWash);
  await expect(A.page.getByTestId('carwash')).toHaveCount(0, { timeout: 10_000 });

  // --- Delivery job: done on the bicycle (no free motorbike) ---
  await goTo(A.page, 'jobsboard');
  await kh(A.page, (k) => k.open('jobsboard'));
  await A.page.click('[data-job=delivery]');
  await A.page.waitForSelector('[data-testid=job-hud]:not(.hidden)');
  await A.page.waitForTimeout(500);
  expect((await kh(B.page, (k) => k.remotes()))[0]?.vehicle ?? null).toBeNull();
  await A.page.keyboard.press('1');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0]?.vehicle, { timeout: 10_000 }).toBe('bicycle');
  await A.page.keyboard.down('ArrowRight');
  await A.page.waitForTimeout(700);
  await A.page.keyboard.up('ArrowRight');
  await A.page.screenshot({ path: `${SHOTS}/p2-7c-delivery.png` });
  await A.page.click('[data-testid=job-hud] [data-action=cancel-job]');
  await A.page.keyboard.press('1');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0]?.vehicle, { timeout: 10_000 }).toBeNull();

  // --- Ronda ride: 📱 Phone → Ronda → pick a spot → fare → book → ride ---
  expect(await A.page.locator('.hotbar-slot[data-slot="1"]').textContent()).not.toContain('🛵'); // no leftover motorbike
  await A.page.keyboard.press('p');
  await A.page.click('[data-app=rides]');
  await A.page.click('[data-action=open-ronda]');
  const fullmap = A.page.getByTestId('fullmap');
  await fullmap.waitFor();
  const mb = (await fullmap.boundingBox())!;
  const fare = A.page.getByTestId('ronda-fare');
  // Tap spots around us until one is reachable (some taps land on buildings far from a road).
  for (const [dx, dy] of [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25], [0.3, 0.3], [-0.3, -0.3]]) {
    await A.page.mouse.click(mb.x + mb.width * (0.5 + dx), mb.y + mb.height * (0.5 + dy));
    if (await fare.waitFor({ timeout: 4000 }).then(() => true, () => false)) break;
  }
  await expect(fare).toBeVisible();
  await A.page.screenshot({ path: `${SHOTS}/p2-7d-ronda-quote.png` });
  const fareSen = Math.round(Number((await fare.textContent())!.replace(/[^0-9.]/g, '')) * 100);
  const beforeRide = (await wallet(A.page)).sen;
  const startPos = (await A.page.evaluate(() => (window as unknown as { __kh: { self: () => { x: number; y: number } } }).__kh.self()))!;
  await A.page.click('[data-action=ronda-book]');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0]?.vehicle, { timeout: 10_000 }).toBe('ronda');
  expect((await wallet(A.page)).sen).toBe(beforeRide - fareSen);
  await A.page.waitForSelector('[data-testid=ride-hud]');
  // The rider sets off after the pickup wait; the passenger moves without touching the keys.
  await expect.poll(async () => {
    const me = (await A.page.evaluate(() => (window as unknown as { __kh: { self: () => { x: number; y: number } } }).__kh.self()))!;
    return Math.hypot(me.x - startPos.x, me.y - startPos.y);
  }, { timeout: 15_000 }).toBeGreaterThan(64);
  await A.page.screenshot({ path: `${SHOTS}/p2-7e-ronda-riding.png` });
  await B.page.screenshot({ path: `${SHOTS}/p2-7f-ronda-seen-on-phone.png` });
  await A.page.click('[data-action=ronda-stop]');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0]?.vehicle, { timeout: 10_000 }).toBeNull();
  await expect(A.page.getByTestId('ride-hud')).toHaveCount(0);

  // --- Manifest: hold the 🧘 emote (key −) and earn RM every second, then upgrade the skill ---
  await A.page.waitForTimeout(500);
  const beforeManifest = (await wallet(A.page)).sen;
  await A.page.keyboard.press('Minus');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0] && (await B.page.evaluate(() => (window as unknown as { __kh: { remotes: () => Array<{ emote: string | null }> } }).__kh.remotes()[0]?.emote)), { timeout: 10_000 }).toBe('manifest');
  await A.page.screenshot({ path: `${SHOTS}/p2-8-manifest.png` });
  await expect.poll(async () => (await wallet(A.page)).sen, { timeout: 25_000 }).toBeGreaterThanOrEqual(beforeManifest + 10);
  // Skills live in the HustlePhone now (Phase 3): 📱 → Skills → Fortune → Manifesting.
  await A.page.keyboard.press('p');
  await A.page.click('[data-app=skills]');
  await A.page.click('[data-branch=fortune]');
  await A.page.click('[data-action=upgrade-manifest]');
  await expect(A.page.locator('[data-skill=manifest] .lv-badge')).toHaveText(/^Lv 2\//);
  await A.page.screenshot({ path: `${SHOTS}/p2-9-skills.png` });
  await A.page.keyboard.press('Escape');
  // Stop manifesting (press − again) and let the last payout land before snapshotting.
  await A.page.keyboard.press('Minus');
  await A.page.waitForTimeout(2500);

  // Money survives a reload (it lives on the server).
  const w = await wallet(A.page);
  await A.page.reload();
  await A.page.click('[data-testid=title-start]');
  await A.page.waitForFunction(() => document.body.dataset.state === 'town');
  expect(await wallet(A.page)).toEqual(w);

  expect(errors).toEqual([]);
  await A.ctx.close();
  await B.ctx.close();
});

// Phase 2 acceptance: earn RM from a job, roll crates with a visible reel, equip a hat the
// other player can see, pawn an item, and ride the delivery motorbike.
import { expect, test, type Browser, type Page } from '@playwright/test';

const SHOTS = 'test-results/screenshots';
type KH = {
  state: () => string;
  wallet: () => { sen: number; shards: number; items: number };
  job: () => { kind: string; spots?: Array<[number, number]> } | null;
  open: (id: string) => void;
  remotes: () => Array<{ name: string; cosmetics: Record<string, { itemId: string; variant: string }>; vehicle: string | null }>;
};
const kh = <T>(p: Page, fn: (k: KH) => T) => p.evaluate((src) => new Function('k', `return (${src})(k)`)((window as unknown as { __kh: KH }).__kh), fn.toString()) as Promise<T>;
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
  await kh(A.page, (k) => k.open('capsule_machine'));
  await A.page.waitForSelector('[data-testid=crate-panel]');
  await A.page.screenshot({ path: `${SHOTS}/p2-1-crate-panel.png` });
  await A.page.click('[data-roll="1"]');
  await A.page.waitForSelector('[data-testid=reveal]');
  await A.page.waitForTimeout(1500);
  await A.page.screenshot({ path: `${SHOTS}/p2-2-reel-spinning.png` });
  await A.page.click('[data-action=skip]');
  await A.page.waitForSelector('[data-action=reveal-ok]');
  await A.page.screenshot({ path: `${SHOTS}/p2-3-reel-result.png` });
  await A.page.click('[data-action=reveal-ok]');
  expect((await wallet(A.page)).sen).toBeGreaterThanOrEqual(28000 - 1); // RM 20 spent (+ maybe a page reward)
  await A.page.click('[data-roll="10"]');
  await A.page.waitForSelector('[data-action=skip]');
  await A.page.waitForTimeout(1200);
  await A.page.click('[data-action=skip]');
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
  await kh(A.page, (k) => k.open('kedai_pajak'));
  await A.page.waitForSelector('[data-testid=pawn-panel]');
  await A.page.click('[data-action=sell-one] >> nth=0');
  await expect.poll(async () => (await wallet(A.page)).sen).toBeGreaterThan(beforeSell);
  await A.page.keyboard.press('Escape');

  // --- Car wash job: actually scrub every dirt spot ---
  const beforeWash = (await wallet(A.page)).sen;
  await kh(A.page, (k) => k.open('jobsboard'));
  await A.page.click('[data-job=carwash]');
  const canvas = A.page.getByTestId('carwash');
  await canvas.waitFor();
  const box = (await canvas.boundingBox())!;
  const spots = (await kh(A.page, (k) => k.job()?.spots ?? [])) as Array<[number, number]>;
  for (const [sx, sy] of spots) {
    const cx = box.x + sx * box.width;
    const cy = box.y + sy * box.height;
    await A.page.mouse.move(cx, cy);
    await A.page.mouse.down();
    for (let i = 0; i < 10; i++) {
      await A.page.mouse.move(cx + (i % 2 ? 1 : -1) * box.width * 0.03, cy, { steps: 1 });
      await A.page.waitForTimeout(16);
    }
    await A.page.mouse.up();
  }
  await expect.poll(async () => (await wallet(A.page)).sen, { timeout: 10_000 }).toBeGreaterThan(beforeWash);

  // --- Delivery job: hop on the motorbike (the other player sees it), then cancel ---
  await kh(A.page, (k) => k.open('jobsboard'));
  await A.page.click('[data-job=delivery]');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0]?.vehicle, { timeout: 10_000 }).toBe('motorbike');
  await A.page.keyboard.down('ArrowRight');
  await A.page.waitForTimeout(700);
  await A.page.keyboard.up('ArrowRight');
  await A.page.screenshot({ path: `${SHOTS}/p2-7-delivery.png` });
  await A.page.click('[data-testid=job-hud] [data-action=cancel-job]');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0]?.vehicle, { timeout: 10_000 }).toBeNull();

  // --- Manifest: hold the 🧘 emote (key −) and earn RM every second, then upgrade the skill ---
  await A.page.waitForTimeout(500);
  const beforeManifest = (await wallet(A.page)).sen;
  await A.page.keyboard.press('Minus');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0] && (await B.page.evaluate(() => (window as unknown as { __kh: { remotes: () => Array<{ emote: string | null }> } }).__kh.remotes()[0]?.emote)), { timeout: 10_000 }).toBe('manifest');
  await A.page.screenshot({ path: `${SHOTS}/p2-8-manifest.png` });
  await expect.poll(async () => (await wallet(A.page)).sen, { timeout: 25_000 }).toBeGreaterThanOrEqual(beforeManifest + 10);
  await A.page.keyboard.press('b');
  await A.page.click('[data-tab=skills]');
  await A.page.click('[data-action=upgrade-manifest]');
  await expect(A.page.getByText('Lv 2')).toBeVisible();
  await A.page.screenshot({ path: `${SHOTS}/p2-9-skills.png` });
  await A.page.keyboard.press('Escape');
  // Stop manifesting (press − again) and let the last payout land before snapshotting.
  await A.page.keyboard.press('Minus');
  await A.page.waitForTimeout(2500);

  // Money survives a reload (it lives on the server).
  const w = await wallet(A.page);
  await A.page.reload();
  await A.page.waitForFunction(() => document.body.dataset.state === 'town');
  expect(await wallet(A.page)).toEqual(w);

  expect(errors).toEqual([]);
  await A.ctx.close();
  await B.ctx.close();
});

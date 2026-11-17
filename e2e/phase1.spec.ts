// Phase 1 acceptance smoke test: two players (desktop 1920×1080 + phone 390×844) register,
// create characters, see each other move, chat, emote, and get their state back after a
// reload and a logout/login. Screenshots go to test-results/screenshots/.
import { expect, test, type Browser, type Page } from '@playwright/test';

const SHOTS = 'test-results/screenshots';

type Pos = { id: number; x: number; y: number } | null;
const self = (p: Page) => p.evaluate(() => (window as unknown as { __kh: { self: () => Pos } }).__kh.self());
const remotes = (p: Page) =>
  p.evaluate(() => (window as unknown as { __kh: { remotes: () => Array<{ id: number; name: string; x: number; y: number; emote: string | null }> } }).__kh.remotes());
const chatText = (p: Page) => p.evaluate(() => (window as unknown as { __kh: { chat: () => string[] } }).__kh.chat().join('|'));
const waitTown = (p: Page) => p.waitForFunction(() => document.body.dataset.state === 'town', null, { timeout: 30_000 });

function trackErrors(page: Page, label: string, errors: string[]) {
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`);
  });
}

async function newPlayer(browser: Browser, mobile: boolean, label: string, errors: string[]) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1920, height: 1080 } },
  );
  const page = await ctx.newPage();
  trackErrors(page, label, errors);
  return { ctx, page };
}

async function register(page: Page, name: string, shotPrefix: string) {
  await page.goto('/');
  await page.waitForSelector('#auth');
  await page.screenshot({ path: `${SHOTS}/${shotPrefix}-1-auth.png` });
  await page.fill('input[name=username]', name);
  await page.fill('input[name=password]', 'secret123');
  await page.fill('input[name=confirm]', 'secret123');
  await page.click('#auth button[type=submit]');
  await page.waitForSelector('#creator', { timeout: 30_000 });
  await page.click('[data-action=randomize]');
  await page.click('[data-tab=hair]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${shotPrefix}-2-creator.png` });
  await page.click('[data-action=save]');
  await waitTown(page);
}

test('two players can meet, chat, emote and keep their progress', async ({ browser }) => {
  const errors: string[] = [];
  const tag = Date.now().toString(36).slice(-6);
  const nameA = `alpha_${tag}`;
  const nameB = `bravo_${tag}`;

  const A = await newPlayer(browser, false, 'desktop', errors);
  const B = await newPlayer(browser, true, 'phone', errors);
  await register(A.page, nameA, 'desktop');
  await register(B.page, nameB, 'phone');

  // They see each other.
  await expect.poll(async () => (await remotes(A.page)).length, { timeout: 15_000 }).toBe(1);
  await expect.poll(async () => (await remotes(B.page)).length, { timeout: 15_000 }).toBe(1);
  expect((await remotes(A.page))[0].name).toBe(nameB);

  // A walks right; B sees it.
  const start = (await self(A.page))!;
  await A.page.keyboard.down('d');
  await A.page.waitForTimeout(1000);
  await A.page.keyboard.up('d');
  await A.page.waitForTimeout(400);
  const moved = (await self(A.page))!;
  expect(moved.x).toBeGreaterThan(start.x + 60);
  await expect.poll(async () => (await remotes(B.page))[0]?.x ?? 0, { timeout: 10_000 }).toBeGreaterThan(start.x + 50);

  // B walks with the virtual joystick (touch).
  const joy = B.page.getByTestId('joystick');
  const box = (await joy.boundingBox())!;
  const bStart = (await self(B.page))!;
  await joy.dispatchEvent('pointerdown', { pointerId: 7, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, isPrimary: true });
  await joy.dispatchEvent('pointermove', { pointerId: 7, clientX: box.x + box.width / 2, clientY: box.y + box.height - 2, isPrimary: true });
  await B.page.waitForTimeout(1500);
  await joy.dispatchEvent('pointerup', { pointerId: 7, isPrimary: true });
  const bMoved = (await self(B.page))!;
  expect(Math.abs(bMoved.y - bStart.y) + Math.abs(bMoved.x - bStart.x)).toBeGreaterThan(15);

  // Chat + speech bubble.
  await A.page.keyboard.press('Enter');
  await A.page.fill('#chat-input', 'Jom makan nasi lemak!');
  await A.page.keyboard.press('Enter');
  await expect.poll(() => chatText(B.page), { timeout: 10_000 }).toContain('Jom makan nasi lemak!');

  // Emotes: spam a one-shot from the wheel on the phone, then start a continuous one (sit).
  await B.page.click('[data-action=emote]');
  for (let i = 0; i < 3; i++) await B.page.click('[data-emote=wave]');
  await B.page.click('[data-emote=sit]');
  await expect.poll(async () => (await remotes(A.page))[0]?.emote, { timeout: 10_000 }).toBe('sit');
  await B.page.click('[data-action=emote]'); // the wheel toggles closed
  // Desktop: Q opens the emote wheel, then number keys fire emotes (5 = flex), spammable.
  // (Without the wheel open, number keys use the hotbar.)
  await A.page.keyboard.press('q');
  await A.page.keyboard.press('5');
  await A.page.keyboard.press('5');
  await expect.poll(async () => (await remotes(B.page))[0]?.emote, { timeout: 10_000 }).toBe('flex');
  await A.page.keyboard.press('q');
  await A.page.waitForTimeout(600);
  await A.page.screenshot({ path: `${SHOTS}/desktop-3-town.png` });
  await B.page.screenshot({ path: `${SHOTS}/phone-3-town.png` });

  // Full map opens and closes.
  await A.page.click('[data-action=map]');
  await A.page.waitForSelector('[data-testid=fullmap]');
  await A.page.click('[data-action=zoom-in]');
  await A.page.click('[data-action=zoom-in]');
  await A.page.screenshot({ path: `${SHOTS}/desktop-4-fullmap.png` });
  await A.page.keyboard.press('Escape');

  // Reload restores position + appearance.
  const beforeReload = (await self(A.page))!;
  await A.page.reload();
  await waitTown(A.page);
  const afterReload = (await self(A.page))!;
  expect(Math.abs(afterReload.x - beforeReload.x)).toBeLessThan(2);
  expect(Math.abs(afterReload.y - beforeReload.y)).toBeLessThan(2);
  // B is still sitting, and A (who just re-joined) sees it.
  await expect.poll(async () => (await remotes(A.page))[0]?.emote, { timeout: 10_000 }).toBe('sit');

  // Log out and back in on the phone.
  const bBefore = (await self(B.page))!;
  await B.page.click('[data-action=settings]');
  await B.page.screenshot({ path: `${SHOTS}/phone-5-settings.png` });
  await B.page.click('[data-action=logout]');
  await B.page.waitForSelector('#auth', { timeout: 15_000 });
  await B.page.click('[data-tab=login]');
  await B.page.fill('input[name=username]', nameB);
  await B.page.fill('input[name=password]', 'secret123');
  await B.page.click('#auth button[type=submit]');
  await waitTown(B.page);
  const bAfter = (await self(B.page))!;
  expect(Math.abs(bAfter.x - bBefore.x)).toBeLessThan(2);
  expect(Math.abs(bAfter.y - bBefore.y)).toBeLessThan(2);

  // Logging in as A on another device kicks the first one.
  const A2 = await newPlayer(browser, false, 'desktop2', errors);
  await A2.page.goto('/');
  await A2.page.waitForSelector('#auth');
  await A2.page.click('[data-tab=login]');
  await A2.page.fill('input[name=username]', nameA);
  await A2.page.fill('input[name=password]', 'secret123');
  await A2.page.click('#auth button[type=submit]');
  await waitTown(A2.page);
  await expect(A.page.getByText('You logged in on another device.')).toBeVisible({ timeout: 10_000 });
  const a2 = (await self(A2.page))!;
  expect(Math.abs(a2.x - afterReload.x)).toBeLessThan(2);

  // The kicked page logs "unauthorized"-style socket errors? It shouldn't log any errors.
  expect(errors).toEqual([]);
  await A.ctx.close();
  await A2.ctx.close();
  await B.ctx.close();
});

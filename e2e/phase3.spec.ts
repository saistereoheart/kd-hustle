// Phase 3 acceptance: the HustlePhone (daily reward, quests, skills, titles, profile), XP and
// level-ups, wealth stages (with an announcement the other player sees), potions with buff
// timers that raise the odds shown on a crate, crate unlocks, and everything surviving a reload.
import { expect, test, type Browser, type Page } from '@playwright/test';

const SHOTS = 'test-results/screenshots';
type Remote = { name: string; level: number; title: string | null };
type Progress = { xp: number; level: number; stage: number; title: string | null; titles: string[]; stats: Record<string, number>; buffs: Array<{ item: string }>; quests: unknown[]; path: number };
type KH = {
  wallet: () => { sen: number; shards: number; items: number };
  progress: () => Progress;
  luck: () => number;
  open: (id: string) => void;
  remotes: () => Remote[];
  chat: () => string[];
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
const progress = (p: Page) => kh(p, (k) => k.progress());
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

async function chatCommand(p: Page, text: string) {
  await p.keyboard.press('Enter');
  await p.fill('#chat-input', text);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
}

test('phase 3: progression, HustlePhone, potions and stages', async ({ browser }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const tag = Date.now().toString(36).slice(-5);
  const A = await player(browser, `boss_${tag}`, false, errors);
  const B = await player(browser, `kaki_${tag}`, true, errors);

  // A brand-new player: Level 1, Budak Baru, and a first goal on the HUD.
  await expect(A.page.getByTestId('hud-level')).toHaveText('Lv 1');
  await expect(A.page.getByTestId('hud-stage')).toContainText('Budak Baru');
  await expect(A.page.getByTestId('goal-tracker')).toContainText('Take your first job');
  await expect(A.page.getByTestId('daily-chip')).toBeVisible();
  const p0 = await progress(A.page);
  expect(p0.quests).toHaveLength(3);
  await A.page.screenshot({ path: `${SHOTS}/p3-1-hud.png` });
  await B.page.screenshot({ path: `${SHOTS}/p3-1b-hud-phone.png` });

  // --- HustlePhone → Daily: claim day 1 ---
  await A.page.keyboard.press('Tab');
  await A.page.waitForSelector('[data-testid=phone-panel] .phone-grid');
  await A.page.screenshot({ path: `${SHOTS}/p3-2-phone-home.png` });
  await A.page.click('[data-app=daily]');
  const w0 = (await wallet(A.page)).sen;
  await A.page.click('[data-action=daily-claim]');
  await expect.poll(async () => (await wallet(A.page)).sen).toBe(w0 + 10000);
  await expect(A.page.locator('[data-action=daily-claim]')).toBeDisabled();
  await A.page.screenshot({ path: `${SHOTS}/p3-3-daily.png` });
  await A.page.click('[data-action=phone-back]');
  await A.page.click('[data-app=quests]');
  await expect(A.page.locator('.quest-card')).toHaveCount(3);
  await A.page.screenshot({ path: `${SHOTS}/p3-4-quests.png` });
  await A.page.keyboard.press('Escape');

  // --- Lucky Bag is locked until you're a Hustler ---
  await goTo(A.page, 'luckybag_stall');
  await kh(A.page, (k) => k.open('luckybag_stall'));
  await A.page.waitForSelector('[data-testid=crate-panel]');
  await expect(A.page.getByTestId('crate-lock')).toContainText('Hustler');
  await expect(A.page.locator('[data-roll="1"]')).toBeDisabled();
  await A.page.keyboard.press('Escape');

  // --- Reaching RM 2,000 net worth: stage 2, a splash, and everyone hears about it ---
  await chatCommand(A.page, '/give me money 2500');
  await expect.poll(async () => (await progress(A.page)).stage).toBe(2);
  await expect(A.page.getByTestId('stage-up')).toBeVisible();
  await A.page.screenshot({ path: `${SHOTS}/p3-5-stage-up.png` });
  await expect(A.page.getByTestId('hud-stage')).toContainText('Hustler');
  await expect.poll(async () => (await kh(B.page, (k) => k.chat())).join('\n'), { timeout: 10_000 }).toContain('HUSTLER');
  await B.page.screenshot({ path: `${SHOTS}/p3-5b-stage-announce-phone.png` });

  // --- XP → level-ups; the other player sees the new level on the nameplate ---
  await chatCommand(A.page, '/give me xp 2000');
  await expect.poll(async () => (await progress(A.page)).level).toBe(5);
  await expect(A.page.getByTestId('level-up')).toBeVisible();
  await expect(A.page.getByTestId('hud-level')).toHaveText('Lv 5');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0]?.level, { timeout: 10_000 }).toBe(5);
  // Level 5 milestone: a Luck Potion.
  await expect.poll(async () => (await kh(A.page, (k) => k.wallet())).items).toBeGreaterThanOrEqual(1);
  await A.page.screenshot({ path: `${SHOTS}/p3-6-level-up.png` });

  // --- Skills: buy Hustle Harder ---
  await A.page.waitForTimeout(2500); // let the splashes fade
  await A.page.keyboard.press('p');
  await A.page.click('[data-app=skills]');
  const w1 = (await wallet(A.page)).sen;
  await A.page.click('[data-action=upgrade-hustle_harder]');
  await expect(A.page.locator('[data-skill=hustle_harder] .lv-badge')).toHaveText(/^Lv 1\//);
  expect((await wallet(A.page)).sen).toBeLessThan(w1);
  await A.page.click('[data-branch=luck]');
  await A.page.screenshot({ path: `${SHOTS}/p3-7-skills.png` });

  // --- Titles: wear one; the other player sees it over your head ---
  await A.page.click('[data-action=phone-back]');
  await A.page.click('[data-app=titles]');
  await A.page.click('[data-action=title-hustler]');
  await expect.poll(async () => (await kh(B.page, (k) => k.remotes()))[0]?.title, { timeout: 10_000 }).toBe('Hustler');
  await A.page.screenshot({ path: `${SHOTS}/p3-8-titles.png` });

  // --- Profile: stage ladder, luck, stats ---
  await A.page.click('[data-action=phone-back]');
  await A.page.click('[data-app=profile]');
  await expect(A.page.locator('.stage-row.reached')).toHaveCount(2);
  await A.page.screenshot({ path: `${SHOTS}/p3-9-profile.png` });
  await A.page.keyboard.press('Escape');

  // --- Potions: drink the Luck Potion; luck doubles and the crate odds show it ---
  expect(await kh(A.page, (k) => k.luck())).toBeCloseTo(1);
  await A.page.keyboard.press('b');
  await A.page.click('.item-card[data-item=luck_potion]');
  await A.page.click('[data-action=use]');
  await expect.poll(async () => kh(A.page, (k) => k.luck())).toBeCloseTo(2);
  await A.page.keyboard.press('Escape');
  await expect(A.page.locator('.hud-chip.buff-luck')).toBeVisible();
  await goTo(A.page, 'luckybag_stall');
  await kh(A.page, (k) => k.open('luckybag_stall'));
  await A.page.waitForSelector('[data-testid=crate-panel]');
  await expect(A.page.getByTestId('crate-lock')).toHaveCount(0);
  await expect(A.page.locator('.crate-panel-frame .panel-side')).toContainText('Luck ×2.00'); // the odds & pity side box
  await A.page.screenshot({ path: `${SHOTS}/p3-10-crate-with-luck.png` });
  // Roll it: the roll counts towards stats (and the "Roll any crate" style quests).
  await A.page.click('[data-roll="1"]');
  // Skip the reel if it's still spinning (a fast or rare roll may already have stopped).
  await A.page.locator('[data-action=skip]').click({ timeout: 3000 }).catch(() => {});
  await A.page.click('[data-action=reveal-ok]');
  await expect.poll(async () => (await progress(A.page)).stats.rolls_luckybag).toBe(1);
  await A.page.keyboard.press('Escape');

  // --- The phone on a phone: full screen, apps reachable ---
  await B.page.click('[data-action=phone]');
  await B.page.waitForSelector('[data-testid=phone-panel] .phone-grid');
  await B.page.screenshot({ path: `${SHOTS}/p3-11-phone-on-phone.png` });
  await B.page.click('[data-app=path]');
  await expect(B.page.locator('.path-goal.current')).toHaveCount(1);
  await B.page.screenshot({ path: `${SHOTS}/p3-12-path-on-phone.png` });
  await B.page.click('[data-action=phone-back]');
  await B.page.click('[data-app=skills]');
  await B.page.screenshot({ path: `${SHOTS}/p3-13-skills-on-phone.png` });
  await B.page.click('.panel-close');

  // --- Everything survives a reload (it lives on the server) ---
  const before = await progress(A.page);
  await A.page.reload();
  await A.page.click('[data-testid=title-start]');
  await A.page.waitForFunction(() => document.body.dataset.state === 'town');
  const after = await progress(A.page);
  expect({ level: after.level, stage: after.stage, title: after.title, xp: after.xp }).toEqual({ level: before.level, stage: before.stage, title: before.title, xp: before.xp });
  expect(after.buffs.map((b) => b.item)).toContain('luck_potion');
  expect(after.stats.dailyClaims).toBe(1);
  await expect(A.page.getByTestId('hud-level')).toHaveText(`Lv ${before.level}`);

  expect(errors).toEqual([]);
  await A.ctx.close();
  await B.ctx.close();
});

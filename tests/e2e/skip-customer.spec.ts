import { expect, test, type Page } from '@playwright/test';
import { clickLogical } from './helpers';

interface SaveSnapshot {
  version: 1;
  day: number;
  money: number;
  reputation: number;
  deck: string[];
  shopLevel: number;
  redeemTickets: number;
}

interface PawnshopDebugState {
  phase: 'title' | 'redemption' | 'negotiating' | 'feedback' | 'summary';
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  log: string[];
  day?: number;
  shopLevel?: number;
  redeemTickets?: number;
  maxRenqing?: number;
  itemsOrder?: string[];
  hasSave?: boolean;
  tierAffordability?: { low: boolean; fair: boolean; high: boolean };
  canSkip?: boolean;
}

interface BattleDebugState {
  phase: 'draw' | 'play' | 'demonAct' | 'roundEnd' | 'result' | 'empty_deck' | 'result_scene';
  demonId: string;
  demonName: string;
  hand: string[];
  isAnimating?: boolean;
}

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';

const BUTTONS = {
  titleStart: { x: 160, y: 122 },
  titleContinue: { x: 160, y: 156 },
  redeemReject: { x: 224, y: 151 },
  tierLow: { x: 58, y: 151 },
  tierFair: { x: 160, y: 151 },
  tierHigh: { x: 262, y: 151 },
  skipCustomer: { x: 270, y: 107 },
  nextOrSummary: { x: 160, y: 151 },
  enterNightBattle: { x: 88, y: 151 },
} as const;

async function getPawnshopState(page: Page): Promise<PawnshopDebugState> {
  return page.evaluate(() => {
    const hook = (
      window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => PawnshopDebugState } }
    ).__PAWNSHOP_DEBUG__;
    if (!hook) {
      throw new Error('window.__PAWNSHOP_DEBUG__ is not initialized');
    }
    return hook.getState();
  });
}

async function waitForPawnshopPhase(
  page: Page,
  expected: PawnshopDebugState['phase'],
): Promise<PawnshopDebugState> {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const hook = (
          window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => PawnshopDebugState } }
        ).__PAWNSHOP_DEBUG__;
        return hook?.getState().phase ?? null;
      }),
    )
    .toBe(expected);
  return getPawnshopState(page);
}

function trackErrors(page: Page): { pageErrors: string[]; failedRequests: string[] } {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(
      `requestfailed ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
    );
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });

  return { pageErrors, failedRequests };
}

test('seed=4 Day 1 deadlock: when all 3 tiers are unaffordable on Ring, skip button unblocks flow with money/rep/deck unchanged', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=4');
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_STORAGE_KEY);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleStart);

  // Day 1 with seed=4: watch (60 high) -> bicycle (120 high) -> ring (30/60/90)
  const c1 = await waitForPawnshopPhase(page, 'negotiating');
  expect(c1.day).toBe(1);
  expect(c1.money).toBe(200);
  expect(c1.itemsOrder).toEqual(['watch', 'bicycle', 'ring']);
  expect(c1.canSkip).toBe(true);

  // Customer 1 (Watch) high tier: 200 -> 140, rep +1, deck ['倒转']
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  const afterC1 = await waitForPawnshopPhase(page, 'feedback');
  expect(afterC1.money).toBe(140);
  expect(afterC1.canSkip).toBe(false);
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);

  // Customer 2 (Bicycle) high tier: 140 -> 20, rep +2, deck ['倒转', '飞驰']
  const c2 = await waitForPawnshopPhase(page, 'negotiating');
  expect(c2.customerIndex).toBe(1);
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  const afterC2 = await waitForPawnshopPhase(page, 'feedback');
  expect(afterC2.money).toBe(20);
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);

  // Customer 3 (Ring): quotes 30 / 60 / 90 are ALL > 20 money -> previous deadlock!
  const c3 = await waitForPawnshopPhase(page, 'negotiating');
  expect(c3.customerIndex).toBe(2);
  expect(c3.money).toBe(20);
  // Watch (urgent, high -> +1) + Bicycle (proud, high -> +2) = 3
  expect(c3.reputation).toBe(3);
  expect(c3.deck).toEqual(['倒转', '飞驰']);
  expect(c3.tierAffordability).toEqual({ low: false, fair: false, high: false });
  expect(c3.canSkip).toBe(true);

  await page.screenshot({ path: 'test-results/skip-customer-seed4-day1-deadlock.png' });

  // Clicking all three disabled tier buttons must remain a no-op
  await clickLogical(page, canvas, BUTTONS.tierLow);
  await clickLogical(page, canvas, BUTTONS.tierFair);
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  await page.waitForTimeout(250);
  const stillStuckWithoutSkip = await getPawnshopState(page);
  expect(stillStuckWithoutSkip.phase).toBe('negotiating');
  expect(stillStuckWithoutSkip.customerIndex).toBe(2);
  expect(stillStuckWithoutSkip.money).toBe(20);
  expect(stillStuckWithoutSkip.reputation).toBe(3);
  expect(stillStuckWithoutSkip.deck).toEqual(['倒转', '飞驰']);

  // Click Skip button -> advances to summary with money/reputation/deck completely unchanged
  await clickLogical(page, canvas, BUTTONS.skipCustomer);
  const summary = await waitForPawnshopPhase(page, 'summary');
  expect(summary.customerIndex).toBe(3);
  expect(summary.money).toBe(20);
  expect(summary.reputation).toBe(3);
  expect(summary.deck).toEqual(['倒转', '飞驰']);
  expect(summary.canSkip).toBe(false);
  expect(summary.log).toHaveLength(3);
  expect(summary.log[2]).toBe('婚戒:跳过');

  // Flow continues into Night 1 CardBattleScene cleanly
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const hook = (
          window as unknown as { __BATTLE_DEBUG__?: { getState: () => BattleDebugState } }
        ).__BATTLE_DEBUG__;
        const s = hook?.getState();
        return Boolean(s && !s.isAnimating && s.phase === 'play');
      }),
    )
    .toBe(true);

  const night1 = await page.evaluate(() => {
    const hook = (
      window as unknown as { __BATTLE_DEBUG__?: { getState: () => BattleDebugState } }
    ).__BATTLE_DEBUG__;
    return hook!.getState();
  });
  expect(night1.demonId).toBe('a');
  expect([...night1.hand].sort()).toEqual(['倒转', '飞驰'].sort());

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('seed=4 Day 4 mid-day skip: skipping unaffordable Bicycle (low 40 > 35 money) advances to Customer 3 without altering money/rep/deck', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=4');
  // Pre-seed Day 4 save with 35 money (exact post-Day-3-high-route balance from §11.3)
  await page.evaluate((key) => {
    const day4LowMoneySave: SaveSnapshot = {
      version: 1,
      day: 4,
      money: 35,
      reputation: 4,
      deck: ['倒转', '守诺', '旧书', '余音', '守诺'],
      shopLevel: 2,
      redeemTickets: 1,
    };
    localStorage.setItem(key, JSON.stringify(day4LowMoneySave));
  }, SAVE_STORAGE_KEY);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);

  // Day 4 save has 1 redeemTicket -> reject pre-day redemption to keep 35 money & deck unchanged
  await waitForPawnshopPhase(page, 'redemption');
  await clickLogical(page, canvas, BUTTONS.redeemReject);

  // Day 4 with seed=4: watch (20/40/60) -> bicycle (40/80/120) -> erhu (25/50/75)
  const c1 = await waitForPawnshopPhase(page, 'negotiating');
  expect(c1.day).toBe(4);
  expect(c1.customerIndex).toBe(0);
  expect(c1.money).toBe(35);
  expect(c1.itemsOrder).toEqual(['watch', 'bicycle', 'erhu']);
  expect(c1.tierAffordability).toEqual({ low: true, fair: false, high: false });
  expect(c1.canSkip).toBe(true);

  // Skip Customer 1 (Watch) even though low tier is affordable -> advances to Customer 2 (Bicycle)
  await clickLogical(page, canvas, BUTTONS.skipCustomer);
  await expect
    .poll(async () => (await getPawnshopState(page)).customerIndex)
    .toBe(1);
  const c2 = await getPawnshopState(page);
  expect(c2.phase).toBe('negotiating');
  expect(c2.money).toBe(35);
  expect(c2.reputation).toBe(4);
  expect(c2.deck).toEqual(['倒转', '守诺', '旧书', '余音', '守诺']);
  // Bicycle low 40 > 35 -> all 3 tiers unaffordable!
  expect(c2.tierAffordability).toEqual({ low: false, fair: false, high: false });
  expect(c2.canSkip).toBe(true);

  // Skip Customer 2 (Bicycle) -> advances to Customer 3 (Erhu)
  await clickLogical(page, canvas, BUTTONS.skipCustomer);
  await expect
    .poll(async () => (await getPawnshopState(page)).customerIndex)
    .toBe(2);
  const c3 = await getPawnshopState(page);
  expect(c3.phase).toBe('negotiating');
  expect(c3.money).toBe(35);
  expect(c3.reputation).toBe(4);
  expect(c3.deck).toEqual(['倒转', '守诺', '旧书', '余音', '守诺']);
  expect(c3.tierAffordability).toEqual({ low: true, fair: false, high: false });
  expect(c3.canSkip).toBe(true);

  // Skip Customer 3 (Erhu) -> summary
  await clickLogical(page, canvas, BUTTONS.skipCustomer);
  const summary = await waitForPawnshopPhase(page, 'summary');
  expect(summary.customerIndex).toBe(3);
  expect(summary.money).toBe(35);
  expect(summary.reputation).toBe(4);
  expect(summary.deck).toEqual(['倒转', '守诺', '旧书', '余音', '守诺']);
  expect(summary.log.slice(-3)).toEqual(['旧手表:跳过', '永久自行车:跳过', '二胡:跳过']);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

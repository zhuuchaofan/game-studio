import { expect, test, type Page } from '@playwright/test';
import {
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  TITLE_CONTINUE_BUTTON,
} from '../../src/game/layout';
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
  lastToast?: string | null;
}

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';

const BUTTONS = {
  titleContinue: TITLE_CONTINUE_BUTTON,
  tierLow: PAWNSHOP_TIER_BUTTONS.low,
  tierFair: PAWNSHOP_TIER_BUTTONS.fair,
  tierHigh: PAWNSHOP_TIER_BUTTONS.high,
  nextOrSummary: PAWNSHOP_FEEDBACK_NEXT_BUTTON,
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

test('unaffordable tiers are disabled: clicking them is a no-op and never consumes RNG or money', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=75&deck=test');

  // Seed a Day 1 save with only 25 money, then reload and Continue into it.
  await page.evaluate((key) => {
    const lowMoneySave: SaveSnapshot = {
      version: 1,
      day: 1,
      money: 25,
      reputation: 0,
      deck: [],
      shopLevel: 1,
      redeemTickets: 0,
    };
    localStorage.setItem(key, JSON.stringify(lowMoneySave));
  }, SAVE_STORAGE_KEY);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const titleState = await waitForPawnshopPhase(page, 'title');
  expect(titleState.hasSave).toBe(true);
  expect(titleState.day).toBe(1);

  await clickLogical(page, canvas, BUTTONS.titleContinue);
  const start = await waitForPawnshopPhase(page, 'negotiating');
  expect(start.money).toBe(25);
  expect(start.customerIndex).toBe(0);
  expect(start.itemsOrder).toEqual(['erhu', 'ledger', 'old_book']);

  // Customer 1: Erhu (trueValue 50) -> low 25 / fair 50 / high 75.
  // 25 money buys exactly the low tier (price == money) and nothing else.
  expect(start.tierAffordability).toEqual({ low: true, fair: false, high: false });

  // Click the disabled High tier: nothing happens (still negotiating, money/log unchanged).
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  await page.waitForTimeout(300);
  let state = await getPawnshopState(page);
  expect(state.phase).toBe('negotiating');
  expect(state.customerIndex).toBe(0);
  expect(state.money).toBe(25);
  expect(state.money).toBeGreaterThanOrEqual(0);
  expect(state.deck).toEqual([]);
  expect(state.log).toEqual([]);

  // Click the disabled Fair tier: same no-op.
  await clickLogical(page, canvas, BUTTONS.tierFair);
  await page.waitForTimeout(300);
  state = await getPawnshopState(page);
  expect(state.phase).toBe('negotiating');
  expect(state.customerIndex).toBe(0);
  expect(state.money).toBe(25);
  expect(state.deck).toEqual([]);
  expect(state.log).toEqual([]);

  // Click the affordable Low tier: normal offer flow.
  // The two disabled clicks must NOT have consumed RNG: the Low offer is the
  // first roll of seed=75 (~0.2425 < 0.3) -> ACCEPT, money 25 - 25 = 0.
  await clickLogical(page, canvas, BUTTONS.tierLow);
  const afterLow = await waitForPawnshopPhase(page, 'feedback');
  expect(afterLow.money).toBe(0);
  expect(afterLow.money).toBeGreaterThanOrEqual(0);
  expect(afterLow.reputation).toBe(-1);
  expect(afterLow.deck).toEqual(['余音']);

  // Advance to Customer 2 (Ledger, low 25) with 0 money: every tier is unaffordable.
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  const customer2 = await waitForPawnshopPhase(page, 'negotiating');
  expect(customer2.customerIndex).toBe(1);
  expect(customer2.money).toBe(0);
  expect(customer2.tierAffordability).toEqual({ low: false, fair: false, high: false });

  // Clicking the disabled Low tier here is also a no-op (no crash, no negative money).
  await clickLogical(page, canvas, BUTTONS.tierLow);
  await page.waitForTimeout(300);
  state = await getPawnshopState(page);
  expect(state.phase).toBe('negotiating');
  expect(state.customerIndex).toBe(1);
  expect(state.money).toBe(0);
  expect(state.deck).toEqual(['余音']);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('A3: money 50 with high price 60 disables high tier, shows "钱不够" toast on click, with no deal/deduction/state change', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=24');

  // Seed Day 1 save with 50 money; seed=24 Day 1 customer 1 is watch (trueValue 40 -> low 20 / fair 40 / high 60)
  await page.evaluate((key) => {
    const save50: SaveSnapshot = {
      version: 1,
      day: 1,
      money: 50,
      reputation: 0,
      deck: [],
      shopLevel: 1,
      redeemTickets: 0,
    };
    localStorage.setItem(key, JSON.stringify(save50));
  }, SAVE_STORAGE_KEY);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);

  const start = await waitForPawnshopPhase(page, 'negotiating');
  expect(start.money).toBe(50);
  expect(start.customerIndex).toBe(0);
  expect(start.itemsOrder?.[0]).toBe('watch');
  // Watch trueValue 40 -> low 20 (true), fair 40 (true), high 60 (false, > 50)
  expect(start.tierAffordability).toEqual({ low: true, fair: true, high: false });
  expect(start.lastToast).toBeNull();

  // Click disabled High tier (60 > 50) -> shows "钱不够" toast, no deal, no deduction, no state change
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  await expect
    .poll(async () => (await getPawnshopState(page)).lastToast)
    .toBe('钱不够');

  const afterClick = await getPawnshopState(page);
  expect(afterClick.phase).toBe('negotiating');
  expect(afterClick.customerIndex).toBe(0);
  expect(afterClick.money).toBe(50);
  expect(afterClick.reputation).toBe(0);
  expect(afterClick.deck).toEqual([]);
  expect(afterClick.log).toEqual([]);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

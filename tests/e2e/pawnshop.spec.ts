import { expect, test, type Page } from '@playwright/test';
import {
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SUMMARY_RETURN_TITLE_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  TITLE_START_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

interface DebugState {
  phase: 'title' | 'negotiating' | 'feedback' | 'summary';
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  log: string[];
}

// Logical button centers matching TitleScene & PawnshopScene layout
const BUTTONS = {
  titleStart: TITLE_START_BUTTON,
  tierLow: PAWNSHOP_TIER_BUTTONS.low,
  tierFair: PAWNSHOP_TIER_BUTTONS.fair,
  tierHigh: PAWNSHOP_TIER_BUTTONS.high,
  nextOrSummary: PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  returnTitle: PAWNSHOP_SUMMARY_RETURN_TITLE_BUTTON,
} as const;

async function getDebugState(page: Page): Promise<DebugState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => DebugState } })
      .__PAWNSHOP_DEBUG__;
    if (!hook) {
      throw new Error('window.__PAWNSHOP_DEBUG__ is not initialized');
    }
    return hook.getState();
  });
}

async function waitForPhase(page: Page, expectedPhase: DebugState['phase']): Promise<DebugState> {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const hook = (window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => DebugState } })
          .__PAWNSHOP_DEBUG__;
        return hook?.getState().phase ?? null;
      });
    })
    .toBe(expectedPhase);
  return getDebugState(page);
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

test('accepts all three tiers (low/fair/high) with fixed seed=7 and verifies GDD math + desktop screenshots', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7');
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const titleState = await waitForPhase(page, 'title');
  expect(titleState.money).toBe(240);
  expect(titleState.reputation).toBe(0);
  expect(titleState.deck).toEqual([]);

  await page.screenshot({ path: 'test-results/pawnshop-desktop-title.png' });

  // Enter PawnshopScene
  await clickLogical(page, canvas, BUTTONS.titleStart);
  const startState = await waitForPhase(page, 'negotiating');
  expect(startState.customerIndex).toBe(0);

  await page.screenshot({ path: 'test-results/pawnshop-desktop-day.png' });

  // Day 1 with seed=7 shuffles 12-item pool deterministically and takes top 3: stamp_album (30) -> tin_trunk (60) -> erhu (50)
  // Customer 1: Stamp album (trueValue 30, proud) -> low (50% = 15), seed=7 roll 1 (~0.0117 < 0.2) => ACCEPT
  await clickLogical(page, canvas, BUTTONS.tierLow);
  const afterFirst = await waitForPhase(page, 'feedback');
  expect(afterFirst.money).toBe(225);
  expect(afterFirst.reputation).toBe(-1);
  expect(afterFirst.deck).toEqual(['集邮']);

  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  const customer2 = await waitForPhase(page, 'negotiating');
  expect(customer2.customerIndex).toBe(1);

  // Customer 2: Tin trunk (trueValue 60, urgent) -> fair (100% = 60), seed=7 roll 2 (~0.062 < 0.8) => ACCEPT
  await clickLogical(page, canvas, BUTTONS.tierFair);
  const afterSecond = await waitForPhase(page, 'feedback');
  expect(afterSecond.money).toBe(165);
  expect(afterSecond.reputation).toBe(-1);
  expect(afterSecond.deck).toEqual(['集邮', '顶住']);

  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  const customer3 = await waitForPhase(page, 'negotiating');
  expect(customer3.customerIndex).toBe(2);

  // Customer 3: Erhu (trueValue 50, sentimental) -> high (150% = 75), acceptRate 1.0 => ACCEPT
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  const afterThird = await waitForPhase(page, 'feedback');
  expect(afterThird.money).toBe(90);
  expect(afterThird.reputation).toBe(0);
  expect(afterThird.deck).toEqual(['集邮', '顶住', '余音']);

  // Advance to Day End Summary
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  const summaryState = await waitForPhase(page, 'summary');
  expect(summaryState.customerIndex).toBe(3);
  expect(summaryState.money).toBe(90);
  expect(summaryState.reputation).toBe(0);
  expect(summaryState.deck).toEqual(['集邮', '顶住', '余音']);
  expect(summaryState.log).toHaveLength(3);

  await page.screenshot({ path: 'test-results/pawnshop-desktop-summary.png' });

  // Return to TitleScene
  await clickLogical(page, canvas, BUTTONS.returnTitle);
  const backTitle = await waitForPhase(page, 'title');
  expect(backTitle.phase).toBe('title');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('rejects offers with fixed seed=10 without changing money, reputation, or deck', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=10');
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  await waitForPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleStart);
  await waitForPhase(page, 'negotiating');

  // Customer 1: Watch -> low, seed=10 roll 1 (~0.502 >= 0.3) => REJECT
  await clickLogical(page, canvas, BUTTONS.tierLow);
  const afterWatch = await waitForPhase(page, 'feedback');
  expect(afterWatch.money).toBe(240);
  expect(afterWatch.reputation).toBe(0);
  expect(afterWatch.deck).toEqual([]);

  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  await waitForPhase(page, 'negotiating');

  // Customer 2: Ring -> fair, seed=10 roll 2 (~0.917 >= 0.8) => REJECT
  await clickLogical(page, canvas, BUTTONS.tierFair);
  const afterRing = await waitForPhase(page, 'feedback');
  expect(afterRing.money).toBe(240);
  expect(afterRing.reputation).toBe(0);
  expect(afterRing.deck).toEqual([]);

  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  await waitForPhase(page, 'negotiating');

  // Customer 3: Old book -> low, seed=10 roll 3 (~0.691 >= 0.3) => REJECT
  await clickLogical(page, canvas, BUTTONS.tierLow);
  const afterBook = await waitForPhase(page, 'feedback');
  expect(afterBook.money).toBe(240);
  expect(afterBook.reputation).toBe(0);
  expect(afterBook.deck).toEqual([]);

  // Advance to Summary
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  const summaryState = await waitForPhase(page, 'summary');
  expect(summaryState.money).toBe(240);
  expect(summaryState.reputation).toBe(0);
  expect(summaryState.deck).toEqual([]);
  expect(summaryState.log).toHaveLength(3);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('renders title and pawnshop cleanly on mobile landscape 844x390 viewport', async ({ page }) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?seed=7');

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  await waitForPhase(page, 'title');
  await page.screenshot({ path: 'test-results/pawnshop-mobile-title.png' });

  await clickLogical(page, canvas, BUTTONS.titleStart);
  const dayState = await waitForPhase(page, 'negotiating');
  expect(dayState.customerIndex).toBe(0);

  await page.screenshot({ path: 'test-results/pawnshop-mobile-day.png' });

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

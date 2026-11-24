import { expect, test, type Locator, type Page } from '@playwright/test';

interface DebugState {
  phase: 'title' | 'negotiating' | 'feedback' | 'summary';
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  log: string[];
}

const LOGICAL_WIDTH = 320;
const LOGICAL_HEIGHT = 180;

// Logical button centers matching TitleScene & PawnshopScene layout
const BUTTONS = {
  titleStart: { x: 160, y: 128 },
  tierLow: { x: 58, y: 151 },
  tierFair: { x: 160, y: 151 },
  tierHigh: { x: 262, y: 151 },
  nextOrSummary: { x: 160, y: 151 },
  returnTitle: { x: 160, y: 151 },
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

async function clickLogical(
  page: Page,
  canvas: Locator,
  point: { x: number; y: number },
): Promise<void> {
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const clientX = box!.x + (point.x / LOGICAL_WIDTH) * box!.width;
  const clientY = box!.y + (point.y / LOGICAL_HEIGHT) * box!.height;
  await page.mouse.click(clientX, clientY);
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
  expect(titleState.money).toBe(200);
  expect(titleState.reputation).toBe(0);
  expect(titleState.deck).toEqual([]);

  await page.screenshot({ path: 'test-results/pawnshop-desktop-title.png' });

  // Enter PawnshopScene
  await clickLogical(page, canvas, BUTTONS.titleStart);
  const startState = await waitForPhase(page, 'negotiating');
  expect(startState.customerIndex).toBe(0);

  await page.screenshot({ path: 'test-results/pawnshop-desktop-day.png' });

  // Customer 1: Watch (trueValue 40) -> low (50% = 20), seed=7 roll 1 (~0.0117 < 0.3) => ACCEPT
  await clickLogical(page, canvas, BUTTONS.tierLow);
  const afterWatch = await waitForPhase(page, 'feedback');
  expect(afterWatch.money).toBe(180);
  expect(afterWatch.reputation).toBe(-1);
  expect(afterWatch.deck).toEqual(['倒转']);

  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  const customer2 = await waitForPhase(page, 'negotiating');
  expect(customer2.customerIndex).toBe(1);

  // Customer 2: Ring (trueValue 60) -> fair (100% = 60), seed=7 roll 2 (~0.062 < 0.8) => ACCEPT
  await clickLogical(page, canvas, BUTTONS.tierFair);
  const afterRing = await waitForPhase(page, 'feedback');
  expect(afterRing.money).toBe(120);
  expect(afterRing.reputation).toBe(-1);
  expect(afterRing.deck).toEqual(['倒转', '守诺']);

  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  const customer3 = await waitForPhase(page, 'negotiating');
  expect(customer3.customerIndex).toBe(2);

  // Customer 3: Old book (trueValue 20) -> high (150% = 30), acceptRate 1.0 => ACCEPT
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  const afterBook = await waitForPhase(page, 'feedback');
  expect(afterBook.money).toBe(90);
  expect(afterBook.reputation).toBe(0);
  expect(afterBook.deck).toEqual(['倒转', '守诺', '旧书']);

  // Advance to Day End Summary
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  const summaryState = await waitForPhase(page, 'summary');
  expect(summaryState.customerIndex).toBe(3);
  expect(summaryState.money).toBe(90);
  expect(summaryState.reputation).toBe(0);
  expect(summaryState.deck).toEqual(['倒转', '守诺', '旧书']);
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
  expect(afterWatch.money).toBe(200);
  expect(afterWatch.reputation).toBe(0);
  expect(afterWatch.deck).toEqual([]);

  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  await waitForPhase(page, 'negotiating');

  // Customer 2: Ring -> fair, seed=10 roll 2 (~0.917 >= 0.8) => REJECT
  await clickLogical(page, canvas, BUTTONS.tierFair);
  const afterRing = await waitForPhase(page, 'feedback');
  expect(afterRing.money).toBe(200);
  expect(afterRing.reputation).toBe(0);
  expect(afterRing.deck).toEqual([]);

  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  await waitForPhase(page, 'negotiating');

  // Customer 3: Old book -> low, seed=10 roll 3 (~0.691 >= 0.3) => REJECT
  await clickLogical(page, canvas, BUTTONS.tierLow);
  const afterBook = await waitForPhase(page, 'feedback');
  expect(afterBook.money).toBe(200);
  expect(afterBook.reputation).toBe(0);
  expect(afterBook.deck).toEqual([]);

  // Advance to Summary
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  const summaryState = await waitForPhase(page, 'summary');
  expect(summaryState.money).toBe(200);
  expect(summaryState.reputation).toBe(0);
  expect(summaryState.deck).toEqual([]);
  expect(summaryState.log).toHaveLength(3);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('renders title and pawnshop cleanly on mobile portrait 390x844 viewport', async ({ page }) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.setViewportSize({ width: 390, height: 844 });
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

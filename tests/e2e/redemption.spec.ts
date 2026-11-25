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
  redeemTickets?: number;
  redemptionOffer?: {
    itemId: string;
    itemName: string;
    cardName: string;
    basePrice: number;
    payout: number;
  } | null;
}

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const PAWN_PRICES_STORAGE_KEY = 'pawnshop-cards-pawn-prices-v1';

const BUTTONS = {
  titleContinue: { x: 160, y: 156 },
  redeemAccept: { x: 96, y: 151 },
  redeemReject: { x: 224, y: 151 },
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

test('C4 redemption accept: removes card from deck, adds dealPrice * 1.2 money, reputation +1, redeemTickets -1', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7');
  await page.evaluate(
    ([saveKey, priceKey]) => {
      const day2Save: SaveSnapshot = {
        version: 1,
        day: 2,
        money: 50,
        reputation: 1,
        deck: ['守诺', '钢笔'], // only 守诺 is from items.json; 钢笔 is night-only
        shopLevel: 2,
        redeemTickets: 1,
      };
      localStorage.setItem(saveKey, JSON.stringify(day2Save));
      // Record historical high-tier deal price of 90 for 守诺 (婚戒) -> payout = 90 * 1.2 = 108
      localStorage.setItem(priceKey, JSON.stringify({ 守诺: [90] }));
    },
    [SAVE_STORAGE_KEY, PAWN_PRICES_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);

  // Before customer 1, redemption event triggers!
  const redeemState = await waitForPawnshopPhase(page, 'redemption');
  expect(redeemState.redeemTickets).toBe(1);
  expect(redeemState.redemptionOffer).toEqual({
    itemId: 'ring',
    itemName: '婚戒',
    cardName: '守诺',
    basePrice: 90,
    payout: 108,
  });

  // Accept redemption -> card leaves deck, money +108 (50 -> 158), rep +1 (1 -> 2), tickets -1 (1 -> 0)
  await clickLogical(page, canvas, BUTTONS.redeemAccept);
  const negotiating = await waitForPawnshopPhase(page, 'negotiating');
  expect(negotiating.customerIndex).toBe(0);
  expect(negotiating.money).toBe(158);
  expect(negotiating.reputation).toBe(2);
  expect(negotiating.redeemTickets).toBe(0);
  expect(negotiating.deck).toEqual(['钢笔']);
  expect(negotiating.redemptionOffer).toBeNull();

  // Reload and Continue -> since redeemTickets is now 0, redemption does NOT trigger again
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  const reloaded = await waitForPawnshopPhase(page, 'negotiating');
  expect(reloaded.money).toBe(158);
  expect(reloaded.redeemTickets).toBe(0);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('C4 redemption reject: preserves card, money, reputation, and redeemTickets unchanged (with trueValue fallback)', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7');
  await page.evaluate(
    ([saveKey, priceKey]) => {
      const day2Save: SaveSnapshot = {
        version: 1,
        day: 2,
        money: 50,
        reputation: 1,
        deck: ['守诺'],
        shopLevel: 2,
        redeemTickets: 2,
      };
      localStorage.setItem(saveKey, JSON.stringify(day2Save));
      // No recorded deal price -> fallback to 婚戒 trueValue 60 -> payout = 60 * 1.2 = 72
      localStorage.removeItem(priceKey);
    },
    [SAVE_STORAGE_KEY, PAWN_PRICES_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);

  const redeemState = await waitForPawnshopPhase(page, 'redemption');
  expect(redeemState.redemptionOffer).toEqual({
    itemId: 'ring',
    itemName: '婚戒',
    cardName: '守诺',
    basePrice: 60,
    payout: 72,
  });

  // Reject redemption -> everything unchanged, proceeds cleanly to Customer 1
  await clickLogical(page, canvas, BUTTONS.redeemReject);
  const negotiating = await waitForPawnshopPhase(page, 'negotiating');
  expect(negotiating.customerIndex).toBe(0);
  expect(negotiating.money).toBe(50);
  expect(negotiating.reputation).toBe(1);
  expect(negotiating.redeemTickets).toBe(2);
  expect(negotiating.deck).toEqual(['守诺']);
  expect(negotiating.redemptionOffer).toBeNull();

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

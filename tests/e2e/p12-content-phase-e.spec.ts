import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  MORNING_OPTION_BUTTONS,
  PACT_OPTION_BUTTONS,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  REDEMPTION_ACCEPT_BUTTON,
  RESULT_NEXT_DAY_BUTTON,
  TITLE_CONTINUE_BUTTON,
  TRIM_SKIP_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const GLOSSARY_STORAGE_KEY = 'pawnshop-cards-glossary-v1';
const PAWN_PRICES_STORAGE_KEY = 'pawnshop-cards-pawn-prices-v1';
const SCREENSHOT_DIR = 'test-results';

const ALL_GLOSSARY_SEEN = JSON.stringify([
  'reputation',
  'renqing',
  'obsession',
  'charge_threshold',
  'debt_note',
]);

interface PawnshopDebugState {
  phase: string;
  day?: number;
  deck: string[];
  itemsOrder?: string[];
  redemptionOffer?: {
    itemId: string;
    isBrideScripted?: boolean;
  } | null;
  chapter?: {
    dayInChapter: number;
    redeemedDayByItem?: Record<string, number>;
  };
}

interface BattleDebugState {
  phase: string;
  round: number;
  isAnimating?: boolean;
}

function trackErrors(page: Page): { pageErrors: string[]; failedRequests: string[] } {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('requestfailed', (req) =>
    failedRequests.push(`requestfailed ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });
  return { pageErrors, failedRequests };
}

async function getPawnshopState(page: Page): Promise<PawnshopDebugState> {
  return page.evaluate(() => {
    const hook = (
      window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => PawnshopDebugState } }
    ).__PAWNSHOP_DEBUG__;
    if (!hook) throw new Error('__PAWNSHOP_DEBUG__ missing');
    return hook.getState();
  });
}

async function waitForPawnshopPhase(page: Page, expected: string): Promise<PawnshopDebugState> {
  await expect
    .poll(async () => {
      try {
        return (await getPawnshopState(page)).phase;
      } catch {
        return null;
      }
    })
    .toBe(expected);
  return getPawnshopState(page);
}

async function getBattleState(page: Page): Promise<BattleDebugState> {
  return page.evaluate(() => {
    const hook = (
      window as unknown as { __BATTLE_DEBUG__?: { getState: () => BattleDebugState } }
    ).__BATTLE_DEBUG__;
    if (!hook) throw new Error('__BATTLE_DEBUG__ missing');
    return hook.getState();
  });
}

async function waitForBattleReady(page: Page, expectedPhase = 'play'): Promise<BattleDebugState> {
  await expect
    .poll(async () => {
      try {
        const s = await getBattleState(page);
        return s.isAnimating ? 'animating' : s.phase;
      } catch {
        return null;
      }
    })
    .toBe(expectedPhase);
  return getBattleState(page);
}

function buildSeededSave(opts: {
  day: number;
  deck: string[];
  money?: number;
  day1RingPawned?: boolean;
  day2BrideRedemptionDone?: boolean;
  day4TrimDone?: boolean;
  pactChoice?: string | null;
  pawnedItemIds?: string[];
  redeemedDayByItem?: Record<string, number>;
}): string {
  const cleared = Array.from({ length: opts.day - 1 }, (_, i) => i + 1);
  return JSON.stringify({
    version: 3,
    day: opts.day,
    money: opts.money ?? 240,
    reputation: 0,
    deck: opts.deck,
    shopLevel: 4,
    redeemTickets: 0,
    currentHp: 30,
    tutorialCompleted: true,
    chapter: {
      currentChapter: 1,
      dayInChapter: opts.day,
      chapter1Completed: false,
      chapter1FailedCount: 0,
      status: 'in_progress',
      bossBattleActive: false,
      pactChoice: opts.pactChoice ?? null,
      sideQuestChoice: null,
      daysCleared: cleared,
      daysVisited: cleared,
      pawnsCollected: opts.deck.length,
      demonsDefeated: cleared.length,
      day1RingPawned: opts.day1RingPawned ?? false,
      day2BrideRedemptionDone: opts.day2BrideRedemptionDone ?? false,
      day4TrimDone: opts.day4TrimDone ?? false,
      day6SideQuestDone: false,
      ...(opts.pawnedItemIds ? { pawnedItemIds: opts.pawnedItemIds } : {}),
      ...(opts.redeemedDayByItem ? { redeemedDayByItem: opts.redeemedDayByItem } : {}),
    },
  });
}

async function seedAndEnterMorning(
  page: Page,
  canvas: Locator,
  url: string,
  saveJson: string,
  pawnPrices: Record<string, number[]> = {},
): Promise<PawnshopDebugState> {
  await page.goto(url);
  await page.evaluate(
    ([saveKey, tutKey, glosKey, glosVal, pricesKey, pricesJson, saveVal]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(glosKey, glosVal);
      localStorage.setItem(pricesKey, pricesJson);
      localStorage.setItem(saveKey, saveVal);
    },
    [
      SAVE_STORAGE_KEY,
      TUTORIAL_STORAGE_KEY,
      GLOSSARY_STORAGE_KEY,
      ALL_GLOSSARY_SEEN,
      PAWN_PRICES_STORAGE_KEY,
      JSON.stringify(pawnPrices),
      saveJson,
    ] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  return waitForPawnshopPhase(page, 'morning');
}

async function skipAllCustomersAndEnterNight(page: Page, canvas: Locator, count = 3): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
}

async function finishNightQuicklyByEndTurn(page: Page, canvas: Locator): Promise<void> {
  await waitForBattleReady(page, 'play');
  for (let r = 1; r <= 3; r += 1) {
    await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
    if (r < 3) {
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return !s.isAnimating && (s.phase === 'result_scene' || s.round !== r);
        })
        .toBe(true);
    }
  }
  await waitForBattleReady(page, 'result_scene');
  await clickLogical(page, canvas, RESULT_NEXT_DAY_BUTTON);
}

test('P12 Phase E (a): Redeemed item stays excluded for the entire chapter across 3 consecutive days (Days 3-5)', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // seed=4 puts `ring` in Day 3 and Day 5 pools when NOT redeemed.
  // Redeem `ring` on Day 2 via Bride event -> Days 3, 4, and 5 must all fill 3 customers and NEVER include `ring`.
  await seedAndEnterMorning(
    page,
    canvas,
    '/?seed=4',
    buildSeededSave({
      day: 2,
      deck: ['守诺', '钢笔'],
      day1RingPawned: true,
      day2BrideRedemptionDone: false,
      pawnedItemIds: ['ring'],
    }),
    { 守诺: [60] },
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);

  const redeemPhase = await waitForPawnshopPhase(page, 'redemption');
  expect(redeemPhase.redemptionOffer?.itemId).toBe('ring');
  expect(redeemPhase.redemptionOffer?.isBrideScripted).toBe(true);
  await clickLogical(page, canvas, REDEMPTION_ACCEPT_BUTTON);

  const day2Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2Neg.itemsOrder).toHaveLength(3);
  expect(day2Neg.itemsOrder).not.toContain('ring');
  expect(day2Neg.chapter?.redeemedDayByItem?.ring).toBe(2);

  await skipAllCustomersAndEnterNight(page, canvas, 3);
  await finishNightQuicklyByEndTurn(page, canvas);

  // Day 3 (consecutive day 1 after redemption)
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  const day3Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(day3Neg.day).toBe(3);
  expect(day3Neg.itemsOrder).toHaveLength(3);
  expect(day3Neg.itemsOrder).not.toContain('ring');
  await page.screenshot({ path: `${SCREENSHOT_DIR}/p12-phase-e-d1-redeemed-excluded.png` });

  await skipAllCustomersAndEnterNight(page, canvas, 3);
  await finishNightQuicklyByEndTurn(page, canvas);

  // Day 4 (consecutive day 2 after redemption) -> pact + trim skip -> negotiating
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'pact');
  const steadyPactBtn = PACT_OPTION_BUTTONS.find((b) => b.id === 'steady_shop')!;
  await clickLogical(page, canvas, steadyPactBtn);
  await waitForPawnshopPhase(page, 'trim_deck');
  await clickLogical(page, canvas, TRIM_SKIP_BUTTON);
  const day4Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(day4Neg.day).toBe(4);
  expect(day4Neg.itemsOrder).toHaveLength(3);
  expect(day4Neg.itemsOrder).not.toContain('ring');

  await skipAllCustomersAndEnterNight(page, canvas, 3);
  await finishNightQuicklyByEndTurn(page, canvas);

  // Day 5 (consecutive day 3 after redemption, past old 2-day cooldown!) -> still excludes `ring`
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  const day5Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(day5Neg.day).toBe(5);
  expect(day5Neg.itemsOrder).toHaveLength(3);
  expect(day5Neg.itemsOrder).not.toContain('ring');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 Phase E (b): D2 hard rule serves only unowned items from Day 2 onward while unowned >= 3', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  const ownedIds = ['watch', 'ring', 'old_book', 'bicycle', 'erhu', 'stamp_album'];
  const ownedCards = ['倒转', '守诺', '旧书', '飞驰', '余音', '集邮'];

  await seedAndEnterMorning(
    page,
    canvas,
    '/?seed=17',
    buildSeededSave({
      day: 2,
      deck: ownedCards,
      pawnedItemIds: ownedIds,
    }),
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  const day2Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2Neg.itemsOrder).toHaveLength(3);
  for (const id of day2Neg.itemsOrder!) {
    expect(ownedIds).not.toContain(id);
  }

  // Advance to Day 3 and verify D2 hard rule still holds
  await skipAllCustomersAndEnterNight(page, canvas, 3);
  await finishNightQuicklyByEndTurn(page, canvas);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  const day3Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(day3Neg.itemsOrder).toHaveLength(3);
  for (const id of day3Neg.itemsOrder!) {
    expect(ownedIds).not.toContain(id);
  }

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 Phase E (c): Unified 3-tier fallback chain fills 3 customers across Tier 2 (owned) and Tier 3 (redeemed ascending)', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // 1) Tier 1 insufficient (10 owned, 2 unowned) -> fills 2 unowned (Tier 1) + 1 owned unredeemed (Tier 2)
  await seedAndEnterMorning(
    page,
    canvas,
    '/?seed=5',
    buildSeededSave({
      day: 3,
      deck: ['倒转', '守诺', '旧书', '飞驰', '余音', '集邮', '布票', '口琴', '药箱', '账本'],
      pawnedItemIds: [
        'watch',
        'ring',
        'old_book',
        'bicycle',
        'erhu',
        'stamp_album',
        'cloth_ticket',
        'harmonica',
        'medicine_box',
        'ledger',
      ],
    }),
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  const tier2Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(tier2Neg.itemsOrder).toHaveLength(3);
  expect(new Set(tier2Neg.itemsOrder!.slice(0, 2))).toEqual(new Set(['tin_trunk', 'gold_watch']));
  expect(['tin_trunk', 'gold_watch']).not.toContain(tier2Neg.itemsOrder![2]);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/p12-phase-e-fallback-tier2.png` });

  // 2) Tier 1 + Tier 2 insufficient (only `watch` unredeemed & owned, 11 items redeemed on Days 1..6)
  //    -> 1st slot is `watch` (Tier 2), slots 2 & 3 are oldest-redeemed `erhu` (day 1) & `old_book` (day 2) (Tier 3)
  await seedAndEnterMorning(
    page,
    canvas,
    '/?seed=9',
    buildSeededSave({
      day: 6,
      deck: ['倒转'],
      pawnedItemIds: ['watch'],
      redeemedDayByItem: {
        ring: 5,
        old_book: 2,
        bicycle: 4,
        erhu: 1,
        stamp_album: 3,
        cloth_ticket: 5,
        harmonica: 4,
        medicine_box: 3,
        ledger: 5,
        tin_trunk: 4,
        gold_watch: 5,
      },
    }),
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  const tier3Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(tier3Neg.itemsOrder).toEqual(['watch', 'erhu', 'old_book']);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/p12-phase-e-fallback-tier3.png` });

  // 3) All 12 items redeemed -> fills 3 customers sorted by earliest redeemedDay ascending
  await seedAndEnterMorning(
    page,
    canvas,
    '/?seed=11',
    buildSeededSave({
      day: 7,
      deck: ['钢笔'],
      redeemedDayByItem: {
        watch: 5,
        ring: 6,
        old_book: 4,
        bicycle: 3,
        erhu: 6,
        stamp_album: 5,
        cloth_ticket: 1,
        harmonica: 4,
        medicine_box: 2,
        ledger: 5,
        tin_trunk: 6,
        gold_watch: 3,
      },
    }),
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'boss_preview');
  // Day 7: confirm boss_preview -> negotiating
  await clickLogical(page, canvas, { x: 320, y: 316 });
  const allRedeemedNeg = await waitForPawnshopPhase(page, 'negotiating');
  expect(allRedeemedNeg.itemsOrder).toHaveLength(3);
  // Day 1 (`cloth_ticket`), Day 2 (`medicine_box`), and one of the two Day 3 items (`bicycle` or `gold_watch`)
  expect(allRedeemedNeg.itemsOrder!.slice(0, 2)).toEqual(['cloth_ticket', 'medicine_box']);
  expect(['bicycle', 'gold_watch']).toContain(allRedeemedNeg.itemsOrder![2]);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

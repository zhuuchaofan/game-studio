import { expect, test, type Locator, type Page } from '@playwright/test';
import { getTutorialBubbleLayout } from '../../src/game/tutorial';
import { clickLogical, LOGICAL_WIDTH } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const PAWN_PRICES_STORAGE_KEY = 'pawnshop-cards-pawn-prices-v1';

interface PawnshopDebugState {
  phase:
    | 'title'
    | 'pact'
    | 'trim_deck'
    | 'redemption'
    | 'negotiating'
    | 'feedback'
    | 'side_quest'
    | 'summary';
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  day?: number;
  redeemTickets?: number;
  itemsOrder?: string[];
  tierAffordability?: { low: boolean; fair: boolean; high: boolean };
  redemptionOffer?: {
    itemId: string;
    itemName: string;
    cardName: string;
    basePrice: number;
    payout: number;
    isBrideScripted?: boolean;
  } | null;
  tutorialActive?: boolean;
  currentStep?: string | null;
  tutorialDone?: boolean;
  tutorialCopy?: string | null;
  day3Rumor?: string | null;
}

interface BattleDebugState {
  phase: string;
  round: number;
  playerHp: number;
  renqing: number;
  demonHp: number;
  demonId: string;
  demonName: string;
  demonIntroLine?: string;
  demonCustomerLink?: string;
  demonIntroBannerText?: string;
  victoryLine?: string | null;
  aftermathLine?: string | null;
  hand: string[];
  discardCount: number;
  result: string;
  loseReason?: string | null;
  isAnimating?: boolean;
  tutorialActive?: boolean;
  currentStep?: string | null;
  tutorialCopy?: string | null;
}

const CARD_WIDTH = 48;
const CARD_GAP = 4;
const HAND_MARGIN_X = 6;
const HAND_Y = 144;
const DAMAGE_PRIORITY = ['秤砣', '钢笔', '相机', '弹珠'] as const;
const UTILITY_PRIORITY = ['算盘', '旧书', '蒲扇'] as const;
const CARD_COSTS: Record<string, number> = {
  倒转: 2,
  守诺: 1,
  旧书: 1,
  算盘: 1,
  钢笔: 1,
  秤砣: 1,
  相机: 1,
  弹珠: 1,
  蒲扇: 1,
  暖水瓶: 1,
};

const BUTTONS = {
  titleStart: { x: 160, y: 122 },
  titleContinue: { x: 160, y: 156 },
  redeemAccept: { x: 96, y: 151 },
  redeemReject: { x: 224, y: 151 },
  tierHigh: { x: 262, y: 154 },
  skipCustomer: { x: 270, y: 107 },
  nextOrSummary: { x: 160, y: 154 },
  enterNightBattle: { x: 88, y: 151 },
  endTurn: { x: 283, y: 95 },
  resultNextDay: { x: 88, y: 148 },
} as const;

function computeHandCardX(index: number, count: number): number {
  const availableWidth = LOGICAL_WIDTH - HAND_MARGIN_X * 2;
  const naturalStep = CARD_WIDTH + CARD_GAP;
  const maxWidth = CARD_WIDTH + (count - 1) * naturalStep;
  const step =
    maxWidth <= availableWidth || count === 1
      ? naturalStep
      : Math.floor((availableWidth - CARD_WIDTH) / (count - 1));
  const totalWidth = CARD_WIDTH + (count - 1) * step;
  const startCenterX = Math.floor((LOGICAL_WIDTH - totalWidth) / 2) + Math.floor(CARD_WIDTH / 2);
  return startCenterX + index * step;
}

function trackErrors(page: Page): { pageErrors: string[]; failedRequests: string[] } {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('requestfailed', (req) =>
    failedRequests.push(`requestfailed ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
  });
  return { pageErrors, failedRequests };
}

async function getPawnshopState(page: Page): Promise<PawnshopDebugState> {
  return page.evaluate(() => {
    const hook = (
      window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => PawnshopDebugState } }
    ).__PAWNSHOP_DEBUG__;
    return hook!.getState();
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

async function getBattleState(page: Page): Promise<BattleDebugState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __BATTLE_DEBUG__?: { getState: () => BattleDebugState } })
      .__BATTLE_DEBUG__;
    return hook!.getState();
  });
}

async function waitForBattleReady(page: Page, expectedPhase = 'play'): Promise<BattleDebugState> {
  await expect
    .poll(async () =>
      page.evaluate((target) => {
        const hook = (window as unknown as { __BATTLE_DEBUG__?: { getState: () => BattleDebugState } })
          .__BATTLE_DEBUG__;
        const s = hook?.getState();
        return Boolean(s && !s.isAnimating && s.phase === target);
      }, expectedPhase),
    )
    .toBe(true);
  return getBattleState(page);
}

async function loseNightByEndingThreeTurns(page: Page, canvas: Locator): Promise<BattleDebugState> {
  for (let r = 1; r <= 3; r += 1) {
    await clickLogical(page, canvas, BUTTONS.endTurn);
    if (r < 3) {
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return !s.isAnimating && s.round === r + 1;
        })
        .toBe(true);
    }
  }
  return waitForBattleReady(page, 'result_scene');
}

async function playGreedyUntilResult(page: Page, canvas: Locator): Promise<BattleDebugState> {
  let state = await waitForBattleReady(page, 'play');
  let safety = 0;

  while (state.phase === 'play' && state.result === 'ongoing' && safety < 40) {
    safety += 1;
    let chosenIdx = -1;
    for (const cardName of DAMAGE_PRIORITY) {
      const idx = state.hand.indexOf(cardName);
      if (idx !== -1 && state.renqing >= (CARD_COSTS[cardName] ?? 99)) {
        chosenIdx = idx;
        break;
      }
    }
    if (chosenIdx === -1) {
      for (const cardName of UTILITY_PRIORITY) {
        const idx = state.hand.indexOf(cardName);
        if (idx !== -1 && state.renqing >= (CARD_COSTS[cardName] ?? 99)) {
          chosenIdx = idx;
          break;
        }
      }
    }
    if (chosenIdx !== -1) {
      const prevRenqing = state.renqing;
      const prevDiscard = state.discardCount;
      await clickLogical(page, canvas, {
        x: computeHandCardX(chosenIdx, state.hand.length),
        y: HAND_Y,
      });
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return (
            !s.isAnimating &&
            (s.phase === 'result_scene' ||
              s.result !== 'ongoing' ||
              s.renqing !== prevRenqing ||
              s.discardCount !== prevDiscard)
          );
        })
        .toBe(true);
      state = await getBattleState(page);
    } else {
      const prevRound = state.round;
      await clickLogical(page, canvas, BUTTONS.endTurn);
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return !s.isAnimating && (s.phase === 'result_scene' || s.round !== prevRound);
        })
        .toBe(true);
      state = await getBattleState(page);
    }
  }

  return waitForBattleReady(page, 'result_scene');
}

test('P10 E2E 1: Night 1 tutorial shows 20HP/3-round goal & damage-card route before first quote, and losing Night 1 shows defeat-aligned settlement copy + Day 2 affordable damage item recovery', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7');
  await page.evaluate(
    ([saveKey, tutKey, priceKey]) => {
      localStorage.removeItem(saveKey);
      localStorage.removeItem(tutKey);
      localStorage.removeItem(priceKey);
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, PAWN_PRICES_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');

  // Start Day 1 (first-time player) -> Step 1 shows Night 1 goal & damage-card route BEFORE first quote
  await clickLogical(page, canvas, BUTTONS.titleStart);
  const step1 = await waitForPawnshopPhase(page, 'negotiating');
  expect(step1.tutorialActive).toBe(true);
  expect(step1.currentStep).toBe('pawnshop_intro');
  expect(step1.tutorialCopy).toContain('3回合');
  expect(step1.tutorialCopy).toContain('20血');
  expect(step1.tutorialCopy).toContain('二胡余音');
  expect(step1.tutorialCopy).toContain('自行车飞驰');

  // Dismiss step 1 & step 2 bubbles
  await clickLogical(page, canvas, getTutorialBubbleLayout('pawnshop_intro').continueClickPoint);
  await expect.poll(async () => (await getPawnshopState(page)).currentStep).toBe('offer_tiers');
  await clickLogical(page, canvas, getTutorialBubbleLayout('offer_tiers').continueClickPoint);
  await expect.poll(async () => (await getPawnshopState(page)).currentStep).toBeNull();

  // Buy all 3 items at High on seed=7 (erhu 75 + watch 60 + old_book 30 = 165 -> 35 yuan left!)
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  await waitForPawnshopPhase(page, 'feedback');
  await clickLogical(page, canvas, getTutorialBubbleLayout('deal_card').continueClickPoint);
  await expect.poll(async () => (await getPawnshopState(page)).currentStep).toBeNull();
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);

  for (let i = 1; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.tierHigh);
    await waitForPawnshopPhase(page, 'feedback');
    await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  }

  const summary = await waitForPawnshopPhase(page, 'summary');
  expect(summary.money).toBe(35);
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  // Dismiss Night 1 tutorial bubbles (4/6 & 5/6)
  const nightStart = await waitForBattleReady(page, 'play');
  expect(nightStart.currentStep).toBe('night_play');
  await clickLogical(page, canvas, getTutorialBubbleLayout('night_play').continueClickPoint);
  await expect.poll(async () => (await getBattleState(page)).currentStep).toBe('renqing');
  await clickLogical(page, canvas, getTutorialBubbleLayout('renqing').continueClickPoint);
  await expect.poll(async () => (await getBattleState(page)).currentStep).toBeNull();

  // Lose Night 1 by timeout -> settlement bubble MUST use defeat copy (no "过关"!)
  const loseResult = await loseNightByEndingThreeTurns(page, canvas);
  expect(loseResult.result).toBe('lose_timeout');
  expect(loseResult.loseReason).toBe('3 回合未分胜负');
  expect(loseResult.tutorialActive).toBe(true);
  expect(loseResult.currentStep).toBe('settlement');
  expect(loseResult.tutorialCopy).toContain('头一天没打下来');
  expect(loseResult.tutorialCopy).not.toContain('过关');

  // Dismiss final bubble and advance to Day 2 -> recovery guarantees affordable damage item (erhu low=25 <= 35!)
  await clickLogical(page, canvas, getTutorialBubbleLayout('settlement').continueClickPoint);
  await clickLogical(page, canvas, BUTTONS.resultNextDay);

  const day2 = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2.day).toBe(2);
  expect(day2.money).toBe(35);
  expect(day2.itemsOrder).toContain('erhu');

  // Advance until erhu is on screen and verify low tier (25 yuan <= 35 yuan) is affordable!
  let current = day2;
  while (current.itemsOrder && current.itemsOrder[current.customerIndex] !== 'erhu') {
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
    current = await waitForPawnshopPhase(page, 'negotiating');
  }
  expect(current.tierAffordability?.low).toBe(true);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P10 E2E 2: Day 1 pawning 婚戒 triggers Day 2 Bride scripted redemption (Accept case: card leaves, +1.2x money, rep+1, 0 tickets consumed)', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  // seed=4 Day 1 lineup: ['watch', 'bicycle', 'ring']
  await page.goto('/?seed=4');
  await page.evaluate(
    ([saveKey, tutKey, priceKey]) => {
      localStorage.removeItem(saveKey);
      localStorage.setItem(tutKey, '1');
      localStorage.removeItem(priceKey);
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, PAWN_PRICES_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleStart);

  // Skip watch, skip bicycle, buy ring at High (90 yuan -> money 110, rep +1, deck ['守诺'])
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, BUTTONS.skipCustomer);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, BUTTONS.skipCustomer);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  await waitForPawnshopPhase(page, 'feedback');
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);

  const summary = await waitForPawnshopPhase(page, 'summary');
  expect(summary.deck).toEqual(['守诺']);
  expect(summary.money).toBe(110);
  expect(summary.reputation).toBe(1);

  // Lose Night 1 (0 redeemTickets!) -> Bride scripted event STILL triggers on Day 2!
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  await waitForBattleReady(page, 'play');
  const loseResult = await loseNightByEndingThreeTurns(page, canvas);
  expect(loseResult.result).toBe('lose_timeout');

  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  const brideState = await waitForPawnshopPhase(page, 'redemption');
  expect(brideState.day).toBe(2);
  expect(brideState.redeemTickets).toBe(0);
  expect(brideState.redemptionOffer).toEqual({
    itemId: 'ring',
    itemName: '婚戒',
    cardName: '守诺',
    basePrice: 90,
    payout: 108,
    isBrideScripted: true,
  });

  // Accept Bride redemption -> 守诺 leaves deck, money 110 + 108 = 218, rep 1 -> 2, tickets still 0
  await clickLogical(page, canvas, BUTTONS.redeemAccept);
  const day2Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2Neg.money).toBe(218);
  expect(day2Neg.reputation).toBe(2);
  expect(day2Neg.redeemTickets).toBe(0);
  expect(day2Neg.deck).toEqual([]);
  expect(day2Neg.redemptionOffer).toBeNull();

  // Reload Day 2 -> Bride event must NOT trigger a second time
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  const afterReload = await waitForPawnshopPhase(page, 'negotiating');
  expect(afterReload.day).toBe(2);
  expect(afterReload.money).toBe(218);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P10 E2E 3: Day 1 pawning 婚戒 triggers Day 2 Bride scripted redemption (Reject case: 守诺 stays, money unchanged, rep-1)', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  // seed=4 Day 1 lineup: ['watch', 'bicycle', 'ring']
  await page.goto('/?seed=4');
  await page.evaluate(
    ([saveKey, tutKey, priceKey]) => {
      localStorage.removeItem(saveKey);
      localStorage.setItem(tutKey, '1');
      localStorage.removeItem(priceKey);
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, PAWN_PRICES_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleStart);

  // Skip watch & bicycle, buy ring at High (90 -> money 110, rep +1, deck ['守诺'])
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, BUTTONS.skipCustomer);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, BUTTONS.skipCustomer);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  await waitForPawnshopPhase(page, 'feedback');
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  await waitForPawnshopPhase(page, 'summary');

  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  await waitForBattleReady(page, 'play');
  await loseNightByEndingThreeTurns(page, canvas);

  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  const brideState = await waitForPawnshopPhase(page, 'redemption');
  expect(brideState.redemptionOffer?.isBrideScripted).toBe(true);
  expect(brideState.redemptionOffer?.cardName).toBe('守诺');

  // Reject Bride redemption -> 守诺 kept, money unchanged (110), rep 1 -> 0 (-1!)
  await clickLogical(page, canvas, BUTTONS.redeemReject);
  const day2Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2Neg.deck).toEqual(['守诺']);
  expect(day2Neg.money).toBe(110);
  expect(day2Neg.reputation).toBe(0);
  expect(day2Neg.redeemTickets).toBe(0);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P10 E2E 4: Demon opening banner & details explicitly link to daytime customer, victory screen shows grounded aftermath', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=2&deck=test');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.removeItem(saveKey);
      localStorage.setItem(tutKey, '1');
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleStart);

  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  const battle = await waitForBattleReady(page, 'play');
  expect(battle.demonId).toBe('a');
  expect(battle.demonName).toBe('药费');
  expect(battle.demonCustomerLink).toContain('父亲');
  expect(battle.demonCustomerLink).toContain('手表');
  expect(battle.demonIntroBannerText).toContain('药费');
  expect(battle.demonIntroBannerText).toContain('父亲');
  expect(battle.demonIntroBannerText).toContain('手表');

  // Win Night 1 -> victory result includes both victoryLine and grounded aftermathLine ("账单还在")
  const res = await playGreedyUntilResult(page, canvas);
  expect(res.result).toBe('win');
  expect(res.victoryLine).toContain('父亲');
  expect(res.aftermathLine).toContain('手表');
  expect(res.aftermathLine).toContain('账单还在');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

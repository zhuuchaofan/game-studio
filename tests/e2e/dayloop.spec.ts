import { expect, test, type Locator, type Page } from '@playwright/test';

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
  phase: 'title' | 'negotiating' | 'feedback' | 'summary';
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
}

interface TransitionDebugState {
  active: boolean;
  frame: number;
  totalFrames: number;
  next: string;
}

interface BattleDebugState {
  phase: 'draw' | 'play' | 'demonAct' | 'roundEnd' | 'result' | 'empty_deck' | 'result_scene';
  round: number;
  playerHp: number;
  shield: number;
  renqing: number;
  maxRenqing?: number;
  demonHp: number;
  hand: string[];
  deckCount: number;
  discardCount: number;
  result: 'ongoing' | 'win' | 'lose_hp' | 'lose_timeout' | 'empty_deck';
  demonId: string;
  demonName: string;
  isAnimating?: boolean;
  reward?: {
    money: number;
    cardName: string | null;
    redeemTicket: number;
    allOwnedBonus: boolean;
  } | null;
  loseReason?: string | null;
  day?: number;
  shopLevel?: number;
  savedData?: SaveSnapshot | null;
}

const LOGICAL_WIDTH = 320;
const LOGICAL_HEIGHT = 180;
const CARD_WIDTH = 48;
const CARD_GAP = 4;
const HAND_MARGIN_X = 6;
const HAND_Y = 144;
const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';

const BUTTONS = {
  titleStart: { x: 160, y: 122 },
  titleContinue: { x: 160, y: 156 },
  tierHigh: { x: 262, y: 151 },
  nextOrSummary: { x: 160, y: 151 },
  enterNightBattle: { x: 88, y: 151 },
  endTurn: { x: 283, y: 95 },
  resultNextDay: { x: 88, y: 148 },
  resultReturnTitle: { x: 222, y: 148 },
} as const;

const DAMAGE_PRIORITY = ['秤砣', '钢笔', '相机', '弹珠'] as const;
const UTILITY_PRIORITY = ['算盘', '旧书'] as const;
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

  return page.evaluate(() => {
    const hook = (
      window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => PawnshopDebugState } }
    ).__PAWNSHOP_DEBUG__;
    return hook!.getState();
  });
}

async function getBattleState(page: Page): Promise<BattleDebugState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __BATTLE_DEBUG__?: { getState: () => BattleDebugState } })
      .__BATTLE_DEBUG__;
    if (!hook) {
      throw new Error('window.__BATTLE_DEBUG__ is not initialized');
    }
    return hook.getState();
  });
}

async function waitForBattleReady(
  page: Page,
  expectedPhase?: BattleDebugState['phase'],
): Promise<BattleDebugState> {
  await expect
    .poll(
      async () =>
        page.evaluate((targetPhase) => {
          const hook = (
            window as unknown as { __BATTLE_DEBUG__?: { getState: () => BattleDebugState } }
          ).__BATTLE_DEBUG__;
          const s = hook?.getState();
          if (!s || s.isAnimating) {
            return false;
          }
          if (targetPhase && s.phase !== targetPhase) {
            return false;
          }
          return true;
        }, expectedPhase ?? null),
      { timeout: 10000 },
    )
    .toBe(true);
  return getBattleState(page);
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

async function completeDayPawnshopHigh(page: Page, canvas: Locator): Promise<PawnshopDebugState> {
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.tierHigh);
    await waitForPawnshopPhase(page, 'feedback');
    await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  }
  return waitForPawnshopPhase(page, 'summary');
}

async function playGreedyUntilResult(page: Page, canvas: Locator): Promise<BattleDebugState> {
  let state = await waitForBattleReady(page);
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
      const prevHandLen = state.hand.length;
      const prevDiscard = state.discardCount;
      const x = computeHandCardX(chosenIdx, state.hand.length);
      await clickLogical(page, canvas, { x, y: HAND_Y });

      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return (
            !s.isAnimating &&
            (s.phase === 'result_scene' ||
              s.result !== 'ongoing' ||
              s.renqing !== prevRenqing ||
              s.hand.length !== prevHandLen ||
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

test('full Day 1 -> lamp-pull transition -> win night -> Day 2 (renqing 4, Demon B) + save/continue round-trip + desktop screenshots', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=4&deck=test');
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_STORAGE_KEY);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  // No save -> TitleScene has no Continue button
  const titleNoSave = await waitForPawnshopPhase(page, 'title');
  expect(titleNoSave.hasSave).toBe(false);
  await page.screenshot({ path: 'test-results/dayloop-desktop-title-nosave.png' });

  // Click Start -> Day 1 PawnshopScene with deterministic seed=4 day=1 order: watch -> ring -> old_book
  await clickLogical(page, canvas, BUTTONS.titleStart);
  const day1Start = await waitForPawnshopPhase(page, 'negotiating');
  expect(day1Start.day).toBe(1);
  expect(day1Start.money).toBe(200);
  expect(day1Start.shopLevel).toBe(1);
  expect(day1Start.maxRenqing).toBe(3);
  expect(day1Start.itemsOrder).toEqual(['watch', 'ring', 'old_book']);
  await page.screenshot({ path: 'test-results/dayloop-desktop-day1.png' });

  // Buy all 3 items at High tier (total 180 -> money 20, rep +3, deck 3 cards)
  const day1Summary = await completeDayPawnshopHigh(page, canvas);
  expect(day1Summary.money).toBe(20);
  expect(day1Summary.reputation).toBe(3);
  expect(day1Summary.deck).toEqual(['倒转', '守诺', '旧书']);

  // Enter night battle -> must pass through 6-frame lamp-pull TransitionScene
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const hook = (
            window as unknown as {
              __TRANSITION_DEBUG__?: { getState: () => TransitionDebugState };
            }
          ).__TRANSITION_DEBUG__;
          const s = hook?.getState();
          return Boolean(s && s.active && s.frame >= 1 && s.frame <= 5);
        }),
      { intervals: [20, 20, 20, 30], timeout: 5000 },
    )
    .toBe(true);

  const midTransition = await page.evaluate(() => {
    const hook = (
      window as unknown as { __TRANSITION_DEBUG__?: { getState: () => TransitionDebugState } }
    ).__TRANSITION_DEBUG__;
    return hook!.getState();
  });
  expect(midTransition.active).toBe(true);
  expect(midTransition.totalFrames).toBe(6);
  await page.screenshot({ path: 'test-results/dayloop-desktop-transition.png' });

  // Transition completes into Night 1 Battle (Demon A, maxRenqing = 3)
  const night1 = await waitForBattleReady(page, 'play');
  expect(night1.demonId).toBe('a');
  expect(night1.demonName).toBe('药费');
  expect(night1.renqing).toBe(3);
  expect(night1.maxRenqing).toBe(3);
  await page.screenshot({ path: 'test-results/dayloop-desktop-battle.png' });

  // Win Night 1 -> ResultScene auto-saves Day 2, shopLevel 2, +20 money, +1 reward card, +1 redeemTicket
  const winResult = await playGreedyUntilResult(page, canvas);
  expect(winResult.result).toBe('win');
  expect(winResult.savedData).not.toBeNull();
  expect(winResult.savedData!.version).toBe(1);
  expect(winResult.savedData!.day).toBe(2);
  expect(winResult.savedData!.shopLevel).toBe(2);
  expect(winResult.savedData!.money).toBe(40); // 20 + 20 winRewardMoney
  expect(winResult.savedData!.redeemTickets).toBe(1);
  expect(winResult.savedData!.deck).toHaveLength(4);
  expect(winResult.savedData!.deck[3]).toBe(winResult.reward!.cardName);
  await page.screenshot({ path: 'test-results/dayloop-desktop-result.png' });

  // Click "下一天" -> Day 2 PawnshopScene (day=2, money=40, shopLevel=2, maxRenqing=4, Day 2 shuffle order)
  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  const day2 = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2.day).toBe(2);
  expect(day2.money).toBe(40);
  expect(day2.reputation).toBe(3);
  expect(day2.shopLevel).toBe(2);
  expect(day2.maxRenqing).toBe(4);
  expect(day2.deck).toEqual(winResult.savedData!.deck);
  expect(day2.itemsOrder).toEqual(['ring', 'watch', 'old_book']);
  await page.screenshot({ path: 'test-results/dayloop-desktop-day2.png' });

  // Verify localStorage save round-trip after full page reload -> TitleScene shows Continue
  await page.reload();
  await expect(canvas).toBeVisible();
  const titleWithSave = await waitForPawnshopPhase(page, 'title');
  expect(titleWithSave.hasSave).toBe(true);
  expect(titleWithSave.day).toBe(2);
  expect(titleWithSave.shopLevel).toBe(2);
  await page.screenshot({ path: 'test-results/dayloop-desktop-title-continue.png' });

  // Click Continue -> restores Day 2 PawnshopScene with saved money, deck, and level
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  const restoredDay2 = await waitForPawnshopPhase(page, 'negotiating');
  expect(restoredDay2.day).toBe(2);
  expect(restoredDay2.money).toBe(40);
  expect(restoredDay2.shopLevel).toBe(2);
  expect(restoredDay2.maxRenqing).toBe(4);
  expect(restoredDay2.deck).toEqual(winResult.savedData!.deck);

  // Proceed into Night 2 -> verifies Demon B rotation and maxRenqing = 4 (Lv.2)!
  await completeDayPawnshopHigh(page, canvas);
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  const night2 = await waitForBattleReady(page, 'play');
  expect(night2.demonId).toBe('b');
  expect(night2.demonName).toBe('车票');
  expect(night2.renqing).toBe(4);
  expect(night2.maxRenqing).toBe(4);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('lose flow advances day +1 while keeping deck, money, shopLevel, and redeemTickets unchanged', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7');
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_STORAGE_KEY);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleStart);
  const day1Summary = await completeDayPawnshopHigh(page, canvas);
  expect(day1Summary.money).toBe(20);
  expect(day1Summary.deck).toEqual(['守诺', '倒转', '旧书']);

  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  const battle = await waitForBattleReady(page, 'play');
  expect(battle.demonId).toBe('a');

  // End all 3 turns without killing Demon A -> lose_timeout
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

  const loseResult = await waitForBattleReady(page, 'result_scene');
  expect(loseResult.result).toBe('lose_timeout');
  expect(loseResult.savedData).toEqual({
    version: 1,
    day: 2,
    money: 20,
    reputation: 3,
    deck: ['守诺', '倒转', '旧书'],
    shopLevel: 1,
    redeemTickets: 0,
  });

  // Click "下一天" -> Day 2 starts with unchanged deck/money/level (maxRenqing still 3)
  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  const day2AfterLose = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2AfterLose.day).toBe(2);
  expect(day2AfterLose.money).toBe(20);
  expect(day2AfterLose.shopLevel).toBe(1);
  expect(day2AfterLose.maxRenqing).toBe(3);
  expect(day2AfterLose.deck).toEqual(['守诺', '倒转', '旧书']);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('renders pixel font, 32x32 pixel art, and day loop cleanly on mobile portrait 390x844 viewport', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=4&deck=test');
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_STORAGE_KEY);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  await waitForPawnshopPhase(page, 'title');
  await page.screenshot({ path: 'test-results/dayloop-mobile-title.png' });

  await clickLogical(page, canvas, BUTTONS.titleStart);
  await waitForPawnshopPhase(page, 'negotiating');
  await page.screenshot({ path: 'test-results/dayloop-mobile-day1.png' });

  await completeDayPawnshopHigh(page, canvas);
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  await waitForBattleReady(page, 'play');
  await page.screenshot({ path: 'test-results/dayloop-mobile-battle.png' });

  const winResult = await playGreedyUntilResult(page, canvas);
  expect(winResult.result).toBe('win');
  await page.screenshot({ path: 'test-results/dayloop-mobile-result.png' });

  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  const day2 = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2.day).toBe(2);
  await page.screenshot({ path: 'test-results/dayloop-mobile-day2.png' });

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

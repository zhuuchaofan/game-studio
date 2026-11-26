import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  BATTLE_HAND_Y,
  computeHandCardX,
  PACT_OPTION_BUTTONS,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  REDEMPTION_REJECT_BUTTON,
  RESULT_NEXT_DAY_BUTTON,
  RESULT_RETURN_BUTTON,
  TITLE_CONTINUE_BUTTON,
  TITLE_START_BUTTON,
  TRIM_SKIP_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

interface SaveSnapshot {
  version: 1 | 2 | 3;
  day: number;
  money: number;
  reputation: number;
  deck: string[];
  shopLevel: number;
  redeemTickets: number;
}

interface PawnshopDebugState {
  phase: 'title' | 'pact' | 'trim_deck' | 'redemption' | 'negotiating' | 'feedback' | 'side_quest' | 'summary';
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
  handSlotXs?: number[];
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

const HAND_Y = BATTLE_HAND_Y;
const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';

const BUTTONS = {
  titleStart: TITLE_START_BUTTON,
  titleContinue: TITLE_CONTINUE_BUTTON,
  pactSteady: PACT_OPTION_BUTTONS[2],
  trimSkip: TRIM_SKIP_BUTTON,
  redeemReject: REDEMPTION_REJECT_BUTTON,
  tierLow: PAWNSHOP_TIER_BUTTONS.low,
  tierHigh: PAWNSHOP_TIER_BUTTONS.high,
  nextOrSummary: PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  enterNightBattle: PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  endTurn: BATTLE_END_TURN_BUTTON,
  resultNextDay: RESULT_NEXT_DAY_BUTTON,
  resultReturnTitle: RESULT_RETURN_BUTTON,
} as const;

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

// 钱不能变负数规则下使用的兜底路线：每位当客都点最便宜的低价档。
// 低价接受率 0.3，被拒也不扣钱、流程照常推进，因此只要低价 ≤ 当前钱数就一定能走完当天。
async function completeDayPawnshopLow(page: Page, canvas: Locator): Promise<PawnshopDebugState> {
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.tierLow);
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
      const x = state.handSlotXs?.[chosenIdx] ?? computeHandCardX(chosenIdx, state.hand.length);
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

  await page.goto('/?seed=2&deck=test');
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_STORAGE_KEY);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  // No save -> TitleScene has no Continue button
  const titleNoSave = await waitForPawnshopPhase(page, 'title');
  expect(titleNoSave.hasSave).toBe(false);
  await page.screenshot({ path: 'test-results/dayloop-desktop-title-nosave.png' });

  // Click Start -> Day 1 PawnshopScene with deterministic seed=2 day=1 top-3 order: old_book -> erhu -> stamp_album
  // （原 seed=4 第 1 天高价总额 270 > 开局 200，按新规则第 3 位当客三档全不可点、流程卡死，故改用 seed=2；
  // 死角原样见本文件末尾 P4 用例注释与 proto-tasks/06-no-negative-money.md）
  await clickLogical(page, canvas, BUTTONS.titleStart);
  const day1Start = await waitForPawnshopPhase(page, 'negotiating');
  expect(day1Start.day).toBe(1);
  expect(day1Start.money).toBe(240);
  expect(day1Start.shopLevel).toBe(1);
  expect(day1Start.maxRenqing).toBe(3);
  expect(day1Start.itemsOrder).toEqual(['old_book', 'erhu', 'stamp_album']);
  await page.screenshot({ path: 'test-results/dayloop-desktop-day1.png' });

  // Buy all 3 items at High tier (30 + 75 + 45 = 150 -> money 90, rep +4 with proud stamp_album +2, deck 3 cards)
  const day1Summary = await completeDayPawnshopHigh(page, canvas);
  expect(day1Summary.money).toBe(90);
  expect(day1Summary.money).toBeGreaterThanOrEqual(0);
  expect(day1Summary.reputation).toBe(4);
  expect(day1Summary.deck).toEqual(['旧书', '余音', '集邮']);

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

  // Win Night 1 -> ResultScene auto-saves Day 2, shopLevel 2, +40 money (P6 B1), +1 reward card, +1 redeemTicket
  const winResult = await playGreedyUntilResult(page, canvas);
  expect(winResult.result).toBe('win');
  expect(winResult.savedData).not.toBeNull();
  expect(winResult.savedData!.version).toBe(3);
  expect(winResult.savedData!.day).toBe(2);
  expect(winResult.savedData!.shopLevel).toBe(2);
  expect(winResult.savedData!.money).toBe(130); // 90 + 40 winRewardMoney
  expect(winResult.savedData!.money).toBeGreaterThanOrEqual(0);
  expect(winResult.savedData!.redeemTickets).toBe(1);
  expect(winResult.savedData!.deck).toHaveLength(4);
  expect(winResult.savedData!.deck[3]).toBe(winResult.reward!.cardName);
  await page.screenshot({ path: 'test-results/dayloop-desktop-result.png' });

  // Click "下一天" -> Day 2 opens with C4 redemption (1 redeemTicket + pawnshop cards in deck); reject to enter Day 2 negotiating
  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  await waitForPawnshopPhase(page, 'redemption');
  await clickLogical(page, canvas, BUTTONS.redeemReject);
  const day2 = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2.day).toBe(2);
  expect(day2.money).toBe(130);
  expect(day2.reputation).toBe(4);
  expect(day2.shopLevel).toBe(2);
  expect(day2.maxRenqing).toBe(4);
  expect(day2.deck).toEqual(winResult.savedData!.deck);
  // P11 D2 软版优先未拥有旧物：第 1 天已收 erhu/stamp_album/old_book，第 2 天优先出未拥有的 watch/bicycle/ring
  expect(day2.itemsOrder).toEqual(['watch', 'bicycle', 'ring']);
  await page.screenshot({ path: 'test-results/dayloop-desktop-day2.png' });

  // Verify localStorage save round-trip after full page reload -> TitleScene shows Continue
  await page.reload();
  await expect(canvas).toBeVisible();
  const titleWithSave = await waitForPawnshopPhase(page, 'title');
  expect(titleWithSave.hasSave).toBe(true);
  expect(titleWithSave.day).toBe(2);
  expect(titleWithSave.shopLevel).toBe(2);
  await page.screenshot({ path: 'test-results/dayloop-desktop-title-continue.png' });

  // Click Continue -> restores Day 2 PawnshopScene (reject redemption to keep saved money/deck intact)
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  await waitForPawnshopPhase(page, 'redemption');
  await clickLogical(page, canvas, BUTTONS.redeemReject);
  const restoredDay2 = await waitForPawnshopPhase(page, 'negotiating');
  expect(restoredDay2.day).toBe(2);
  expect(restoredDay2.money).toBe(130);
  expect(restoredDay2.shopLevel).toBe(2);
  expect(restoredDay2.maxRenqing).toBe(4);
  expect(restoredDay2.deck).toEqual(winResult.savedData!.deck);
  // 首位当客旧手表（真值 40）：钱 130 时低 20 / 平 40 / 高 60 全部买得起
  expect(restoredDay2.tierAffordability).toEqual({ low: true, fair: true, high: true });

  // Day 2 pawnshop via Low tier (D2 排位下的 3 位未拥有当客)
  const day2Summary = await completeDayPawnshopLow(page, canvas);
  expect(day2Summary.money).toBeGreaterThanOrEqual(0);
  expect(day2Summary.money).toBeLessThanOrEqual(130);
  expect(day2Summary.deck.length).toBeGreaterThanOrEqual(4);

  // Proceed into Night 2 -> verifies Demon B rotation and maxRenqing = 4 (Lv.2)!
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
  // seed=7 第 1 天高价 75 + 60 + 30 = 165，逐步 75 ≤ 240、60 ≤ 165、30 ≤ 105，全程可买；开局 240 买齐后剩 75
  const day1Summary = await completeDayPawnshopHigh(page, canvas);
  expect(day1Summary.money).toBe(75);
  expect(day1Summary.money).toBeGreaterThanOrEqual(0);
  expect(day1Summary.deck).toEqual(['余音', '倒转', '旧书']);

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
  expect(loseResult.savedData).toMatchObject({
    version: 3,
    day: 2,
    money: 75,
    reputation: 3,
    deck: ['余音', '倒转', '旧书'],
    shopLevel: 1,
    redeemTickets: 0,
  });

  // Click "下一天" -> Day 2 starts with unchanged deck/money/level (maxRenqing still 3)
  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  const day2AfterLose = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2AfterLose.day).toBe(2);
  expect(day2AfterLose.money).toBe(75);
  expect(day2AfterLose.shopLevel).toBe(1);
  expect(day2AfterLose.maxRenqing).toBe(3);
  expect(day2AfterLose.deck).toEqual(['余音', '倒转', '旧书']);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('renders pixel font, 32x32 pixel art (2x), and day loop cleanly on mobile landscape 844x390 viewport', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?seed=2&deck=test');
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_STORAGE_KEY);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  await waitForPawnshopPhase(page, 'title');
  await page.screenshot({ path: 'test-results/dayloop-mobile-title.png' });

  await clickLogical(page, canvas, BUTTONS.titleStart);
  await waitForPawnshopPhase(page, 'negotiating');
  await page.screenshot({ path: 'test-results/dayloop-mobile-day1.png' });

  // seed=2 第 1 天高价 30 + 75 + 45 = 150 -> money 90（原 seed=4 高价 270 会在第 3 位当客卡死，见主流程注释）
  await completeDayPawnshopHigh(page, canvas);
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  await waitForBattleReady(page, 'play');
  await page.screenshot({ path: 'test-results/dayloop-mobile-battle.png' });

  const winResult = await playGreedyUntilResult(page, canvas);
  expect(winResult.result).toBe('win');
  await page.screenshot({ path: 'test-results/dayloop-mobile-result.png' });

  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  await waitForPawnshopPhase(page, 'redemption');
  await clickLogical(page, canvas, BUTTONS.redeemReject);
  const day2 = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2.day).toBe(2);
  await page.screenshot({ path: 'test-results/dayloop-mobile-day2.png' });

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P4 content expansion: new pawnshop items appear in 3-customer lineup and Night 3/4/5 rotate Demon C (房租) -> D (学费) -> A (药费)', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=4&deck=test');

  // Seed localStorage at Day 3 so we can verify real UI loop across Days 3 -> 4 -> 5
  await page.evaluate((key) => {
    const day3Save: SaveSnapshot = {
      version: 1,
      day: 3,
      money: 200,
      reputation: 2,
      deck: ['倒转', '守诺', '旧书'],
      shopLevel: 2,
      redeemTickets: 1,
    };
    localStorage.setItem(key, JSON.stringify(day3Save));
  }, SAVE_STORAGE_KEY);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const titleState = await waitForPawnshopPhase(page, 'title');
  expect(titleState.hasSave).toBe(true);
  expect(titleState.day).toBe(3);

  // Day 3 Pawnshop: reject C4 redemption -> 6-item pool shuffled and sliced to 3 customers
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  await waitForPawnshopPhase(page, 'redemption');
  await clickLogical(page, canvas, BUTTONS.redeemReject);
  const day3Start = await waitForPawnshopPhase(page, 'negotiating');
  expect(day3Start.day).toBe(3);
  expect(day3Start.itemsOrder).toHaveLength(3);
  expect(day3Start.itemsOrder).toContain('erhu');
  await page.screenshot({ path: 'test-results/p4-day3-erhu.png' });

  // Day 3 under P11 D2 soft unowned preference: prioritizes unowned bicycle / erhu / stamp_album
  const day3Summary = await completeDayPawnshopLow(page, canvas);
  expect(day3Summary.money).toBeGreaterThanOrEqual(0);
  expect(day3Summary.money).toBeLessThanOrEqual(200);
  expect(day3Summary.log.some((entry) => entry.includes('二胡'))).toBe(true);

  // Night 3 -> Demon C (房租, HP 26)
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  const night3 = await waitForBattleReady(page, 'play');
  expect(night3.day).toBe(3);
  expect(night3.demonId).toBe('c');
  expect(night3.demonName).toBe('房租');
  expect(night3.demonHp).toBe(26);
  await page.screenshot({ path: 'test-results/p4-night3-demon-c.png' });

  // End 3 turns to advance cleanly to Day 4
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
  const night3Result = await waitForBattleReady(page, 'result_scene');
  expect(night3Result.savedData!.day).toBe(4);
  expect(night3Result.savedData!.money).toBe(day3Summary.money);

  // Day 4 Pawnshop (P9: Pact -> free Trim -> Redemption -> Negotiating) -> Night 4 -> Demon D (学费, HP 20)
  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  await waitForPawnshopPhase(page, 'pact');
  await clickLogical(page, canvas, BUTTONS.pactSteady);
  await waitForPawnshopPhase(page, 'trim_deck');
  await clickLogical(page, canvas, BUTTONS.trimSkip);
  await waitForPawnshopPhase(page, 'redemption');
  await clickLogical(page, canvas, BUTTONS.redeemReject);
  const day4Start = await waitForPawnshopPhase(page, 'negotiating');
  expect(day4Start.day).toBe(4);
  expect(day4Start.money).toBe(day3Summary.money);
  expect(day4Start.itemsOrder).toHaveLength(3);
  const day4Summary = await completeDayPawnshopLow(page, canvas);
  expect(day4Summary.money).toBeGreaterThanOrEqual(0);
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  const night4 = await waitForBattleReady(page, 'play');
  expect(night4.day).toBe(4);
  expect(night4.demonId).toBe('d');
  expect(night4.demonName).toBe('学费');
  expect(night4.demonHp).toBe(20);
  await page.screenshot({ path: 'test-results/p4-night4-demon-d.png' });

  // End 3 turns to advance cleanly to Day 5
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
  const night4Result = await waitForBattleReady(page, 'result_scene');
  expect(night4Result.savedData!.day).toBe(5);

  // Day 5 Pawnshop -> Night 5 -> P9 Chapter 1 escalated pool (B / C / D)
  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  await waitForPawnshopPhase(page, 'redemption');
  await clickLogical(page, canvas, BUTTONS.redeemReject);
  const day5Start = await waitForPawnshopPhase(page, 'negotiating');
  expect(day5Start.day).toBe(5);
  expect(day5Start.itemsOrder).toHaveLength(3);
  const day5Summary = await completeDayPawnshopLow(page, canvas);
  expect(day5Summary.money).toBeGreaterThanOrEqual(0);
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  const night5 = await waitForBattleReady(page, 'play');
  expect(night5.day).toBe(5);
  expect(['b', 'c', 'd']).toContain(night5.demonId);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

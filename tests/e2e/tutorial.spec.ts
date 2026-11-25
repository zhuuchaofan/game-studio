import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  BATTLE_HAND_Y,
  computeHandCardX,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  REDEMPTION_REJECT_BUTTON,
  RESULT_NEXT_DAY_BUTTON,
  RESULT_RETURN_BUTTON,
  TITLE_START_BUTTON,
  TITLE_TUTORIAL_BUTTON,
} from '../../src/game/layout';
import { getTutorialBubbleLayout, type TutorialStepId } from '../../src/game/tutorial';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';

interface PawnshopDebugState {
  phase: 'title' | 'redemption' | 'negotiating' | 'feedback' | 'summary';
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  day?: number;
  hasSave?: boolean;
  tutorialActive?: boolean;
  currentStep?: TutorialStepId | null;
  tutorialDone?: boolean;
  tutorialCopy?: string | null;
}

interface BattleDebugState {
  phase: 'draw' | 'play' | 'demonAct' | 'roundEnd' | 'result' | 'empty_deck' | 'result_scene';
  round: number;
  playerHp: number;
  renqing: number;
  demonHp: number;
  hand: string[];
  discardCount: number;
  result: 'ongoing' | 'win' | 'lose_hp' | 'lose_timeout' | 'empty_deck';
  isAnimating?: boolean;
  day?: number;
  tutorialActive?: boolean;
  currentStep?: TutorialStepId | null;
  tutorialDone?: boolean;
  tutorialCopy?: string | null;
}

const BUTTONS = {
  titleStart: TITLE_START_BUTTON,
  titleTutorial: TITLE_TUTORIAL_BUTTON,
  redeemReject: REDEMPTION_REJECT_BUTTON,
  tierHigh: PAWNSHOP_TIER_BUTTONS.high,
  nextOrSummary: PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  enterNightBattle: PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  endTurn: BATTLE_END_TURN_BUTTON,
  resultNextDay: RESULT_NEXT_DAY_BUTTON,
  resultReturnTitle: RESULT_RETURN_BUTTON,
} as const;

const HAND_Y = BATTLE_HAND_Y;
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

async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(
    ([saveKey, tutorialKey]) => {
      localStorage.removeItem(saveKey);
      localStorage.removeItem(tutorialKey);
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
}

test('first play walks all 6 Day 1 guide bubbles in order, persists completion, and replays via Title 教程 button + screenshots', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=2&deck=test');
  await clearAllStorage(page);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const titleState = await waitForPawnshopPhase(page, 'title');
  expect(titleState.tutorialActive).toBe(false);
  expect(titleState.tutorialDone).toBe(false);
  await page.screenshot({ path: 'test-results/tutorial-title.png' });

  // Start Day 1 (first play) -> Step 1: 收当 (pawnshop_intro)
  await clickLogical(page, canvas, BUTTONS.titleStart);
  const step1 = await waitForPawnshopPhase(page, 'negotiating');
  expect(step1.day).toBe(1);
  expect(step1.tutorialActive).toBe(true);
  expect(step1.currentStep).toBe('pawnshop_intro');
  expect(step1.tutorialCopy).toContain('掌柜：');
  await page.screenshot({ path: 'test-results/tutorial-step1-pawnshop.png' });

  // Click bubble once -> advances to Step 2: 报价三档 (offer_tiers)
  await clickLogical(page, canvas, getTutorialBubbleLayout('pawnshop_intro').continueClickPoint);
  await expect
    .poll(async () => (await getPawnshopState(page)).currentStep)
    .toBe('offer_tiers');
  const step2 = await getPawnshopState(page);
  expect(step2.tutorialActive).toBe(true);
  expect(step2.tutorialCopy).toContain('低价');
  await page.screenshot({ path: 'test-results/tutorial-step2-tiers.png' });

  // Click bubble once -> hides bubble so player picks an offer tier
  await clickLogical(page, canvas, getTutorialBubbleLayout('offer_tiers').continueClickPoint);
  await expect
    .poll(async () => (await getPawnshopState(page)).currentStep)
    .toBeNull();

  // Customer 1 High tier -> feedback shows Step 3: 成交得牌 (deal_card)
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  const step3 = await waitForPawnshopPhase(page, 'feedback');
  expect(step3.tutorialActive).toBe(true);
  expect(step3.currentStep).toBe('deal_card');
  expect(step3.tutorialCopy).toContain('纸牌');
  await page.screenshot({ path: 'test-results/tutorial-step3-deal.png' });

  // Click bubble once -> dismisses step 3
  await clickLogical(page, canvas, getTutorialBubbleLayout('deal_card').continueClickPoint);
  await expect
    .poll(async () => (await getPawnshopState(page)).currentStep)
    .toBeNull();

  // Finish remaining daytime customers (no duplicate daytime bubbles)
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  for (let i = 1; i < 3; i += 1) {
    const neg = await waitForPawnshopPhase(page, 'negotiating');
    expect(neg.currentStep).toBeNull();
    await clickLogical(page, canvas, BUTTONS.tierHigh);
    const fb = await waitForPawnshopPhase(page, 'feedback');
    expect(fb.currentStep).toBeNull();
    await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  }

  const summary = await waitForPawnshopPhase(page, 'summary');
  expect(summary.currentStep).toBeNull();
  expect(summary.tutorialActive).toBe(true);

  // Enter Night 1 battle -> Step 4: 夜里出牌 (night_play)
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  const step4 = await waitForBattleReady(page, 'play');
  expect(step4.tutorialActive).toBe(true);
  expect(step4.currentStep).toBe('night_play');
  expect(step4.tutorialCopy).toContain('手牌');
  await page.screenshot({ path: 'test-results/tutorial-step4-night-play.png' });

  // Click bubble once -> advances to Step 5: 人情 (renqing)
  await clickLogical(page, canvas, getTutorialBubbleLayout('night_play').continueClickPoint);
  await expect
    .poll(async () => (await getBattleState(page)).currentStep)
    .toBe('renqing');
  const step5 = await getBattleState(page);
  expect(step5.tutorialActive).toBe(true);
  expect(step5.tutorialCopy).toContain('人情');
  await page.screenshot({ path: 'test-results/tutorial-step5-renqing.png' });

  // Click bubble once -> hides bubble so player plays out the battle
  await clickLogical(page, canvas, getTutorialBubbleLayout('renqing').continueClickPoint);
  await expect
    .poll(async () => (await getBattleState(page)).currentStep)
    .toBeNull();

  // Win Night 1 -> ResultScene shows Step 6: 结算 (settlement)
  const step6 = await playGreedyUntilResult(page, canvas);
  expect(step6.phase).toBe('result_scene');
  expect(step6.tutorialActive).toBe(true);
  expect(step6.currentStep).toBe('settlement');
  expect(step6.tutorialCopy).toContain('头一天');
  await page.screenshot({ path: 'test-results/tutorial-step6-settlement.png' });

  // Click final bubble -> completes tutorial and persists tutorialDone=true
  await clickLogical(page, canvas, getTutorialBubbleLayout('settlement').continueClickPoint);
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return { active: s.tutorialActive, step: s.currentStep, done: s.tutorialDone };
    })
    .toEqual({ active: false, step: null, done: true });

  // Enter Day 2 -> C4 redemption triggers first, reject to enter negotiating -> no tutorial bubbles
  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  await waitForPawnshopPhase(page, 'redemption');
  await clickLogical(page, canvas, BUTTONS.redeemReject);
  const day2 = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2.day).toBe(2);
  expect(day2.tutorialActive).toBe(false);
  expect(day2.currentStep).toBeNull();
  expect(day2.tutorialDone).toBe(true);

  // Reload to TitleScreen -> click Start (new Day 1) -> tutorial must NOT reappear
  await page.reload();
  await expect(canvas).toBeVisible();
  const titleAfter = await waitForPawnshopPhase(page, 'title');
  expect(titleAfter.tutorialDone).toBe(true);

  await clickLogical(page, canvas, BUTTONS.titleStart);
  const newDay1 = await waitForPawnshopPhase(page, 'negotiating');
  expect(newDay1.day).toBe(1);
  expect(newDay1.tutorialActive).toBe(false);
  expect(newDay1.currentStep).toBeNull();
  expect(newDay1.tutorialDone).toBe(true);

  // Reload to TitleScreen -> click '教程' entry -> replays tutorial on Day 1!
  await page.reload();
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleTutorial);

  const replayDay1 = await waitForPawnshopPhase(page, 'negotiating');
  expect(replayDay1.day).toBe(1);
  expect(replayDay1.tutorialActive).toBe(true);
  expect(replayDay1.currentStep).toBe('pawnshop_intro');
  expect(replayDay1.tutorialDone).toBe(true);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('skip button dismisses the entire tutorial immediately and prevents reappearance', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7');
  await clearAllStorage(page);
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleStart);

  const step1 = await waitForPawnshopPhase(page, 'negotiating');
  expect(step1.tutorialActive).toBe(true);
  expect(step1.currentStep).toBe('pawnshop_intro');

  // Click the always-visible Skip button on Step 1
  const skipPos = getTutorialBubbleLayout('pawnshop_intro').skipButton;
  await clickLogical(page, canvas, { x: skipPos.x, y: skipPos.y });

  await expect
    .poll(async () => {
      const s = await getPawnshopState(page);
      return { active: s.tutorialActive, step: s.currentStep, done: s.tutorialDone };
    })
    .toEqual({ active: false, step: null, done: true });

  // Feedback phase after making an offer must NOT show Step 3
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  const fb = await waitForPawnshopPhase(page, 'feedback');
  expect(fb.tutorialActive).toBe(false);
  expect(fb.currentStep).toBeNull();

  // Finish Day 1 and enter Night 1 -> must NOT show Night 1 tutorial
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  for (let i = 1; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.tierHigh);
    await waitForPawnshopPhase(page, 'feedback');
    await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  const night = await waitForBattleReady(page, 'play');
  expect(night.tutorialActive).toBe(false);
  expect(night.currentStep).toBeNull();
  expect(night.tutorialDone).toBe(true);

  // Reload & Start again -> skipped tutorial stays dismissed
  await page.reload();
  await expect(canvas).toBeVisible();
  const titleAfterSkip = await waitForPawnshopPhase(page, 'title');
  expect(titleAfterSkip.tutorialDone).toBe(true);

  await clickLogical(page, canvas, BUTTONS.titleStart);
  const day1Again = await waitForPawnshopPhase(page, 'negotiating');
  expect(day1Again.tutorialActive).toBe(false);
  expect(day1Again.currentStep).toBeNull();

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

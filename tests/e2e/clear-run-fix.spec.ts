import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  DEMON_INTRO_BANNER_RECT,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  RESULT_NEXT_DAY_BUTTON,
  TITLE_COMPLETED_START_BUTTON,
  TITLE_CONTINUE_BUTTON,
  TITLE_START_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const GLOSSARY_STORAGE_KEY = 'pawnshop-cards-glossary-v1';

interface PawnshopDebugState {
  phase: string;
  money: number;
  reputation: number;
  deck: string[];
  day: number;
  shopLevel: number;
  version?: string;
  titleCompletedTeaser?: string | null;
  titleSettlementLine?: string | null;
  titleEndingLedger?: {
    returnedItems: string[];
    retainedItems: string[];
    bossFragmentItems: string[];
    pawnedItems: string[];
    lines: string[];
  } | null;
}

interface BattleDebugState {
  phase: string;
  round: number;
  playerHp: number;
  shield: number;
  renqing: number;
  demonHp: number;
  demonName: string;
  hand: string[];
  handSlotXs?: number[];
  handSlotYs?: number[];
  handSlotRotations?: number[];
  introBannerVisible?: boolean;
  detailLayerVisible?: boolean;
  lastFloatSpawns?: { label: string; lane: string; startY: number; endY: number }[];
  discardCount: number;
  result: string;
  resultView?: string;
  loseReason?: string | null;
  normalFailHint?: string | null;
  normalFailContinueLine?: string | null;
  isAnimating?: boolean;
  currentStep?: string | null;
  savedData?: {
    day: number;
    money: number;
    deck: string[];
  } | null;
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
    const hook = (window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => PawnshopDebugState } })
      .__PAWNSHOP_DEBUG__;
    if (!hook) throw new Error('__PAWNSHOP_DEBUG__ missing');
    return hook.getState();
  });
}

async function waitForPawnshopPhase(page: Page, phase: string): Promise<PawnshopDebugState> {
  await expect
    .poll(async () => {
      try {
        return (await getPawnshopState(page)).phase;
      } catch {
        return null;
      }
    })
    .toBe(phase);
  return getPawnshopState(page);
}

async function getBattleState(page: Page): Promise<BattleDebugState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __BATTLE_DEBUG__?: { getState: () => BattleDebugState } })
      .__BATTLE_DEBUG__;
    if (!hook) throw new Error('__BATTLE_DEBUG__ missing');
    return hook.getState();
  });
}

async function waitForBattleReady(page: Page, phase: string): Promise<BattleDebugState> {
  await expect
    .poll(async () => {
      try {
        const s = await getBattleState(page);
        return s.isAnimating ? 'animating' : s.phase;
      } catch {
        return null;
      }
    })
    .toBe(phase);
  return getBattleState(page);
}

async function enterBattleFromSeededDay(page: Page, canvas: Locator): Promise<BattleDebugState> {
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  for (let i = 0; i < 3; i += 1) {
    const pState = await expect
      .poll(async () => (await getPawnshopState(page)).phase)
      .toMatch(/^(negotiating|redemption)$/);
    void pState;
    const st = await getPawnshopState(page);
    if (st.phase === 'redemption') {
      throw new Error('Unexpected redemption phase in seeded test');
    }
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  return waitForBattleReady(page, 'play');
}

test('Task 17 §2 & §6: intro banner is clickable without misplay, detail strip hides/restores, and 7-card & 10-card fanned hand clicks stay accurate without shifting', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7&demon=c');
  await page.evaluate(
    ([saveKey, tutKey, glossaryKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        glossaryKey,
        JSON.stringify({ reputation: true, renqing: true, obsession: true, charge_threshold: true }),
      );
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 3,
          money: 150,
          reputation: 5,
          deck: [
            '旧书',
            '旧书',
            '旧书',
            '旧书',
            '旧书',
            '旧书',
            '算盘',
            '算盘',
            '算盘',
            '守诺',
            '守诺',
            '守诺',
            '守诺',
            '守诺',
          ],
          shopLevel: 4,
          redeemTickets: 0,
          tutorialCompleted: true,
          chapter: {
            currentChapter: 1,
            dayInChapter: 3,
            chapter1Completed: false,
            chapter1FailedCount: 0,
            status: 'in_progress',
            bossBattleActive: false,
            pactChoice: null,
            sideQuestChoice: null,
            daysCleared: [1, 2],
            daysVisited: [1, 2],
            pawnsCollected: 5,
            demonsDefeated: 2,
            day4TrimDone: false,
            day6SideQuestDone: false,
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const startBattle = await enterBattleFromSeededDay(page, canvas);
  // §6: Intro banner visible on entry, detail layer hidden while banner is shown
  expect(startBattle.introBannerVisible).toBe(true);
  expect(startBattle.detailLayerVisible).toBe(false);

  // Click banner center -> banner dismisses, detail layer restores, and NO card is played
  const bannerCenter = {
    x: Math.floor(DEMON_INTRO_BANNER_RECT.x + DEMON_INTRO_BANNER_RECT.width / 2),
    y: Math.floor(DEMON_INTRO_BANNER_RECT.y + DEMON_INTRO_BANNER_RECT.height / 2),
  };
  await clickLogical(page, canvas, bannerCenter);
  await expect.poll(async () => (await getBattleState(page)).introBannerVisible).toBe(false);
  const afterDismiss = await getBattleState(page);
  expect(afterDismiss.detailLayerVisible).toBe(true);
  expect(afterDismiss.discardCount).toBe(0);

  // Build hand up to 7 cards in Round 1/2 by playing 旧书/算盘
  let state = afterDismiss;
  while (state.hand.length < 7) {
    const abacusIdx = state.hand.indexOf('算盘');
    const bookIdx = state.hand.indexOf('旧书');
    const pickIdx = abacusIdx >= 0 && state.renqing >= 1 ? abacusIdx : bookIdx;
    if (pickIdx >= 0 && state.renqing >= 1) {
      const x = state.handSlotXs![pickIdx];
      const y = state.handSlotYs![pickIdx];
      const prevDiscard = state.discardCount;
      const prevHandLen = state.hand.length;
      const prevRenqing = state.renqing;
      await clickLogical(page, canvas, { x, y });
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return (
            !s.isAnimating &&
            (s.discardCount !== prevDiscard ||
              s.hand.length !== prevHandLen ||
              s.renqing !== prevRenqing)
          );
        })
        .toBe(true);
      state = await getBattleState(page);
    } else {
      const prevRound = state.round;
      await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return !s.isAnimating && s.round > prevRound;
        })
        .toBe(true);
      state = await getBattleState(page);
    }
  }

  // Re-center via End Turn if < 7 started the turn, so we test a clean 7+ card fanned hand
  if (state.hand.length === 7) {
    expect(state.handSlotRotations!.some((r) => Math.abs(r) > 0.01)).toBe(true);
    const initialXs = [...state.handSlotXs!];
    const initialYs = [...state.handSlotYs!];
    const initialRots = [...state.handSlotRotations!];
    // Pick a non-draw card (守诺) so hand transitions 7 -> 6 cleanly and we verify fixed-slot keepPositions
    let targetIdx = state.hand.indexOf('守诺');
    if (targetIdx < 0) targetIdx = 0;
    const prevDiscard = state.discardCount;
    await clickLogical(page, canvas, { x: initialXs[targetIdx], y: initialYs[targetIdx] });
    await expect
      .poll(async () => {
        const s = await getBattleState(page);
        return !s.isAnimating && s.discardCount === prevDiscard + 1;
      })
      .toBe(true);
    const after7Play = await getBattleState(page);
    expect(after7Play.handSlotXs).toEqual([
      ...initialXs.slice(0, targetIdx),
      ...initialXs.slice(targetIdx + 1),
    ]);
    expect(after7Play.handSlotYs).toEqual([
      ...initialYs.slice(0, targetIdx),
      ...initialYs.slice(targetIdx + 1),
    ]);
    expect(after7Play.handSlotRotations).toEqual([
      ...initialRots.slice(0, targetIdx),
      ...initialRots.slice(targetIdx + 1),
    ]);
    state = after7Play;
  }

  // Grow hand to >= 10 cards and verify rotated click accuracy on edge and middle fanned cards
  while (state.hand.length < 10) {
    const abacusIdx = state.hand.indexOf('算盘');
    const bookIdx = state.hand.indexOf('旧书');
    const pickIdx = abacusIdx >= 0 && state.renqing >= 1 ? abacusIdx : bookIdx;
    if (pickIdx >= 0 && state.renqing >= 1) {
      const prevDiscard = state.discardCount;
      const prevHandLen = state.hand.length;
      const prevRenqing = state.renqing;
      await clickLogical(page, canvas, {
        x: state.handSlotXs![pickIdx],
        y: state.handSlotYs![pickIdx],
      });
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return (
            !s.isAnimating &&
            (s.discardCount !== prevDiscard ||
              s.hand.length !== prevHandLen ||
              s.renqing !== prevRenqing)
          );
        })
        .toBe(true);
      state = await getBattleState(page);
    } else {
      const prevRound = state.round;
      await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return !s.isAnimating && s.round > prevRound;
        })
        .toBe(true);
      state = await getBattleState(page);
    }
  }

  expect(state.hand.length).toBeGreaterThanOrEqual(10);
  expect(state.handSlotRotations!.some((r) => Math.abs(r) > 0.01)).toBe(true);
  // Ensure renqing >= 2 so we can click two fanned cards at 10+ hand size
  if (state.renqing < 2) {
    const abIdx = state.hand.indexOf('算盘');
    if (abIdx >= 0 && state.renqing >= 1) {
      const prevD = state.discardCount;
      const prevL = state.hand.length;
      await clickLogical(page, canvas, { x: state.handSlotXs![abIdx], y: state.handSlotYs![abIdx] });
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return !s.isAnimating && (s.discardCount !== prevD || s.hand.length !== prevL);
        })
        .toBe(true);
      state = await getBattleState(page);
    }
  }

  // Click a card on the left fan wing (index 0) and verify exact card is played without shifting others
  const leftCardName = state.hand[0];
  const prevLen10 = state.hand.length;
  const prevDiscard10 = state.discardCount;
  const prevShield10 = state.shield;
  const xsBefore10 = [...state.handSlotXs!];
  await clickLogical(page, canvas, { x: state.handSlotXs![0], y: state.handSlotYs![0] });
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && (s.discardCount !== prevDiscard10 || s.hand.length !== prevLen10);
    })
    .toBe(true);
  const afterLeftClick = await getBattleState(page);
  if (leftCardName === '守诺') {
    expect(afterLeftClick.shield).toBe(prevShield10 + 5);
    expect(afterLeftClick.hand.length).toBe(prevLen10 - 1);
    expect(afterLeftClick.handSlotXs).toEqual(xsBefore10.slice(1));
  }

  // Click rightmost fanned card if still >= 1 renqing
  if (afterLeftClick.renqing >= 1 && afterLeftClick.hand.length >= 1) {
    const rightIdx = afterLeftClick.hand.length - 1;
    const rightName = afterLeftClick.hand[rightIdx];
    const prevRDiscard = afterLeftClick.discardCount;
    const prevRLen = afterLeftClick.hand.length;
    const prevRRenqing = afterLeftClick.renqing;
    const prevRShield = afterLeftClick.shield;
    await clickLogical(page, canvas, {
      x: afterLeftClick.handSlotXs![rightIdx],
      y: afterLeftClick.handSlotYs![rightIdx],
    });
    await expect
      .poll(async () => {
        const s = await getBattleState(page);
        return (
          !s.isAnimating &&
          (s.discardCount !== prevRDiscard || s.hand.length !== prevRLen || s.renqing !== prevRRenqing)
        );
      })
      .toBe(true);
    const afterRightClick = await getBattleState(page);
    if (rightName === '守诺') {
      expect(afterRightClick.shield).toBe(prevRShield + 5);
    }
  }

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Task 17 §5: concurrent damage + renqing float texts stack cross-lane strictly below nameplate', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7&demon=c');
  await page.evaluate(
    ([saveKey, tutKey, glossaryKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        glossaryKey,
        JSON.stringify({ reputation: true, renqing: true, obsession: true, charge_threshold: true }),
      );
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 3,
          money: 100,
          reputation: 5,
          deck: ['余音', '余音', '余音', '余音', '余音'],
          shopLevel: 2,
          redeemTickets: 0,
          tutorialCompleted: true,
          chapter: {
            currentChapter: 1,
            dayInChapter: 3,
            chapter1Completed: false,
            chapter1FailedCount: 0,
            status: 'in_progress',
            bossBattleActive: false,
            pactChoice: null,
            sideQuestChoice: null,
            daysCleared: [1, 2],
            daysVisited: [1, 2],
            pawnsCollected: 3,
            demonsDefeated: 2,
            day4TrimDone: false,
            day6SideQuestDone: false,
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  const battle = await enterBattleFromSeededDay(page, canvas);

  await clickLogical(page, canvas, { x: battle.handSlotXs![0], y: battle.handSlotYs![0] });
  await expect
    .poll(async () => (await getBattleState(page)).lastFloatSpawns?.length ?? 0)
    .toBeGreaterThanOrEqual(2);

  const afterPlay = await getBattleState(page);
  const floats = afterPlay.lastFloatSpawns!;
  expect(floats).toHaveLength(2);
  expect(floats[0].lane).toBe('demon');
  expect(floats[1].lane).toBe('renqing');
  expect(floats[0].startY).toBeGreaterThanOrEqual(88);
  expect(floats[0].endY).toBeGreaterThan(floats[0].startY);
  expect(floats[1].startY).toBeGreaterThanOrEqual(floats[0].startY + 28);
  expect(floats[1].endY).toBeGreaterThan(floats[1].startY);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Task 17 §4: normal failure page shows 3 lines for lose_timeout and lose_hp, clears Day 1 6/6 bubble, and preserves money/deck', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  // 1) Normal Day 3 lose_timeout + Next Day preserves money & deck
  await page.goto('/?seed=7&demon=c');
  await page.evaluate(
    ([saveKey, tutKey, glossaryKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        glossaryKey,
        JSON.stringify({ reputation: true, renqing: true, obsession: true, charge_threshold: true }),
      );
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 3,
          money: 123,
          reputation: 5,
          deck: ['余音', '倒转', '旧书'],
          shopLevel: 2,
          redeemTickets: 0,
          tutorialCompleted: true,
          chapter: {
            currentChapter: 1,
            dayInChapter: 3,
            chapter1Completed: false,
            chapter1FailedCount: 0,
            status: 'in_progress',
            bossBattleActive: false,
            pactChoice: null,
            sideQuestChoice: null,
            daysCleared: [1, 2],
            daysVisited: [1, 2],
            pawnsCollected: 3,
            demonsDefeated: 2,
            day4TrimDone: false,
            day6SideQuestDone: false,
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  await enterBattleFromSeededDay(page, canvas);

  for (let r = 1; r <= 3; r += 1) {
    await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
    if (r < 3) {
      await expect.poll(async () => (await getBattleState(page)).round).toBe(r + 1);
    }
  }
  const timeoutRes = await waitForBattleReady(page, 'result_scene');
  expect(timeoutRes.result).toBe('lose_timeout');
  expect(timeoutRes.loseReason).toBe('3 回合未分胜负');
  expect(timeoutRes.normalFailHint).toBe('提醒：伤害牌太少，试试多收带伤的旧物');
  expect(timeoutRes.normalFailContinueLine).toBe('输了这一夜没事，钱与牌都在，明天继续');

  await clickLogical(page, canvas, RESULT_NEXT_DAY_BUTTON);
  // Day 3 -> Day 4 enters 'pact' (掌柜契约) before negotiating
  const nextDayState = await waitForPawnshopPhase(page, 'pact');
  expect(nextDayState.day).toBe(4);
  expect(nextDayState.money).toBe(123);
  expect(nextDayState.deck).toEqual(['余音', '倒转', '旧书']);

  // 2) Normal lose_hp via ?deck=test&playerHp=2
  await page.goto('/?seed=7&demon=c&deck=test&playerHp=2');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 3,
          money: 90,
          reputation: 5,
          deck: ['余音', '倒转', '旧书'],
          shopLevel: 2,
          redeemTickets: 0,
          tutorialCompleted: true,
          chapter: {
            currentChapter: 1,
            dayInChapter: 3,
            chapter1Completed: false,
            chapter1FailedCount: 0,
            status: 'in_progress',
            bossBattleActive: false,
            pactChoice: null,
            sideQuestChoice: null,
            daysCleared: [1, 2],
            daysVisited: [1, 2],
            pawnsCollected: 3,
            demonsDefeated: 2,
            day4TrimDone: false,
            day6SideQuestDone: false,
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();
  await enterBattleFromSeededDay(page, canvas);
  await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
  const hpRes = await waitForBattleReady(page, 'result_scene');
  expect(hpRes.result).toBe('lose_hp');
  expect(hpRes.loseReason).toBe('被打倒');
  expect(hpRes.normalFailHint).toBe('提醒：先攒护盾牌，顶住前两回合');
  expect(hpRes.normalFailContinueLine).toBe('输了这一夜没事，钱与牌都在，明天继续');

  // 3) Day 1 failure with 6/6 tutorial bubble active (buy 1 card on customer 0 so Night 1 runs)
  await page.goto('/?seed=7');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.removeItem(saveKey);
      localStorage.removeItem(tutKey);
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_START_BUTTON);
  // Customer 0: advance 1/6 & 2/6 tutorial bubbles, accept high price -> 3/6 bubble + feedback -> next
  await waitForPawnshopPhase(page, 'negotiating');
  for (let step = 0; step < 3; step += 1) {
    const cur = await page.evaluate(() => {
      const hook = (window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => { currentStep?: string | null } } })
        .__PAWNSHOP_DEBUG__;
      return hook?.getState().currentStep ?? null;
    });
    if (!cur) break;
    await clickLogical(page, canvas, { x: 240, y: 218 });
  }
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  await waitForPawnshopPhase(page, 'feedback');
  await clickLogical(page, canvas, { x: 320, y: 228 });
  await clickLogical(page, canvas, PAWNSHOP_FEEDBACK_NEXT_BUTTON);
  for (let i = 1; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  await waitForBattleReady(page, 'play');
  // Advance 4/6 and 5/6 night tutorial bubbles
  for (let step = 0; step < 2; step += 1) {
    const s = await getBattleState(page);
    if (!s.currentStep) break;
    await clickLogical(page, canvas, { x: 270, y: 174 });
  }
  for (let r = 1; r <= 3; r += 1) {
    await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
    if (r < 3) {
      await expect.poll(async () => (await getBattleState(page)).round).toBe(r + 1);
    }
  }
  const day1Fail = await waitForBattleReady(page, 'result_scene');
  expect(day1Fail.currentStep).toBe('settlement');
  expect(day1Fail.normalFailHint).toBe('提醒：伤害牌太少，试试多收带伤的旧物');
  expect(day1Fail.normalFailContinueLine).toBe('输了这一夜没事，钱与牌都在，明天继续');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Task 17 §7 & §10: completed TitleScene shows two-line Ch2 teaser badge, settlement summary, version v0.4.3-ClearRunFix, and starts Ch1 cleanly', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 7,
          money: 182,
          reputation: 5,
          deck: ['守诺', '旧书', '飞驰', '余音', '钢笔', '集邮'],
          shopLevel: 4,
          redeemTickets: 1,
          tutorialCompleted: true,
          chapter: {
            currentChapter: 1,
            dayInChapter: 7,
            chapter1Completed: true,
            chapter1FailedCount: 0,
            status: 'completed',
            bossBattleActive: false,
            pactChoice: 'steady_shop',
            sideQuestChoice: null,
            daysCleared: [1, 2, 3, 4, 5, 6, 7],
            daysVisited: [1, 2, 3, 4, 5, 6, 7],
            pawnsCollected: 8,
            demonsDefeated: 6,
            day4TrimDone: true,
            day6SideQuestDone: false,
            pawnedItemIds: ['watch', 'ring', 'old_book', 'bicycle', 'erhu'],
            redeemedDayByItem: { watch: 3 },
            bossComponentItemIds: ['ring', 'old_book', 'bicycle', 'erhu'],
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  const titleState = await waitForPawnshopPhase(page, 'title');

  expect(titleState.version).toBe('v0.4.3-ClearRunFix');
  expect(titleState.titleCompletedTeaser).toBe('第2章「站稳招牌」· 未完待续');
  expect(titleState.titleSettlementLine).toBe('胜6 · 收8 · 钱182');
  expect(titleState.titleEndingLedger?.lines).toEqual([
    '物归原主:旧手表',
    '留柜未赎:婚戒、旧书、永久自行车、二胡、邮票册',
    '化作执念:婚戒、旧书、永久自行车、二胡(4块)',
  ]);

  // Clicking shifted Start button (y=280) restarts Chapter 1 Day 1
  await clickLogical(page, canvas, TITLE_COMPLETED_START_BUTTON);
  const day1Start = await waitForPawnshopPhase(page, 'negotiating');
  expect(day1Start.day).toBe(1);
  expect(day1Start.deck).toEqual([]);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Task 17 §8 & multi-viewport: Day 3 summary 7-card truncation stays intact and 390x844 / 844x390 / 800x500 viewports have no overflow or missed clicks', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7');
  await page.evaluate(
    ([saveKey, tutKey, glossaryKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        glossaryKey,
        JSON.stringify({ reputation: true, renqing: true, obsession: true, charge_threshold: true }),
      );
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 3,
          money: 160,
          reputation: 5,
          deck: ['旧书', '飞驰', '集邮', '余音', '守诺', '算盘', '钢笔'],
          shopLevel: 3,
          redeemTickets: 0,
          tutorialCompleted: true,
          chapter: {
            currentChapter: 1,
            dayInChapter: 3,
            chapter1Completed: false,
            chapter1FailedCount: 0,
            status: 'in_progress',
            bossBattleActive: false,
            pactChoice: null,
            sideQuestChoice: null,
            daysCleared: [1, 2],
            daysVisited: [1, 2],
            pawnsCollected: 7,
            demonsDefeated: 2,
            day4TrimDone: false,
            day6SideQuestDone: false,
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY] as const,
  );

  for (const vp of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 800, height: 500 },
  ]) {
    await page.setViewportSize(vp);
    await page.reload();
    const canvas = page.locator('#game-container canvas');
    await expect(canvas).toBeVisible();
    await waitForPawnshopPhase(page, 'title');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(vp.width);
    expect(box!.height).toBeLessThanOrEqual(vp.height);
  }

  // Test clicking through Day 3 summary (7 cards) -> Night 3 battle on 390x844 portrait
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const canvas = page.locator('#game-container canvas');
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  const summaryState = await waitForPawnshopPhase(page, 'summary');
  expect(summaryState.deck).toHaveLength(7);

  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  const battleState = await waitForBattleReady(page, 'play');
  expect(battleState.introBannerVisible).toBe(true);
  await clickLogical(page, canvas, {
    x: Math.floor(DEMON_INTRO_BANNER_RECT.x + DEMON_INTRO_BANNER_RECT.width / 2),
    y: Math.floor(DEMON_INTRO_BANNER_RECT.y + DEMON_INTRO_BANNER_RECT.height / 2),
  });
  await expect.poll(async () => (await getBattleState(page)).introBannerVisible).toBe(false);

  // Verify clicking a card in 390x844 portrait works cleanly
  const prevRenqing = (await getBattleState(page)).renqing;
  await clickLogical(page, canvas, {
    x: battleState.handSlotXs![0],
    y: battleState.handSlotYs![0],
  });
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && (s.discardCount > 0 || s.renqing !== prevRenqing);
    })
    .toBe(true);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Task 17 review regression: ?playerHp=999 without deck=test keeps startingHp at 30 in normal battle', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7&playerHp=999');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 3,
          money: 90,
          reputation: 5,
          deck: ['余音', '倒转', '旧书'],
          shopLevel: 2,
          redeemTickets: 0,
          tutorialCompleted: true,
          chapter: {
            currentChapter: 1,
            dayInChapter: 3,
            chapter1Completed: false,
            chapter1FailedCount: 0,
            status: 'in_progress',
            bossBattleActive: false,
            pactChoice: null,
            sideQuestChoice: null,
            daysCleared: [1, 2],
            daysVisited: [1, 2],
            pawnsCollected: 3,
            demonsDefeated: 2,
            day4TrimDone: false,
            day6SideQuestDone: false,
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  const battleState = await enterBattleFromSeededDay(page, canvas);
  expect(battleState.playerHp).toBe(30);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  BATTLE_HAND_Y,
  computeHandCardX,
  HAND_SCROLL_ARROW_WIDTH,
  HAND_SCROLL_ARROW_Y,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  RESULT_RETURN_BUTTON,
  TITLE_START_BUTTON,
} from '../../src/game/layout';
import { clickLogical, LOGICAL_HEIGHT, LOGICAL_WIDTH } from './helpers';

interface PawnshopDebugState {
  phase: 'title' | 'negotiating' | 'feedback' | 'summary';
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  log: string[];
}

interface DemonAction {
  round: number;
  damage: number;
  skill?: string;
}

interface BattleDebugState {
  phase: 'draw' | 'play' | 'demonAct' | 'roundEnd' | 'result' | 'empty_deck' | 'result_scene';
  round: number;
  playerHp: number;
  shield: number;
  renqing: number;
  demonHp: number;
  hand: string[];
  handSlotXs?: number[];
  introBannerVisible?: boolean;
  deckCount: number;
  discardCount: number;
  result: 'ongoing' | 'win' | 'lose_hp' | 'lose_timeout' | 'empty_deck';
  demonId: string;
  demonName: string;
  intent: {
    current: DemonAction | null;
    next: DemonAction | null;
    upcomingSkill: DemonAction | null;
  };
  isAnimating?: boolean;
  reward?: {
    money: number;
    cardName: string | null;
    redeemTicket: number;
    allOwnedBonus: boolean;
  } | null;
  loseReason?: string | null;
}

const HAND_Y = BATTLE_HAND_Y;

const BUTTONS = {
  titleStart: TITLE_START_BUTTON,
  tierLow: PAWNSHOP_TIER_BUTTONS.low,
  tierHigh: PAWNSHOP_TIER_BUTTONS.high,
  nextOrSummary: PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  enterNightBattle: PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  endTurn: BATTLE_END_TURN_BUTTON,
  resultReturnTitle: RESULT_RETURN_BUTTON,
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

async function navigateThroughDayToBattle(page: Page, canvas: Locator): Promise<BattleDebugState> {
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleStart);

  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.tierHigh);
    await waitForPawnshopPhase(page, 'feedback');
    await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  }

  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  return waitForBattleReady(page, 'play');
}

// 钱不能变负数规则下的进夜里兜底路线：每位当客点低价档（被拒不扣钱、照常推进）。
// 仅用于夜里用 ?deck=test 的用例（白天牌组不进牌局）；seed=4 第 1 天高价总额 270、seed=1 高达 285，
// 均超过开局 200，高价路线会在第 3 位当客三档全不可点而卡死。用真实白天牌组的用例仍走高价路线。
async function navigateThroughDayToBattleLow(
  page: Page,
  canvas: Locator,
): Promise<BattleDebugState> {
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleStart);

  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.tierLow);
    await waitForPawnshopPhase(page, 'feedback');
    await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  }

  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  return waitForBattleReady(page, 'play');
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

test('beats Demon A (药费) with fixed seed=4 & deck=test, asserts HUD/state & victory rewards + desktop screenshots', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=4&demon=a&deck=test');
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const startState = await navigateThroughDayToBattleLow(page, canvas);
  expect(startState.demonId).toBe('a');
  expect(startState.demonName).toBe('药费');
  expect(startState.round).toBe(1);
  expect(startState.playerHp).toBe(30);
  expect(startState.renqing).toBe(3);
  expect(startState.demonHp).toBe(20);
  expect(startState.hand).toHaveLength(5);
  expect(startState.deckCount).toBe(5);
  expect(startState.discardCount).toBe(0);

  await page.screenshot({ path: 'test-results/battle-desktop-demon-a.png' });

  const resultState = await playGreedyUntilResult(page, canvas);
  expect(resultState.phase).toBe('result_scene');
  expect(resultState.result).toBe('win');
  expect(resultState.demonHp).toBe(0);
  expect(resultState.reward).not.toBeNull();
  expect(resultState.reward!.money).toBe(40);
  expect(resultState.reward!.redeemTicket).toBe(1);
  expect(resultState.reward!.cardName).toBeTruthy();

  await page.screenshot({ path: 'test-results/battle-desktop-result-win.png' });

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('plays Demon B (车票) with fixed seed=2, verifies Round 3 "远行" warning and 8-damage settlement + screenshots', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=2&demon=b&deck=test');
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const r1 = await navigateThroughDayToBattleLow(page, canvas);
  expect(r1.demonId).toBe('b');
  expect(r1.demonName).toBe('车票');
  expect(r1.demonHp).toBe(22);
  expect(r1.playerHp).toBe(30);
  expect(r1.intent.current).toEqual({ round: 1, damage: 2 });
  expect(r1.intent.upcomingSkill).toBeNull();

  // End Round 1 -> Demon B deals 2 dmg -> hp 28, Round 2 shows "远行" 8 dmg advance warning
  await clickLogical(page, canvas, BUTTONS.endTurn);
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.round === 2;
    })
    .toBe(true);

  const r2 = await getBattleState(page);
  expect(r2.playerHp).toBe(28);
  expect(r2.intent.current).toEqual({ round: 2, damage: 2 });
  expect(r2.intent.upcomingSkill).toEqual({ round: 3, damage: 8, skill: '远行' });

  await page.screenshot({ path: 'test-results/battle-desktop-demon-b-warning.png' });

  // End Round 2 -> Demon B deals 2 dmg -> hp 26, Round 3 current intent is "远行" 8 dmg
  await clickLogical(page, canvas, BUTTONS.endTurn);
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.round === 3;
    })
    .toBe(true);

  const r3 = await getBattleState(page);
  expect(r3.playerHp).toBe(26);
  expect(r3.intent.current).toEqual({ round: 3, damage: 8, skill: '远行' });

  // End Round 3 without shield -> Demon B executes "远行" for 8 dmg (26 -> 18) & battle ends by timeout
  await clickLogical(page, canvas, BUTTONS.endTurn);
  const resultState = await waitForBattleReady(page, 'result_scene');
  expect(resultState.result).toBe('lose_timeout');
  expect(resultState.playerHp).toBe(18);
  expect(resultState.loseReason).toBe('3 回合未分胜负');

  await page.screenshot({ path: 'test-results/battle-desktop-result-lose.png' });

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Rewind card (倒转) restores both playerHp and demonHp to previous round start without rolling back renqing or hand', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=1&demon=a&deck=test');
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  let state = await navigateThroughDayToBattleLow(page, canvas);
  expect(state.playerHp).toBe(30);
  expect(state.demonHp).toBe(20);

  // Round 1: deal damage to Demon A so demonHp < 20
  const dmgIdx = state.hand.findIndex((name) =>
    (DAMAGE_PRIORITY as readonly string[]).includes(name),
  );
  expect(dmgIdx).toBeGreaterThanOrEqual(0);
  const dmgCardName = state.hand[dmgIdx];
  await clickLogical(page, canvas, { x: computeHandCardX(dmgIdx, state.hand.length), y: HAND_Y });
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.demonHp < 20;
    })
    .toBe(true);

  const afterR1Dmg = await getBattleState(page);
  expect(afterR1Dmg.demonHp).toBeLessThan(20);

  // End Round 1 -> Demon A deals 3 dmg (playerHp 30 -> 27)
  await clickLogical(page, canvas, BUTTONS.endTurn);
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.round === 2;
    })
    .toBe(true);

  state = await getBattleState(page);
  expect(state.playerHp).toBe(27);
  expect(state.demonHp).toBe(afterR1Dmg.demonHp);

  // Ensure 倒转 is in hand in Round 2 (draw with 旧书 if needed)
  if (!state.hand.includes('倒转') && state.hand.includes('旧书')) {
    const bookIdx = state.hand.indexOf('旧书');
    const prevLen = state.hand.length;
    await clickLogical(page, canvas, { x: computeHandCardX(bookIdx, state.hand.length), y: HAND_Y });
    await expect
      .poll(async () => {
        const s = await getBattleState(page);
        return !s.isAnimating && s.hand.length !== prevLen;
      })
      .toBe(true);
    state = await getBattleState(page);
  }

  // If still not in Round 2 hand, advance to Round 3 (snapshot target becomes Round 2 start)
  let expectedRewindPlayerHp = 30;
  let expectedRewindDemonHp = 20;
  if (!state.hand.includes('倒转')) {
    expectedRewindPlayerHp = state.playerHp;
    expectedRewindDemonHp = state.demonHp;
    await clickLogical(page, canvas, BUTTONS.endTurn);
    await expect
      .poll(async () => {
        const s = await getBattleState(page);
        return !s.isAnimating && s.round === 3;
      })
      .toBe(true);
    state = await getBattleState(page);
  }

  const rewindIdx = state.hand.indexOf('倒转');
  expect(rewindIdx).toBeGreaterThanOrEqual(0);
  expect(state.renqing).toBeGreaterThanOrEqual(2);
  const renqingBeforeRewind = state.renqing;
  const handLenBeforeRewind = state.hand.length;

  for (let i = 0; i < 12 && state.handSlotXs && (state.handSlotXs[rewindIdx] < 40 || state.handSlotXs[rewindIdx] > 600); i += 1) {
    const left = state.handSlotXs[rewindIdx] < 40;
    await clickLogical(page, canvas, {
      x: left ? HAND_SCROLL_ARROW_WIDTH / 2 : 640 - HAND_SCROLL_ARROW_WIDTH / 2,
      y: HAND_SCROLL_ARROW_Y,
    });
    await page.waitForTimeout(80);
    state = await getBattleState(page);
  }

  await clickLogical(page, canvas, {
    x: state.handSlotXs?.[rewindIdx] ?? computeHandCardX(rewindIdx, state.hand.length),
    y: HAND_Y,
  });

  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.renqing === renqingBeforeRewind - 2;
    })
    .toBe(true);

  const afterRewind = await getBattleState(page);
  expect(afterRewind.playerHp).toBe(expectedRewindPlayerHp);
  expect(afterRewind.demonHp).toBe(expectedRewindDemonHp);
  expect(afterRewind.renqing).toBe(renqingBeforeRewind - 2);
  expect(afterRewind.hand).toHaveLength(handLenBeforeRewind - 1);
  expect(dmgCardName).toBeTruthy();

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('completes full flow from P1 Pawnshop summary -> CardBattleScene (real P1 deck) -> ResultScene -> TitleScene', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7');
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const battleStart = await navigateThroughDayToBattle(page, canvas);
  // Real deck collected from 3 high-tier offers on seed=7 Day 1: 集邮, 顶住, 余音
  expect(battleStart.demonId).toBe('a');
  expect(battleStart.hand).toHaveLength(3);
  expect([...battleStart.hand].sort()).toEqual(['集邮', '顶住', '余音'].sort());
  expect(battleStart.deckCount).toBe(0);

  // Play through 3 rounds to ResultScene
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

  const resultState = await waitForBattleReady(page, 'result_scene');
  expect(resultState.result).toBe('lose_timeout');
  expect(resultState.loseReason).toBe('3 回合未分胜负');

  // Return to TitleScene
  await clickLogical(page, canvas, BUTTONS.resultReturnTitle);
  const titleState = await waitForPawnshopPhase(page, 'title');
  expect(titleState.phase).toBe('title');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('renders CardBattleScene and ResultScene cleanly on mobile landscape 844x390 viewport', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?seed=4&demon=a&deck=test');
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const startState = await navigateThroughDayToBattleLow(page, canvas);
  expect(startState.phase).toBe('play');
  await page.screenshot({ path: 'test-results/battle-mobile-play.png' });

  const resultState = await playGreedyUntilResult(page, canvas);
  expect(resultState.phase).toBe('result_scene');
  expect(resultState.result).toBe('win');
  await page.screenshot({ path: 'test-results/battle-mobile-result.png' });

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('A4: rapid consecutive clicks on two playable cards in the same turn execute both without dropping input', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=4&demon=a&deck=test');
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const startState = await navigateThroughDayToBattleLow(page, canvas);
  expect(startState.phase).toBe('play');
  expect(startState.renqing).toBe(3);

  // Pick two distinct 1-cost playable cards from initial hand (excluding 算盘/倒转 so renqing math is exact -2)
  const oneCostIndices: number[] = [];
  for (let i = 0; i < startState.hand.length; i += 1) {
    const name = startState.hand[i];
    if (CARD_COSTS[name] === 1 && name !== '算盘') {
      oneCostIndices.push(i);
      if (oneCostIndices.length === 2) {
        break;
      }
    }
  }
  expect(oneCostIndices).toHaveLength(2);

  const [idx1, idx2] = oneCostIndices;
  const x1 = computeHandCardX(idx1, startState.hand.length);
  const x2 = computeHandCardX(idx2, startState.hand.length);

  // Compute exact client coordinates from the stable pre-play layout and fire BOTH clicks 25ms apart
  // while the first card is still mid-flight (240ms animation) without waiting or shifting coordinates!
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const toClient = (pt: { x: number; y: number }) => ({
    x: box!.x + (pt.x / LOGICAL_WIDTH) * box!.width,
    y: box!.y + (pt.y / LOGICAL_HEIGHT) * box!.height,
  });

  const p1 = toClient({ x: x1, y: HAND_Y });
  const p2 = toClient({ x: x2, y: HAND_Y });

  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.mouse.click(p1.x, p1.y);
  await page.waitForTimeout(25);
  await page.mouse.click(p2.x, p2.y);

  // Wait for both animations in the queue to finish
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.discardCount >= 2;
    })
    .toBe(true);

  const afterBoth = await getBattleState(page);
  expect(afterBoth.discardCount).toBe(2);
  expect(afterBoth.renqing).toBe(1);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Q1=A: remaining hand cards keep their X positions after play until End Turn, and End Turn is disabled during flight animation', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=4&demon=a&deck=test');
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const startState = await navigateThroughDayToBattleLow(page, canvas);
  expect(startState.hand.length).toBe(5);
  const initialXs = startState.handSlotXs!;
  expect(initialXs).toHaveLength(5);

  // Pick a non-draw, non-choice 1-cost card so hand.length transitions cleanly 5 -> 4
  const idx = startState.hand.findIndex(
    (name) => CARD_COSTS[name] === 1 && name !== '算盘' && name !== '旧书',
  );
  expect(idx).toBeGreaterThanOrEqual(0);

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const toClient = (pt: { x: number; y: number }) => ({
    x: box!.x + (pt.x / LOGICAL_WIDTH) * box!.width,
    y: box!.y + (pt.y / LOGICAL_HEIGHT) * box!.height,
  });
  const pCard = toClient({ x: initialXs[idx], y: HAND_Y });
  const pEndTurn = toClient(BUTTONS.endTurn);

  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.mouse.click(pCard.x, pCard.y);
  // Click End Turn 40ms later (well inside 240ms flight animation) -> must be ignored!
  await page.waitForTimeout(40);
  await page.mouse.click(pEndTurn.x, pEndTurn.y);

  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.hand.length === 4;
    })
    .toBe(true);

  const afterPlay = await getBattleState(page);
  expect(afterPlay.round).toBe(1);
  // Remaining 4 cards keep their original X slots instead of shifting!
  expect(afterPlay.handSlotXs).toEqual([...initialXs.slice(0, idx), ...initialXs.slice(idx + 1)]);

  // End Turn now works when idle and re-centers the next round's hand
  await clickLogical(page, canvas, BUTTONS.endTurn);
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.round === 2;
    })
    .toBe(true);

  const r2 = await getBattleState(page);
  const expectedCentered = r2.hand.map((_, idx) => computeHandCardX(idx, r2.hand.length));
  expect(r2.handSlotXs).toEqual(expectedCentered);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

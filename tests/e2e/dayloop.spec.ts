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
  tierLow: { x: 58, y: 151 },
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
  expect(day1Start.money).toBe(200);
  expect(day1Start.shopLevel).toBe(1);
  expect(day1Start.maxRenqing).toBe(3);
  expect(day1Start.itemsOrder).toEqual(['old_book', 'erhu', 'stamp_album']);
  await page.screenshot({ path: 'test-results/dayloop-desktop-day1.png' });

  // Buy all 3 items at High tier (30 + 75 + 45 = 150 -> money 50, rep +3, deck 3 cards; money never negative)
  const day1Summary = await completeDayPawnshopHigh(page, canvas);
  expect(day1Summary.money).toBe(50);
  expect(day1Summary.money).toBeGreaterThanOrEqual(0);
  expect(day1Summary.reputation).toBe(3);
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

  // Win Night 1 -> ResultScene auto-saves Day 2, shopLevel 2, +20 money, +1 reward card, +1 redeemTicket
  const winResult = await playGreedyUntilResult(page, canvas);
  expect(winResult.result).toBe('win');
  expect(winResult.savedData).not.toBeNull();
  expect(winResult.savedData!.version).toBe(1);
  expect(winResult.savedData!.day).toBe(2);
  expect(winResult.savedData!.shopLevel).toBe(2);
  expect(winResult.savedData!.money).toBe(70); // 50 + 20 winRewardMoney
  expect(winResult.savedData!.money).toBeGreaterThanOrEqual(0);
  expect(winResult.savedData!.redeemTickets).toBe(1);
  expect(winResult.savedData!.deck).toHaveLength(4);
  expect(winResult.savedData!.deck[3]).toBe(winResult.reward!.cardName);
  await page.screenshot({ path: 'test-results/dayloop-desktop-result.png' });

  // Click "下一天" -> Day 2 PawnshopScene (day=2, money=70, shopLevel=2, maxRenqing=4, Day 2 shuffle top-3)
  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  const day2 = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2.day).toBe(2);
  expect(day2.money).toBe(70);
  expect(day2.reputation).toBe(3);
  expect(day2.shopLevel).toBe(2);
  expect(day2.maxRenqing).toBe(4);
  expect(day2.deck).toEqual(winResult.savedData!.deck);
  expect(day2.itemsOrder).toEqual(['erhu', 'watch', 'stamp_album']);
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
  expect(restoredDay2.money).toBe(70);
  expect(restoredDay2.shopLevel).toBe(2);
  expect(restoredDay2.maxRenqing).toBe(4);
  expect(restoredDay2.deck).toEqual(winResult.savedData!.deck);
  // 首位当客二胡（真值 50）：低 25 / 平 50 买得起、高 75 买不起
  expect(restoredDay2.tierAffordability).toEqual({ low: true, fair: true, high: false });

  // Day 2 pawnshop via Low tier: 钱 70 时三档低价 25/20/15 全程可点；
  // seed=2 确定性 RNG（每场景 fresh）：二胡低价拒（roll 0.7343 ≥ 0.3）、手表低价拒（0.3250 ≥ 0.3）、
  // 邮票册低价收（0.2853 < 0.3，-15）-> money 55，rep 3 - 1 = 2，牌组 +1 张集邮
  const day2Summary = await completeDayPawnshopLow(page, canvas);
  expect(day2Summary.money).toBe(55);
  expect(day2Summary.money).toBeGreaterThanOrEqual(0);
  expect(day2Summary.reputation).toBe(2);
  expect(day2Summary.deck).toHaveLength(5);
  expect(day2Summary.deck[4]).toBe('集邮');

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
  // seed=7 第 1 天高价 75 + 60 + 30 = 165，逐步 75 ≤ 200、60 ≤ 125、30 ≤ 65，全程可买，新规则下不受影响
  const day1Summary = await completeDayPawnshopHigh(page, canvas);
  expect(day1Summary.money).toBe(35);
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
  expect(loseResult.savedData).toEqual({
    version: 1,
    day: 2,
    money: 35,
    reputation: 3,
    deck: ['余音', '倒转', '旧书'],
    shopLevel: 1,
    redeemTickets: 0,
  });

  // Click "下一天" -> Day 2 starts with unchanged deck/money/level (maxRenqing still 3)
  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  const day2AfterLose = await waitForPawnshopPhase(page, 'negotiating');
  expect(day2AfterLose.day).toBe(2);
  expect(day2AfterLose.money).toBe(35);
  expect(day2AfterLose.shopLevel).toBe(1);
  expect(day2AfterLose.maxRenqing).toBe(3);
  expect(day2AfterLose.deck).toEqual(['余音', '倒转', '旧书']);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('renders pixel font, 32x32 pixel art, and day loop cleanly on mobile portrait 390x844 viewport', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.setViewportSize({ width: 390, height: 844 });
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

  // seed=2 第 1 天高价 30 + 75 + 45 = 150 -> money 50（原 seed=4 高价 270 会在第 3 位当客卡死，见主流程注释）
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

  // Day 3 Pawnshop: 6-item pool shuffled and sliced to 3 customers; seed=4 day=3 has erhu (二胡) first!
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  const day3Start = await waitForPawnshopPhase(page, 'negotiating');
  expect(day3Start.day).toBe(3);
  expect(day3Start.itemsOrder).toHaveLength(3);
  expect(day3Start.itemsOrder).toContain('erhu');
  await page.screenshot({ path: 'test-results/p4-day3-erhu.png' });

  // 钱不能变负数规则下不用高价路线：seed=4 第 3 天高价 75 + 90 + 60 = 225 > 200，
  // 前两档高价收下后只剩 35，第 3 位当客手表低价 20 是唯一可点档且确定性 RNG 首抽 0.9236 拒收；
  // 到第 4 天（手表/自行车/二胡）第 2 位自行车低价 40 > 35，三档全不可点、流程卡死（无跳过按钮）。
  // 故第 3/4/5 天改走低价路线；每场景 RNG 都是 fresh mulberry32(4)，三抽固定为拒（0.9236）/ 拒（0.3330）/ 收（0.2217）。
  // Day 3（erhu, ring, watch）：低价拒、拒、收（手表 -20）-> money 180，rep 2 - 1 = 1，牌组 +倒转
  const day3Summary = await completeDayPawnshopLow(page, canvas);
  expect(day3Summary.money).toBe(180);
  expect(day3Summary.money).toBeGreaterThanOrEqual(0);
  expect(day3Summary.reputation).toBe(1);
  expect(day3Summary.log.some((entry) => entry.includes('二胡'))).toBe(true);
  expect(day3Summary.deck).toEqual(['倒转', '守诺', '旧书', '倒转']);

  // Night 3 -> Demon C (房租, HP 22)
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  const night3 = await waitForBattleReady(page, 'play');
  expect(night3.day).toBe(3);
  expect(night3.demonId).toBe('c');
  expect(night3.demonName).toBe('房租');
  expect(night3.demonHp).toBe(22);
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
  expect(night3Result.savedData!.money).toBe(180);

  // Day 4 Pawnshop -> Night 4 -> Demon D (学费, HP 16, Round 3 skill "开学" 10 dmg)
  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  const day4Start = await waitForPawnshopPhase(page, 'negotiating');
  expect(day4Start.day).toBe(4);
  expect(day4Start.money).toBe(180);
  expect(day4Start.reputation).toBe(1);
  expect(day4Start.itemsOrder).toHaveLength(3);
  expect(day4Start.itemsOrder).toEqual(['watch', 'bicycle', 'erhu']);
  // Day 4 低价路线（手表/自行车/二胡）：低价拒、拒、收（二胡 -25）-> money 155，rep 1 - 1 = 0，牌组 +余音
  const day4Summary = await completeDayPawnshopLow(page, canvas);
  expect(day4Summary.money).toBe(155);
  expect(day4Summary.money).toBeGreaterThanOrEqual(0);
  expect(day4Summary.reputation).toBe(0);
  expect(day4Summary.deck).toEqual(['倒转', '守诺', '旧书', '倒转', '余音']);
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  const night4 = await waitForBattleReady(page, 'play');
  expect(night4.day).toBe(4);
  expect(night4.demonId).toBe('d');
  expect(night4.demonName).toBe('学费');
  expect(night4.demonHp).toBe(16);
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
  expect(night4Result.savedData!.money).toBe(155);

  // Day 5 Pawnshop -> Night 5 -> loops back to Demon A (药费)
  await clickLogical(page, canvas, BUTTONS.resultNextDay);
  const day5Start = await waitForPawnshopPhase(page, 'negotiating');
  expect(day5Start.day).toBe(5);
  expect(day5Start.money).toBe(155);
  expect(day5Start.reputation).toBe(0);
  expect(day5Start.itemsOrder).toHaveLength(3);
  expect(day5Start.itemsOrder).toEqual(['erhu', 'ring', 'old_book']);
  // Day 5 低价路线（二胡/婚戒/旧书）：低价拒、拒、收（旧书 -10）-> money 145，rep 0 - 1 = -1，牌组 +旧书
  const day5Summary = await completeDayPawnshopLow(page, canvas);
  expect(day5Summary.money).toBe(145);
  expect(day5Summary.money).toBeGreaterThanOrEqual(0);
  expect(day5Summary.reputation).toBe(-1);
  expect(day5Summary.deck).toEqual(['倒转', '守诺', '旧书', '倒转', '余音', '旧书']);
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  const night5 = await waitForBattleReady(page, 'play');
  expect(night5.day).toBe(5);
  expect(night5.demonId).toBe('a');
  expect(night5.demonName).toBe('药费');
  expect(night5.demonHp).toBe(20);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

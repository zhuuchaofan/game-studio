import { expect, test, type Locator, type Page } from '@playwright/test';
import { clickLogical, LOGICAL_WIDTH } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';

interface PawnshopDebugState {
  phase:
    | 'title'
    | 'boss_preview'
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
  shopLevel?: number;
  itemsOrder?: string[];
  pactChoice?: string | null;
  sideQuestChoice?: string | null;
  day3Rumor?: string | null;
  sideQuestItemId?: string | null;
  chapter?: {
    currentChapter: number;
    dayInChapter: number;
    chapter1Completed: boolean;
    chapter1FailedCount: number;
    status: string;
    daysCleared: number[];
    pawnsCollected: number;
    demonsDefeated: number;
  };
}

interface CalendarDebugState {
  active: boolean;
  returnTo: 'TitleScene' | 'PawnshopScene';
  chapterId: number;
  dayInChapter: number;
  selectedDay: number;
  bossName: string;
  bossHp: number;
  days: {
    day: number;
    status: 'cleared' | 'visited' | 'current' | 'upcoming';
    demonId: string;
    demonName: string;
    isBossDay: boolean;
    tag: string | null;
  }[];
}

interface BattleDebugState {
  phase: string;
  round: number;
  maxRounds?: number;
  playerHp: number;
  shield: number;
  renqing: number;
  maxRenqing?: number;
  demonHp: number;
  demonMaxHp?: number;
  demonShield?: number;
  isBoss?: boolean;
  bossCharging?: boolean;
  bossChargeDamage?: number;
  bossChargeThreshold?: number;
  bossChargeInterrupted?: boolean;
  detailMode?: 'effect' | 'story';
  hand: string[];
  discardCount: number;
  result: string;
  resultView?: 'normal' | 'diary' | 'ending' | 'chapter_failed';
  demonId: string;
  demonName: string;
  isAnimating?: boolean;
  savedData?: {
    version: number;
    day: number;
    money: number;
    reputation: number;
    deck: string[];
    chapter?: {
      chapter1Completed: boolean;
      chapter1FailedCount: number;
      status: string;
      daysCleared: number[];
      pawnsCollected: number;
      demonsDefeated: number;
    };
  } | null;
}

const CARD_WIDTH = 48;
const CARD_GAP = 4;
const HAND_MARGIN_X = 6;
const HAND_Y = 144;

const BUTTONS = {
  titleStart: { x: 160, y: 122 },
  titleContinue: { x: 160, y: 156 },
  titleCalendar: { x: 266, y: 122 },
  pawnshopCalendar: { x: 298, y: 11 },
  calendarReturn: { x: 160, y: 163 },
  calendarDay7: { x: 292, y: 62 },
  pactHighMargin: { x: 58, y: 106 },
  pactCreditStock: { x: 160, y: 106 },
  pactSteady: { x: 262, y: 106 },
  trimFirstCard: { x: 64, y: 74 },
  trimSkip: { x: 160, y: 158 },
  redeemReject: { x: 224, y: 151 },
  tierLow: { x: 58, y: 154 },
  tierFair: { x: 160, y: 154 },
  tierHigh: { x: 262, y: 154 },
  skipCustomer: { x: 270, y: 107 },
  nextOrSummary: { x: 160, y: 154 },
  sideQuestAccept: { x: 96, y: 151 },
  sideQuestReject: { x: 224, y: 151 },
  bossPreviewConfirm: { x: 160, y: 158 },
  enterNightBattle: { x: 88, y: 151 },
  detailToggle: { x: 13, y: 88 },
  endTurn: { x: 283, y: 95 },
  resultNextDay: { x: 88, y: 148 },
  diaryContinue: { x: 160, y: 158 },
  endingRestart: { x: 96, y: 152 },
  endingTitle: { x: 224, y: 152 },
  chapterFailTitle: { x: 160, y: 148 },
} as const;

const CARD_PRIORITY = ['算盘', '余音', '集邮', '飞驰', '秤砣', '钢笔', '相机', '铁皮青蛙', '弹珠', '旧书', '蒲扇'] as const;
const CARD_COSTS: Record<string, number> = {
  算盘: 1,
  余音: 1,
  集邮: 1,
  飞驰: 2,
  秤砣: 1,
  钢笔: 1,
  相机: 1,
  铁皮青蛙: 1,
  弹珠: 1,
  旧书: 1,
  蒲扇: 1,
  守诺: 1,
  暖水瓶: 1,
  倒转: 2,
  拨浪鼓: 0,
  手电: 1,
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

async function getCalendarState(page: Page): Promise<CalendarDebugState | null> {
  return page.evaluate(() => {
    const hook = (
      window as unknown as { __CALENDAR_DEBUG__?: { getState: () => CalendarDebugState } }
    ).__CALENDAR_DEBUG__;
    return hook?.getState() ?? null;
  });
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

async function playGreedyUntilResult(page: Page, canvas: Locator): Promise<BattleDebugState> {
  let state = await waitForBattleReady(page, 'play');
  let safety = 0;

  while (state.phase === 'play' && state.result === 'ongoing' && safety < 50) {
    safety += 1;
    let chosenIdx = -1;
    for (const name of CARD_PRIORITY) {
      const idx = state.hand.indexOf(name);
      if (idx !== -1 && state.renqing >= (CARD_COSTS[name] ?? 99)) {
        chosenIdx = idx;
        break;
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

test('P9 E2E 1: Full Chapter 1 playthrough (?seed=2&deck=test) Day 1 -> Day 3 rumor -> Day 4 Pact/Trim -> Day 6 Side Quest -> Day 7 Boss -> Diary -> Ending', async ({
  page,
}) => {
  test.slow();
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

  for (let day = 1; day <= 7; day += 1) {
    if (day === 7) {
      await waitForPawnshopPhase(page, 'boss_preview');
      await clickLogical(page, canvas, BUTTONS.bossPreviewConfirm);
    }

    if (day === 4) {
      const pactState = await waitForPawnshopPhase(page, 'pact');
      expect(pactState.day).toBe(4);
      await page.screenshot({ path: 'test-results/p9-day4-pact.png' });

      // Pick 稳扎稳打 (+1 reputation)
      await clickLogical(page, canvas, BUTTONS.pactSteady);
      const trimState = await waitForPawnshopPhase(page, 'trim_deck');
      const deckBeforeTrim = trimState.deck.length;
      expect(deckBeforeTrim).toBeGreaterThan(0);

      // Delete first card via 整理柜台
      await clickLogical(page, canvas, BUTTONS.trimFirstCard);
      await expect
        .poll(async () => (await getPawnshopState(page)).deck.length)
        .toBe(deckBeforeTrim - 1);
    }

    // Wait for either redemption or negotiating
    await expect
      .poll(async () => {
        const p = (await getPawnshopState(page)).phase;
        return p === 'redemption' || p === 'negotiating';
      })
      .toBe(true);

    if ((await getPawnshopState(page)).phase === 'redemption') {
      await clickLogical(page, canvas, BUTTONS.redeemReject);
      await waitForPawnshopPhase(page, 'negotiating');
    }

    // Buy 1st customer at high on Day 1 to ensure pawnsCollected > 0, skip remaining to keep run fast & deterministic
    for (let c = 0; c < 3; c += 1) {
      await waitForPawnshopPhase(page, 'negotiating');
      if (day === 1 && c === 0) {
        await clickLogical(page, canvas, BUTTONS.tierHigh);
        await waitForPawnshopPhase(page, 'feedback');
        await clickLogical(page, canvas, BUTTONS.nextOrSummary);
      } else {
        await clickLogical(page, canvas, BUTTONS.skipCustomer);
      }
    }

    if (day === 6) {
      // Optional Day 6 side quest "偏巷暗当"
      const sqState = await waitForPawnshopPhase(page, 'side_quest');
      expect(sqState.sideQuestItemId).toBeTruthy();
      await page.screenshot({ path: 'test-results/p9-day6-side-quest.png' });

      // Accept -> 4th customer appears -> skip it to reach summary
      await clickLogical(page, canvas, BUTTONS.sideQuestAccept);
      const extraNeg = await waitForPawnshopPhase(page, 'negotiating');
      expect(extraNeg.customerIndex).toBe(3);
      expect(extraNeg.sideQuestChoice).toBe('accepted');
      await clickLogical(page, canvas, BUTTONS.skipCustomer);
    }

    const summary = await waitForPawnshopPhase(page, 'summary');
    if (day === 3) {
      expect(summary.day3Rumor).toBeTruthy();
      expect(summary.day3Rumor).toContain('老街风声');
    }

    await clickLogical(page, canvas, BUTTONS.enterNightBattle);
    const battleStart = await waitForBattleReady(page, 'play');

    if (day === 6) {
      // Side quest accepted => Night 6 demon gets +4 HP bonus!
      expect(battleStart.demonMaxHp).toBeGreaterThanOrEqual(24);
    }
    if (day === 7) {
      expect(battleStart.isBoss).toBe(true);
      expect(battleStart.demonId).toBe('boss_ch1');
      expect(battleStart.demonName).toBe('老债主·催账单');
      expect(battleStart.maxRounds).toBe(4);
      // TEST_DECK has 3 pawnshop items (倒转, 守诺, 旧书) -> 32 + 2*3 = 38 HP
      expect(battleStart.demonMaxHp).toBe(38);
    }

    const res = await playGreedyUntilResult(page, canvas);
    if (day < 7) {
      expect(res.resultView).toBe('normal');
      await clickLogical(page, canvas, BUTTONS.resultNextDay);
    } else {
      // Defeated Chapter 1 Boss -> Diary ("周日休市") -> Ending ("第1章 · 完成")
      expect(res.result).toBe('win');
      expect(res.resultView).toBe('diary');
      expect(res.savedData?.chapter?.chapter1Completed).toBe(true);
      expect(res.savedData?.chapter?.status).toBe('completed');
      await page.screenshot({ path: 'test-results/p9-ending-diary.png' });

      await clickLogical(page, canvas, BUTTONS.diaryContinue);
      await expect.poll(async () => (await getBattleState(page)).resultView).toBe('ending');
      await page.screenshot({ path: 'test-results/p9-ending-stats.png' });

      // Click "回到标题" -> returns cleanly to TitleScene with completed flag
      await clickLogical(page, canvas, BUTTONS.endingTitle);
      const titleAfter = await waitForPawnshopPhase(page, 'title');
      expect(titleAfter.chapter?.chapter1Completed).toBe(true);
    }
  }

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P9 E2E 2: CalendarMapScene opens from Title and mid-day Pawnshop HUD, shows tags/stamps, and returns without losing state', async ({
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
          day: 3,
          money: 165,
          reputation: 2,
          deck: ['飞驰', '余音', '守诺'],
          shopLevel: 3,
          redeemTickets: 0,
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
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');

  // 1. Open Calendar from TitleScene
  await clickLogical(page, canvas, BUTTONS.titleCalendar);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(true);
  const calFromTitle = (await getCalendarState(page))!;
  expect(calFromTitle.returnTo).toBe('TitleScene');
  expect(calFromTitle.days).toHaveLength(7);
  expect(calFromTitle.days[0].status).toBe('cleared');
  expect(calFromTitle.days[1].status).toBe('cleared');
  expect(calFromTitle.days[2].status).toBe('current');
  expect(calFromTitle.days[3].tag).toBe('集市日');
  expect(calFromTitle.days[6].isBossDay).toBe(true);
  expect(calFromTitle.days[6].tag).toBe('大心魔');
  expect(calFromTitle.bossName).toBe('老债主·催账单');

  // Select Day 7 cell to inspect Boss preview, capture screenshot
  await clickLogical(page, canvas, BUTTONS.calendarDay7);
  await expect.poll(async () => (await getCalendarState(page))?.selectedDay).toBe(7);
  await page.screenshot({ path: 'test-results/p9-calendar-map.png' });

  // Return to TitleScene
  await clickLogical(page, canvas, BUTTONS.calendarReturn);
  await waitForPawnshopPhase(page, 'title');

  // 2. Continue into Day 3 PawnshopScene, deal with Customer 1 so we are mid-day at Customer 2
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  await waitForPawnshopPhase(page, 'feedback');
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);

  const midDayBefore = await waitForPawnshopPhase(page, 'negotiating');
  expect(midDayBefore.customerIndex).toBe(1);
  const moneyBefore = midDayBefore.money;
  const repBefore = midDayBefore.reputation;
  const deckBefore = [...midDayBefore.deck];

  // Open Calendar from Pawnshop top HUD button
  await clickLogical(page, canvas, BUTTONS.pawnshopCalendar);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(true);
  const calFromShop = (await getCalendarState(page))!;
  expect(calFromShop.returnTo).toBe('PawnshopScene');

  // Return to PawnshopScene -> exact mid-day state must NOT be lost!
  await clickLogical(page, canvas, BUTTONS.calendarReturn);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(false);
  const midDayAfter = await waitForPawnshopPhase(page, 'negotiating');
  expect(midDayAfter.customerIndex).toBe(1);
  expect(midDayAfter.money).toBe(moneyBefore);
  expect(midDayAfter.reputation).toBe(repBefore);
  expect(midDayAfter.deck).toEqual(deckBefore);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P9 E2E 3: Boss R2 Interrupt path (>=10 dmg -> +1 renqing, R3 deals 3 dmg) + Plan C detail toggle', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=1&demon=boss_ch1');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 7,
          money: 120,
          reputation: 3,
          deck: ['秤砣', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣'],
          shopLevel: 3, // maxRenqing = 5
          redeemTickets: 0,
          chapter: {
            currentChapter: 1,
            dayInChapter: 7,
            chapter1Completed: false,
            chapter1FailedCount: 0,
            status: 'in_progress',
            bossBattleActive: true,
            pactChoice: null,
            sideQuestChoice: null,
            daysCleared: [1, 2, 3, 4, 5, 6],
            daysVisited: [1, 2, 3, 4, 5, 6],
            pawnsCollected: 10,
            demonsDefeated: 6,
            day4TrimDone: true,
            day6SideQuestDone: true,
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);

  // Day 7 starts with Boss pre-opening preview -> confirm to proceed
  await waitForPawnshopPhase(page, 'boss_preview');
  await clickLogical(page, canvas, BUTTONS.bossPreviewConfirm);

  // Skip all 3 Day 7 customers to preserve exact 秤砣 deck
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  const r1 = await waitForBattleReady(page, 'play');
  expect(r1.demonId).toBe('boss_ch1');
  // 0 pawnshop items in deck -> bare Boss (素体) 32 HP, R2 interrupt rule unchanged
  expect(r1.demonHp).toBe(32);
  expect(r1.detailMode).toBe('effect');

  // Verify Plan C detail bar toggle [故] <-> [效]
  await clickLogical(page, canvas, BUTTONS.detailToggle);
  await expect.poll(async () => (await getBattleState(page)).detailMode).toBe('story');
  await clickLogical(page, canvas, BUTTONS.detailToggle);
  await expect.poll(async () => (await getBattleState(page)).detailMode).toBe('effect');

  // End R1 -> Boss deals 3 dmg (30 -> 27), R2 starts charging with 4 shield
  await clickLogical(page, canvas, BUTTONS.endTurn);
  await expect.poll(async () => {
    const s = await getBattleState(page);
    return !s.isAnimating && s.round === 2;
  }).toBe(true);

  const r2Start = await getBattleState(page);
  expect(r2Start.playerHp).toBe(27);
  expect(r2Start.demonShield).toBe(4);
  expect(r2Start.bossCharging).toBe(true);
  expect(r2Start.renqing).toBe(5);
  await page.screenshot({ path: 'test-results/p9-boss-r2-charging.png' });

  // Play two 秤砣 (5 + 5 = 10 dmg) -> triggers BOSS_CHARGE_INTERRUPTED (+1 renqing refund: 5 - 2 + 1 = 4)
  await clickLogical(page, canvas, {
    x: computeHandCardX(0, r2Start.hand.length),
    y: HAND_Y,
  });
  await expect.poll(async () => {
    const s = await getBattleState(page);
    return !s.isAnimating && s.bossChargeDamage === 5;
  }).toBe(true);

  const midR2 = await getBattleState(page);
  await clickLogical(page, canvas, {
    x: computeHandCardX(0, midR2.hand.length),
    y: HAND_Y,
  });
  await expect.poll(async () => {
    const s = await getBattleState(page);
    return !s.isAnimating && s.bossChargeInterrupted === true;
  }).toBe(true);

  const afterInterrupt = await getBattleState(page);
  expect(afterInterrupt.bossChargeInterrupted).toBe(true);
  expect(afterInterrupt.renqing).toBe(4); // 5 - 1 - 1 + 1 refund
  await page.screenshot({ path: 'test-results/p9-boss-r2-interrupted.png' });

  // End R2 -> R3 (playerHp stays 27), then end R3 -> Boss deals ONLY 3 damage (27 -> 24)!
  await clickLogical(page, canvas, BUTTONS.endTurn);
  await expect.poll(async () => {
    const s = await getBattleState(page);
    return !s.isAnimating && s.round === 3;
  }).toBe(true);
  expect((await getBattleState(page)).playerHp).toBe(27);

  await clickLogical(page, canvas, BUTTONS.endTurn);
  await expect.poll(async () => {
    const s = await getBattleState(page);
    return !s.isAnimating && s.round === 4;
  }).toBe(true);
  expect((await getBattleState(page)).playerHp).toBe(24); // 27 - 3 = 24!

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P9 E2E 4: Boss R2 Non-Interrupt path (R3 deals full 11 dmg) & Chapter Failure preserves money/deck', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=1&demon=boss_ch1');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 7,
          money: 95,
          reputation: 2,
          deck: ['守诺', '守诺', '守诺', '旧书', '钢笔'],
          shopLevel: 2,
          redeemTickets: 0,
          chapter: {
            currentChapter: 1,
            dayInChapter: 7,
            chapter1Completed: false,
            chapter1FailedCount: 0,
            status: 'in_progress',
            bossBattleActive: true,
            pactChoice: null,
            sideQuestChoice: null,
            daysCleared: [1, 2, 3, 4, 5, 6],
            daysVisited: [1, 2, 3, 4, 5, 6],
            pawnsCollected: 8,
            demonsDefeated: 6,
            day4TrimDone: true,
            day6SideQuestDone: true,
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);

  // Day 7 starts with Boss pre-opening preview -> confirm to proceed
  await waitForPawnshopPhase(page, 'boss_preview');
  await clickLogical(page, canvas, BUTTONS.bossPreviewConfirm);

  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  await waitForBattleReady(page, 'play');

  // Deck ['守诺', '守诺', '守诺', '旧书', '钢笔'] -> 婚戒(R1盾+5) + 旧书(R1/2/3伤+1)
  // End R1 (4 dmg -> 26) -> End R2 without interrupting (1 dmg -> 25) -> End R3 (12 dmg -> 13!) -> End R4 (6 dmg -> 7, timeout)
  for (const expectedNextRound of [2, 3, 4]) {
    await clickLogical(page, canvas, BUTTONS.endTurn);
    await expect.poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.round === expectedNextRound;
    }).toBe(true);
    if (expectedNextRound === 4) {
      const r4 = await getBattleState(page);
      expect(r4.bossChargeInterrupted).toBe(false);
      expect(r4.playerHp).toBe(13); // 30 - 4 - 1 - 12 = 13!
    }
  }

  // End R4 -> Chapter failure screen
  await clickLogical(page, canvas, BUTTONS.endTurn);
  const failResult = await waitForBattleReady(page, 'result_scene');
  expect(failResult.resultView).toBe('chapter_failed');
  expect(failResult.savedData?.chapter?.status).toBe('failed');
  expect(failResult.savedData?.chapter?.chapter1FailedCount).toBe(1);
  // Money and deck must NOT be deducted on Boss defeat
  expect(failResult.savedData?.money).toBe(95);
  expect(failResult.savedData?.deck).toEqual(['守诺', '守诺', '守诺', '旧书', '钢笔']);

  // Click "回到标题" -> returns cleanly to TitleScene
  await clickLogical(page, canvas, BUTTONS.chapterFailTitle);
  const titleAfterFail = await waitForPawnshopPhase(page, 'title');
  expect(titleAfterFail.chapter?.status).toBe('failed');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

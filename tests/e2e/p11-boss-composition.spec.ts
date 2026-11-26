import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  BATTLE_HAND_Y,
  BOSS_PREVIEW_CONFIRM_BUTTON,
  CALENDAR_RETURN_BUTTON,
  computeHandCardX,
  DIARY_CONTINUE_BUTTON,
  ENDING_EPILOGUE_BUTTON,
  ENDING_TITLE_BUTTON,
  PAWNSHOP_CALENDAR_BUTTON,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  REDEMPTION_ACCEPT_BUTTON,
  REDEMPTION_REJECT_BUTTON,
  RESULT_NEXT_DAY_BUTTON,
  TITLE_CONTINUE_BUTTON,
  TITLE_START_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const PAWN_PRICES_STORAGE_KEY = 'pawnshop-cards-pawn-prices-v1';

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
  redeemTickets?: number;
  itemsOrder?: string[];
  shopkeeperNote?: string | null;
  lastToast?: string | null;
  version?: string;
  redemptionOffer?: {
    itemId: string;
    itemName: string;
    cardName: string;
    basePrice: number;
    payout: number;
    isBrideScripted?: boolean;
    isFatherOverdueScripted?: boolean;
  } | null;
  bossPreview?: {
    componentCount: number;
    finalHp: number;
    baseHp: number;
    componentHpBonus: number;
    pactHpBonus: number;
    hpCapped: boolean;
    r1Shield: number;
    chargeThreshold: number;
    fragmentNames: string[];
    hpLine: string;
  } | null;
  chapter?: {
    currentChapter: number;
    dayInChapter: number;
    pactChoice: string | null;
    pawnedItemIds?: string[];
    redeemedDayByItem?: Record<string, number>;
    bossComponentItemIds?: string[];
    day7FatherRedemptionDone?: boolean;
  };
}

interface CalendarDebugState {
  active: boolean;
  returnTo: 'TitleScene' | 'PawnshopScene';
  bossName: string;
  bossHp: number;
  bossComponentCount: number;
  bossActiveItemIds: string[];
  bossFragmentNames: string[];
  bossHpCapped: boolean;
  bossChargeThreshold: number;
  bossPreviewText: string;
}

interface BattleDebugState {
  phase: string;
  round: number;
  playerHp: number;
  renqing: number;
  demonHp: number;
  demonMaxHp?: number;
  demonShield?: number;
  isBoss?: boolean;
  bossChargeThreshold?: number;
  bossComposedChargeThreshold?: number;
  bossComponentCount?: number;
  bossFragmentNames?: string[];
  bossContributionLines?: string[];
  demonId: string;
  demonName: string;
  demonCustomerLink?: string;
  demonIntroBannerText?: string;
  victoryLine?: string | null;
  aftermathLine?: string | null;
  endingLedger?: {
    returnedItems: string[];
    retainedItems: string[];
    bossFragmentItems: string[];
    pawnedItems: string[];
    lines: string[];
  } | null;
  epilogueLines?: string[] | null;
  hand: string[];
  handSlotXs?: number[];
  discardCount: number;
  result: string;
  resultView?: 'normal' | 'diary' | 'ending' | 'epilogue' | 'chapter_failed';
  chapterFailHint?: string | null;
  isAnimating?: boolean;
}

const HAND_Y = BATTLE_HAND_Y;
const DAMAGE_PRIORITY = ['算盘', '余音', '集邮', '飞驰', '秤砣', '钢笔', '相机', '弹珠', '旧书', '蒲扇'] as const;
const CARD_COSTS: Record<string, number> = {
  倒转: 2,
  守诺: 1,
  旧书: 1,
  飞驰: 2,
  余音: 1,
  集邮: 1,
  算盘: 1,
  钢笔: 1,
  秤砣: 1,
  相机: 1,
  弹珠: 1,
  蒲扇: 1,
  暖水瓶: 1,
};

const BUTTONS = {
  titleStart: TITLE_START_BUTTON,
  titleContinue: TITLE_CONTINUE_BUTTON,
  pawnshopCalendar: PAWNSHOP_CALENDAR_BUTTON,
  calendarReturn: CALENDAR_RETURN_BUTTON,
  bossPreviewConfirm: BOSS_PREVIEW_CONFIRM_BUTTON,
  redeemAccept: REDEMPTION_ACCEPT_BUTTON,
  redeemReject: REDEMPTION_REJECT_BUTTON,
  tierHigh: PAWNSHOP_TIER_BUTTONS.high,
  skipCustomer: PAWNSHOP_SKIP_BUTTON,
  nextOrSummary: PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  enterNightBattle: PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  endTurn: BATTLE_END_TURN_BUTTON,
  resultNextDay: RESULT_NEXT_DAY_BUTTON,
  diaryContinue: DIARY_CONTINUE_BUTTON,
  endingEpilogue: ENDING_EPILOGUE_BUTTON,
  endingTitle: ENDING_TITLE_BUTTON,
} as const;

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
    for (const name of DAMAGE_PRIORITY) {
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
        x: state.handSlotXs?.[chosenIdx] ?? computeHandCardX(chosenIdx, state.hand.length),
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

test('P11 E2E 1: Shopkeeper opening note, Calendar Boss badges update on pawn & Bride redeem, and D1 cooldown removes redeemed ring from Day 3 pool', async ({
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

  // Title screen shows shopkeeper opening note & version
  const titleState = await waitForPawnshopPhase(page, 'title');
  expect(titleState.version).toBe('v0.4.3-ClearRunFix');
  expect(titleState.shopkeeperNote).toContain('有人回来赎东西，先找当票，别让人白跑。');
  await clickLogical(page, canvas, BUTTONS.titleStart);

  // Day 1 Pawnshop opening also shows shopkeeper note
  const day1Start = await waitForPawnshopPhase(page, 'negotiating');
  expect(day1Start.shopkeeperNote).toContain('有人回来赎东西，先找当票，别让人白跑。');

  // Open Calendar before any pawn -> 0 components, 30 HP
  await clickLogical(page, canvas, BUTTONS.pawnshopCalendar);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(true);
  const cal0 = (await getCalendarState(page))!;
  expect(cal0.bossComponentCount).toBe(0);
  expect(cal0.bossHp).toBe(30);
  expect(cal0.bossPreviewText).toContain('0件');
  expect(cal0.bossPreviewText).toContain('30血');
  await clickLogical(page, canvas, BUTTONS.calendarReturn);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(false);

  // Pawn watch (1st), skip bicycle (2nd), pawn ring (3rd)
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  await waitForPawnshopPhase(page, 'feedback');
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);

  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, BUTTONS.skipCustomer);

  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  await waitForPawnshopPhase(page, 'feedback');
  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  await waitForPawnshopPhase(page, 'summary');

  // Open Calendar -> 2 components (watch + ring), 32 HP
  await clickLogical(page, canvas, BUTTONS.pawnshopCalendar);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(true);
  const cal2 = (await getCalendarState(page))!;
  expect(cal2.bossComponentCount).toBe(2);
  expect(cal2.bossActiveItemIds).toEqual(['watch', 'ring']);
  expect(cal2.bossHp).toBe(32);
  await page.screenshot({ path: 'test-results/p11-calendar-badges.png' });
  await clickLogical(page, canvas, BUTTONS.calendarReturn);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(false);

  // Night 1 -> lose by timeout to enter Day 2
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  await waitForBattleReady(page, 'play');
  for (let r = 1; r <= 3; r += 1) {
    await clickLogical(page, canvas, BUTTONS.endTurn);
    if (r < 3) {
      await expect.poll(async () => (await getBattleState(page)).round).toBe(r + 1);
    }
  }
  await waitForBattleReady(page, 'result_scene');
  await clickLogical(page, canvas, BUTTONS.resultNextDay);

  // Day 2 Bride scripted redemption -> accept -> immediately drops to 1 component (watch), 31 HP!
  const bride = await waitForPawnshopPhase(page, 'redemption');
  expect(bride.redemptionOffer?.isBrideScripted).toBe(true);
  await clickLogical(page, canvas, BUTTONS.redeemAccept);
  await waitForPawnshopPhase(page, 'negotiating');

  await clickLogical(page, canvas, BUTTONS.pawnshopCalendar);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(true);
  const cal1 = (await getCalendarState(page))!;
  expect(cal1.bossComponentCount).toBe(1);
  expect(cal1.bossActiveItemIds).toEqual(['watch']);
  expect(cal1.bossHp).toBe(31);
  await clickLogical(page, canvas, BUTTONS.calendarReturn);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(false);

  // Finish Day 2 & Night 2 -> enter Day 3 and verify ring is excluded by D1 cooldown!
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  await waitForBattleReady(page, 'play');
  for (let r = 1; r <= 3; r += 1) {
    await clickLogical(page, canvas, BUTTONS.endTurn);
    if (r < 3) {
      await expect.poll(async () => (await getBattleState(page)).round).toBe(r + 1);
    }
  }
  await waitForBattleReady(page, 'result_scene');
  await clickLogical(page, canvas, BUTTONS.resultNextDay);

  const day3Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(day3Neg.day).toBe(3);
  expect(day3Neg.itemsOrder).not.toContain('ring');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P11 E2E 2: Day 7 Boss pre-opening preview (including 48 HP cap) matches actual Boss battle & opening banner fragments', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=3&demon=boss_ch1');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 7,
          money: 200,
          reputation: 3,
          deck: ['倒转', '守诺', '旧书', '飞驰', '余音', '集邮', '算盘', '算盘', '秤砣'],
          shopLevel: 4,
          redeemTickets: 0,
          chapter: {
            currentChapter: 1,
            dayInChapter: 7,
            chapter1Completed: false,
            chapter1FailedCount: 0,
            status: 'in_progress',
            bossBattleActive: true,
            pactChoice: 'credit_stock',
            sideQuestChoice: null,
            daysCleared: [1, 2, 3, 4, 5, 6],
            daysVisited: [1, 2, 3, 4, 5, 6],
            pawnsCollected: 6,
            demonsDefeated: 6,
            day4TrimDone: true,
            day6SideQuestDone: true,
            day7FatherRedemptionDone: true,
            pawnedItemIds: ['watch', 'ring', 'old_book', 'bicycle', 'erhu', 'stamp_album'],
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

  // Day 7 Boss preview must explicitly state 40 HP capped ("已到顶") and threshold 12
  const preview = await waitForPawnshopPhase(page, 'boss_preview');
  expect(preview.bossPreview).not.toBeNull();
  expect(preview.bossPreview?.componentCount).toBe(6);
  expect(preview.bossPreview?.finalHp).toBe(40);
  expect(preview.bossPreview?.hpCapped).toBe(true);
  expect(preview.bossPreview?.chargeThreshold).toBe(12);
  expect(preview.bossPreview?.hpLine).toContain('已到顶');
  await page.screenshot({ path: 'test-results/p11-boss-preview.png' });

  await clickLogical(page, canvas, BUTTONS.bossPreviewConfirm);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  // Actual Boss battle stats & opening banner must match the preview 1:1
  const bossStart = await waitForBattleReady(page, 'play');
  expect(bossStart.isBoss).toBe(true);
  expect(bossStart.demonMaxHp).toBe(preview.bossPreview?.finalHp);
  expect(bossStart.bossComponentCount).toBe(6);
  expect(bossStart.bossComposedChargeThreshold).toBe(12);
  expect(bossStart.demonShield).toBe(2);
  expect(bossStart.bossFragmentNames).toEqual(preview.bossPreview?.fragmentNames);
  expect(bossStart.demonIntroBannerText).toContain('手表的执念');
  expect(bossStart.demonIntroBannerText).toContain('邮票册的执念');
  expect(bossStart.demonIntroBannerText).toContain('柜子里的事，今夜一起上门了');
  await page.screenshot({ path: 'test-results/p11-boss-banner.png' });

  // End R1 -> verify active R2 charge threshold is actually 12 in combat state
  await clickLogical(page, canvas, BUTTONS.endTurn);
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.round === 2;
    })
    .toBe(true);
  const r2 = await getBattleState(page);
  expect(r2.bossChargeThreshold).toBe(12);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P11 E2E 3: Bride redemption removes 婚戒组件 from Night 7 Boss (shield 0 vs shield 5)', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  // Day 2 Bride accept -> then Day 7 Boss without 守诺
  await page.goto('/?seed=4');
  await page.evaluate(
    ([saveKey, tutKey, priceKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(priceKey, JSON.stringify({ 守诺: [90] }));
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 2,
          money: 110,
          reputation: 1,
          deck: ['守诺', '飞驰', '算盘'],
          shopLevel: 2,
          redeemTickets: 0,
          chapter: {
            currentChapter: 1,
            dayInChapter: 2,
            chapter1Completed: false,
            chapter1FailedCount: 0,
            status: 'in_progress',
            bossBattleActive: false,
            pactChoice: null,
            sideQuestChoice: null,
            daysCleared: [1],
            daysVisited: [1],
            pawnsCollected: 2,
            demonsDefeated: 1,
            day4TrimDone: false,
            day6SideQuestDone: false,
            day1RingPawned: true,
            day2BrideRedemptionDone: false,
            pawnedItemIds: ['ring', 'bicycle'],
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, PAWN_PRICES_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  await waitForPawnshopPhase(page, 'redemption');
  await clickLogical(page, canvas, BUTTONS.redeemAccept);
  const afterBride = await waitForPawnshopPhase(page, 'negotiating');
  expect(afterBride.deck).not.toContain('守诺');

  // Jump straight to Night 7 Boss with the persisted deck (no 守诺) & check Boss lacks ring component
  await page.evaluate(
    ([saveKey]) => {
      const saved = JSON.parse(localStorage.getItem(saveKey)!);
      saved.day = 7;
      saved.chapter.dayInChapter = 7;
      saved.chapter.daysCleared = [1, 2, 3, 4, 5, 6];
      saved.chapter.daysVisited = [1, 2, 3, 4, 5, 6];
      saved.chapter.day4TrimDone = true;
      saved.chapter.day6SideQuestDone = true;
      localStorage.setItem(saveKey, JSON.stringify(saved));
    },
    [SAVE_STORAGE_KEY] as const,
  );
  await page.goto('/?seed=4&demon=boss_ch1');
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  const preview = await waitForPawnshopPhase(page, 'boss_preview');
  expect(preview.bossPreview?.r1Shield).toBe(0);
  expect(preview.bossPreview?.fragmentNames).toEqual(['自行车的执念']);

  await clickLogical(page, canvas, BUTTONS.bossPreviewConfirm);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  const boss = await waitForBattleReady(page, 'play');
  expect(boss.demonShield).toBe(0);
  expect(boss.demonMaxHp).toBe(31);
  expect(boss.bossFragmentNames).toEqual(['自行车的执念']);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P11 E2E 4: Day 7 Father overdue watch redemption (Accept vs Reject) & Ending Ledger + Chapter 3 Month-End Epilogue', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  // Case A: Reject Father redemption -> 倒转 stays, rep -1, Boss keeps 手表的执念
  await page.goto('/?seed=5&demon=boss_ch1');
  await page.evaluate(
    ([saveKey, tutKey, priceKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(priceKey, JSON.stringify({ 倒转: [60] }));
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 7,
          money: 80,
          reputation: 2,
          deck: ['倒转', '飞驰', '算盘', '算盘', '秤砣', '秤砣', '秤砣'],
          shopLevel: 4,
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
            pawnsCollected: 5,
            demonsDefeated: 6,
            day4TrimDone: true,
            day6SideQuestDone: true,
            day7FatherRedemptionDone: false,
            pawnedItemIds: ['watch', 'bicycle'],
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, PAWN_PRICES_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  await waitForPawnshopPhase(page, 'boss_preview');
  await clickLogical(page, canvas, BUTTONS.bossPreviewConfirm);

  const fatherRejectView = await waitForPawnshopPhase(page, 'redemption');
  expect(fatherRejectView.redemptionOffer?.isFatherOverdueScripted).toBe(true);
  expect(fatherRejectView.redemptionOffer?.payout).toBe(72);
  await page.screenshot({ path: 'test-results/p11-father-event.png' });

  await clickLogical(page, canvas, BUTTONS.redeemReject);
  const afterReject = await waitForPawnshopPhase(page, 'negotiating');
  expect(afterReject.deck).toContain('倒转');
  expect(afterReject.reputation).toBe(1);
  expect(afterReject.money).toBe(80);
  expect(afterReject.chapter?.day7FatherRedemptionDone).toBe(true);

  // Case B: Accept Father redemption in Chapter 3 -> 倒转 leaves, +72 money, rep +1, Boss loses 手表的执念 -> Win -> Ledger + Month-End Epilogue
  await page.evaluate(
    ([saveKey, priceKey]) => {
      localStorage.setItem(priceKey, JSON.stringify({ 倒转: [60] }));
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 7,
          money: 80,
          reputation: 2,
          deck: ['倒转', '飞驰', '余音', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣'],
          shopLevel: 4,
          redeemTickets: 0,
          chapter: {
            currentChapter: 3,
            dayInChapter: 7,
            chapter1Completed: true,
            chapter1FailedCount: 0,
            status: 'in_progress',
            bossBattleActive: true,
            pactChoice: null,
            sideQuestChoice: null,
            daysCleared: [1, 2, 3, 4, 5, 6],
            daysVisited: [1, 2, 3, 4, 5, 6],
            pawnsCollected: 5,
            demonsDefeated: 6,
            day4TrimDone: true,
            day6SideQuestDone: true,
            day7FatherRedemptionDone: false,
            pawnedItemIds: ['watch', 'ring', 'bicycle', 'erhu'],
            redeemedDayByItem: { ring: 2 },
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, PAWN_PRICES_STORAGE_KEY] as const,
  );
  await page.reload();

  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  await waitForPawnshopPhase(page, 'boss_preview');
  await clickLogical(page, canvas, BUTTONS.bossPreviewConfirm);

  const fatherAcceptView = await waitForPawnshopPhase(page, 'redemption');
  expect(fatherAcceptView.redemptionOffer?.isFatherOverdueScripted).toBe(true);
  await clickLogical(page, canvas, BUTTONS.redeemAccept);
  const afterAccept = await waitForPawnshopPhase(page, 'negotiating');
  expect(afterAccept.deck).not.toContain('倒转');
  expect(afterAccept.money).toBe(152); // 80 + 72
  expect(afterAccept.reputation).toBe(3);
  expect(afterAccept.lastToast).toBe('Boss已变弱 33->32');

  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  const bossStart = await waitForBattleReady(page, 'play');
  expect(bossStart.bossFragmentNames).not.toContain('手表的执念');
  expect(bossStart.bossFragmentNames).toEqual(['自行车的执念', '二胡的执念']);
  expect(bossStart.demonMaxHp).toBe(32);

  const res = await playGreedyUntilResult(page, canvas);
  expect(res.result).toBe('win');
  expect(res.resultView).toBe('diary');
  expect(res.endingLedger).not.toBeNull();
  expect(res.endingLedger?.returnedItems).toEqual(['旧手表', '婚戒']);
  expect(res.endingLedger?.retainedItems).toEqual(['永久自行车', '二胡']);
  expect(res.endingLedger?.bossFragmentItems).toEqual(['永久自行车', '二胡']);

  await clickLogical(page, canvas, BUTTONS.diaryContinue);
  await expect.poll(async () => (await getBattleState(page)).resultView).toBe('ending');
  await page.screenshot({ path: 'test-results/p11-ending-ledger.png' });

  await clickLogical(page, canvas, BUTTONS.endingEpilogue);
  await expect.poll(async () => (await getBattleState(page)).resultView).toBe('epilogue');
  const epilogue = await getBattleState(page);
  expect(epilogue.epilogueLines?.join('\n')).toContain('三周二十一天');
  expect(epilogue.epilogueLines?.join('\n')).toContain('物归原主:旧手表、婚戒');
  await page.screenshot({ path: 'test-results/p11-epilogue.png' });

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P11 E2E 5: Conditional demon banner & victory aftermath show generic copy when linked item not pawned, and bare Boss fallback renders cleanly', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  // Night 1 without pawning watch (skip all 3) -> generic banner & generic aftermath
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
  expect(battle.demonCustomerLink).toContain('老街上又一桩没了结的事');
  expect(battle.demonCustomerLink).not.toContain('手表');
  expect(battle.demonIntroBannerText).not.toContain('手表');

  const res = await playGreedyUntilResult(page, canvas);
  expect(res.result).toBe('win');
  expect(res.aftermathLine).toContain('老街的账还得一笔笔算');
  expect(res.aftermathLine).not.toContain('手表还在柜台');

  // Bare Boss (0 pawnshop items) opening banner
  await page.evaluate(
    ([saveKey]) => {
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 7,
          money: 100,
          reputation: 1,
          deck: ['算盘', '钢笔', '秤砣'],
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
            pawnsCollected: 0,
            demonsDefeated: 6,
            day4TrimDone: true,
            day6SideQuestDone: true,
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY] as const,
  );
  await page.goto('/?seed=1&demon=boss_ch1');
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  await waitForPawnshopPhase(page, 'boss_preview');
  await clickLogical(page, canvas, BUTTONS.bossPreviewConfirm);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  const bareBoss = await waitForBattleReady(page, 'play');
  expect(bareBoss.bossComponentCount).toBe(0);
  expect(bareBoss.demonMaxHp).toBe(30);
  expect(bareBoss.demonIntroBannerText).toContain('柜子空了，债主只身前来');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Playtest fix round: Day 7 daytime deal shows Boss已涨血 toast and chapter failure screen shows Q8 hints', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  // Day 7 with 0 items in deck (30 HP) -> buy first customer item (high tier) -> Boss strengthens 30->31
  await page.goto('/?seed=4&demon=boss_ch1');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 7,
          money: 300,
          reputation: 2,
          deck: ['算盘', '钢笔', '秤砣'],
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
            pawnsCollected: 0,
            demonsDefeated: 6,
            day4TrimDone: true,
            day6SideQuestDone: true,
            day7FatherRedemptionDone: true,
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  await waitForPawnshopPhase(page, 'boss_preview');
  await clickLogical(page, canvas, BUTTONS.bossPreviewConfirm);

  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  const fb = await waitForPawnshopPhase(page, 'feedback');
  expect(fb.lastToast).toBe('Boss已涨血 30->31');

  await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  for (let i = 1; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  const bossStart = await waitForBattleReady(page, 'play');
  expect(bossStart.demonMaxHp).toBe(31);

  // Also verify lose_timeout chapter failure hint
  for (let r = 1; r <= 4; r += 1) {
    await clickLogical(page, canvas, BUTTONS.endTurn);
    if (r < 4) {
      await expect.poll(async () => (await getBattleState(page)).round).toBe(r + 1);
    }
  }
  const timeoutFail = await waitForBattleReady(page, 'result_scene');
  expect(timeoutFail.result).toBe('lose_timeout');
  expect(timeoutFail.resultView).toBe('chapter_failed');
  expect(timeoutFail.chapterFailHint).toBe('提醒：试试多攒伤害牌来打断封门');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  CALENDAR_DAY_CELLS,
  CALENDAR_RETURN_BUTTON,
  DEMON_INTRO_BANNER_RECT,
  MORNING_OPTION_BUTTONS,
  PAWNSHOP_CALENDAR_BUTTON,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  REDEMPTION_ACCEPT_BUTTON,
  TITLE_CONTINUE_BUTTON,
  TITLE_START_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const GLOSSARY_STORAGE_KEY = 'pawnshop-cards-glossary-v1';
const PAWN_PRICES_STORAGE_KEY = 'pawnshop-cards-prices-v1';

const ALL_GLOSSARY_SEEN = JSON.stringify([
  'reputation',
  'renqing',
  'obsession',
  'charge_threshold',
  'debt_note',
]);

interface PawnshopDebugState {
  phase: string;
  customerIndex: number;
  money: number;
  deck: string[];
  day?: number;
  itemsOrder?: string[];
  obsessionHint?: string | null;
  redemptionOffer?: { itemId: string; cardName: string } | null;
}

interface CalendarDebugState {
  active: boolean;
  selectedDay: number;
  days: {
    day: number;
    demonId: string;
    demonName: string;
    mechanicLine: string | null;
    obsessionActive: boolean;
    obsessionLabel: string | null;
  }[];
}

interface BattleDebugState {
  phase: string;
  round: number;
  playerHp: number;
  shield: number;
  renqing: number;
  demonHp: number;
  demonMaxHp?: number;
  demonShield?: number;
  demonId: string;
  demonMechanicLine?: string;
  demonObsessionActive?: boolean;
  demonObsessionLabel?: string | null;
  demonCustomerLink?: string;
  victoryLine?: string | null;
  aftermathLine?: string | null;
  demonIntroBannerText?: string;
  introBannerVisible?: boolean;
  hand: string[];
  handSlotXs?: number[];
  handSlotYs?: number[];
  deckCount: number;
  discardCount: number;
  result: string;
  isAnimating?: boolean;
  log?: string[];
  intent: {
    current: { round: number; damage: number; shield?: number; skill?: string } | null;
    upcomingSkill: { round: number; damage: number; skill?: string } | null;
  };
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

async function dismissBattleBannerIfPresent(page: Page, canvas: Locator): Promise<void> {
  const s = await getBattleState(page);
  if (!s.introBannerVisible) return;
  await clickLogical(page, canvas, {
    x: Math.floor(DEMON_INTRO_BANNER_RECT.x + DEMON_INTRO_BANNER_RECT.width / 2),
    y: Math.floor(DEMON_INTRO_BANNER_RECT.y + DEMON_INTRO_BANNER_RECT.height / 2),
  });
  await expect.poll(async () => (await getBattleState(page)).introBannerVisible).toBe(false);
}

async function advanceEndTurn(page: Page, canvas: Locator, currentRound: number): Promise<BattleDebugState> {
  await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && (s.phase === 'result_scene' || s.round !== currentRound);
    })
    .toBe(true);
  return getBattleState(page);
}

async function playHandCardByName(
  page: Page,
  canvas: Locator,
  cardName: string,
): Promise<BattleDebugState> {
  const before = await waitForBattleReady(page, 'play');
  const idx = before.hand.indexOf(cardName);
  expect(idx, `expected "${cardName}" in hand [${before.hand.join(', ')}]`).toBeGreaterThanOrEqual(0);
  await clickLogical(page, canvas, {
    x: before.handSlotXs![idx],
    y: before.handSlotYs![idx],
  });
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return (
        !s.isAnimating &&
        (s.phase === 'result_scene' ||
          s.discardCount !== before.discardCount ||
          s.hand.length !== before.hand.length ||
          s.renqing !== before.renqing ||
          s.demonHp !== before.demonHp ||
          s.shield !== before.shield ||
          s.playerHp !== before.playerHp)
      );
    })
    .toBe(true);
  return getBattleState(page);
}

function buildSeededSave(opts: {
  day: number;
  deck: string[];
  money?: number;
  redeemTickets?: number;
  pawnedItemIds?: string[];
  pactChoice?: 'steady_shop' | null;
  day4TrimDone?: boolean;
}): string {
  const cleared = Array.from({ length: opts.day - 1 }, (_, i) => i + 1);
  return JSON.stringify({
    version: 3,
    day: opts.day,
    money: opts.money ?? 240,
    reputation: 0,
    deck: opts.deck,
    shopLevel: 4,
    redeemTickets: opts.redeemTickets ?? 0,
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
      day4TrimDone: opts.day4TrimDone ?? false,
      day6SideQuestDone: false,
      ...(opts.pawnedItemIds ? { pawnedItemIds: opts.pawnedItemIds } : {}),
    },
  });
}

async function seedAndStartSavedDay(
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

test('P12 Phase B §3.1: Day 2-4 obsession previews (pawnshop/calendar/banner), Day 1 exemption, and redemption clearing', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // 1) Day 1 exemption: seed=24 puts watch first -> no pawnshop hint, no obsession on Night 1 Demon A (3/3/5)
  await page.goto('/?seed=24');
  await page.evaluate(
    ([saveKey, tutKey, glosKey, glosVal]) => {
      localStorage.removeItem(saveKey);
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(glosKey, glosVal);
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY, ALL_GLOSSARY_SEEN] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_START_BUTTON);

  const d1Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(d1Neg.itemsOrder?.[0]).toBe('watch');
  expect(d1Neg.obsessionHint).toBeNull();
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  await waitForPawnshopPhase(page, 'feedback');
  await clickLogical(page, canvas, PAWNSHOP_FEEDBACK_NEXT_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  const n1 = await waitForBattleReady(page, 'play');
  expect(n1.demonId).toBe('a');
  expect(n1.demonObsessionActive).toBe(false);
  expect(n1.demonMechanicLine).toBe('第三回合伤害 5');
  expect(n1.demonIntroBannerText).toContain('机制:第三回合伤害 5');
  expect(n1.demonIntroBannerText).not.toContain('执念:');
  await dismissBattleBannerIfPresent(page, canvas);
  await advanceEndTurn(page, canvas, 1); // -3 -> 27
  await advanceEndTurn(page, canvas, 2); // -3 -> 24
  const n1End = await advanceEndTurn(page, canvas, 3); // -5 -> 19
  expect(n1End.playerHp).toBe(19);

  // 2) Day 2 buy 口琴 (seed=5 puts harmonica first) -> pawnshop hint + calendar obsession + battle banner + R3 10 dmg
  await seedAndStartSavedDay(page, canvas, '/?seed=5', buildSeededSave({ day: 2, deck: ['钢笔'] }));
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  const d2Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(d2Neg.itemsOrder?.[0]).toBe('harmonica');
  expect(d2Neg.obsessionHint).toBe('收下它，今晚车票远行 10 伤');
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  await waitForPawnshopPhase(page, 'feedback');
  await clickLogical(page, canvas, PAWNSHOP_FEEDBACK_NEXT_BUTTON);

  // Open Calendar on Day 2 and verify obsession marker & mechanic line
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_CALENDAR_BUTTON);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(true);
  const calD2 = (await getCalendarState(page))!;
  const calDay2Entry = calD2.days.find((d) => d.day === 2)!;
  expect(calDay2Entry.obsessionActive).toBe(true);
  expect(calDay2Entry.obsessionLabel).toBe('远行伤害 10');
  expect(calDay2Entry.mechanicLine).toBe('两回合都得 1 盾');
  await clickLogical(page, canvas, CALENDAR_RETURN_BUTTON);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(false);

  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  const n2Obs = await waitForBattleReady(page, 'play');
  expect(n2Obs.demonId).toBe('b');
  expect(n2Obs.demonObsessionActive).toBe(true);
  expect(n2Obs.demonObsessionLabel).toBe('远行伤害 10');
  expect(n2Obs.demonIntroBannerText).toContain('机制:两回合都得 1 盾');
  expect(n2Obs.demonIntroBannerText).toContain('执念:远行伤害 10');
  await dismissBattleBannerIfPresent(page, canvas);
  await advanceEndTurn(page, canvas, 1); // -2 -> 28
  const n2R3 = await advanceEndTurn(page, canvas, 2); // -2 -> 26
  expect(n2R3.intent.current?.damage).toBe(10);
  const n2End = await advanceEndTurn(page, canvas, 3); // -10 -> 16
  expect(n2End.playerHp).toBe(16);

  // 3) Day 2 WITHOUT linked item -> Demon B R3 damage is 8 (30 - 2 - 2 - 8 = 18)
  await seedAndStartSavedDay(page, canvas, '/?seed=5', buildSeededSave({ day: 2, deck: ['钢笔'] }));
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  const n2Clean = await waitForBattleReady(page, 'play');
  expect(n2Clean.demonObsessionActive).toBe(false);
  await dismissBattleBannerIfPresent(page, canvas);
  await advanceEndTurn(page, canvas, 1);
  const n2CleanR3 = await advanceEndTurn(page, canvas, 2);
  expect(n2CleanR3.intent.current?.damage).toBe(8);
  const n2CleanEnd = await advanceEndTurn(page, canvas, 3);
  expect(n2CleanEnd.playerHp).toBe(18);

  // 4) Day 2 WITH 口琴 redeemed in morning -> obsession disappears (R3 damage returns to 8)
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=5',
    buildSeededSave({ day: 2, deck: ['口琴', '钢笔'], redeemTickets: 1 }),
    { 口琴: [30] },
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  const redeemPhase = await waitForPawnshopPhase(page, 'redemption');
  expect(redeemPhase.redemptionOffer?.itemId).toBe('harmonica');
  await clickLogical(page, canvas, REDEMPTION_ACCEPT_BUTTON);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  const n2AfterRedeem = await waitForBattleReady(page, 'play');
  expect(n2AfterRedeem.demonObsessionActive).toBe(false);
  expect(n2AfterRedeem.demonIntroBannerText).not.toContain('执念:');
  await dismissBattleBannerIfPresent(page, canvas);
  await advanceEndTurn(page, canvas, 1);
  const n2RedeemR3 = await advanceEndTurn(page, canvas, 2);
  expect(n2RedeemR3.intent.current?.damage).toBe(8);

  // 5) Day 3 buy 铁皮箱 (seed=25 puts tin_trunk first) -> pawnshop hint + Demon C HP 28
  await seedAndStartSavedDay(page, canvas, '/?seed=25', buildSeededSave({ day: 3, deck: ['钢笔'] }));
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  const d3Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(d3Neg.itemsOrder?.[0]).toBe('tin_trunk');
  expect(d3Neg.obsessionHint).toBe('收下它，今晚房租多 2 血');
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  await waitForPawnshopPhase(page, 'feedback');
  await clickLogical(page, canvas, PAWNSHOP_FEEDBACK_NEXT_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  const n3Obs = await waitForBattleReady(page, 'play');
  expect(n3Obs.demonId).toBe('c');
  expect(n3Obs.demonHp).toBe(28);
  expect(n3Obs.demonObsessionActive).toBe(true);
  expect(n3Obs.demonIntroBannerText).toContain('执念:血量 28');

  // 6) Day 4 buy 布票 (seed=34 puts cloth_ticket first) -> pawnshop hint + Demon D R3 damage 12
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=34',
    buildSeededSave({ day: 4, deck: ['钢笔'], pactChoice: 'steady_shop', day4TrimDone: true }),
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  const d4Neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(d4Neg.itemsOrder?.[0]).toBe('cloth_ticket');
  expect(d4Neg.obsessionHint).toBe('收下它，今晚学费开学 12 伤');
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  await waitForPawnshopPhase(page, 'feedback');
  await clickLogical(page, canvas, PAWNSHOP_FEEDBACK_NEXT_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  const n4Obs = await waitForBattleReady(page, 'play');
  expect(n4Obs.demonId).toBe('d');
  expect(n4Obs.demonObsessionActive).toBe(true);
  expect(n4Obs.demonIntroBannerText).toContain('执念:开学伤害 12');
  await dismissBattleBannerIfPresent(page, canvas);
  await advanceEndTurn(page, canvas, 1); // -1 -> 29
  const n4R3 = await advanceEndTurn(page, canvas, 2); // -2 -> 27
  expect(n4R3.intent.current?.damage).toBe(12);
  const n4End = await advanceEndTurn(page, canvas, 3); // -12 -> 15
  expect(n4End.playerHp).toBe(15);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 Phase B §3.2: All four demon mechanics (A 3/3/5, B R1/R2 1 shield, C 3/5/7, D R1/R2 2 shield) & Calendar/Banner mechanic lines', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // Calendar check: Days 1-4 expose all 4 demon mechanic lines
  await seedAndStartSavedDay(page, canvas, '/?seed=7', buildSeededSave({ day: 3, deck: ['钢笔'] }));
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_CALENDAR_BUTTON);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(true);
  for (const [dayIdx, expectedLine] of [
    [0, '第三回合伤害 5'],
    [1, '两回合都得 1 盾'],
    [2, '伤害每回合涨，3/5/7'],
    [3, '两回合都得 2 盾'],
  ] as const) {
    await clickLogical(page, canvas, CALENDAR_DAY_CELLS[dayIdx]);
    const cal = (await getCalendarState(page))!;
    expect(cal.selectedDay).toBe(dayIdx + 1);
    expect(cal.days[dayIdx].mechanicLine).toBe(expectedLine);
  }
  await clickLogical(page, canvas, CALENDAR_RETURN_BUTTON);

  // Demon B: R1 1 shield + R2 1 shield verified via battle state & log
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=7&demon=b&deck=test',
    buildSeededSave({ day: 2, deck: ['钢笔'] }),
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  const bR1 = await waitForBattleReady(page, 'play');
  expect(bR1.demonShield).toBe(1);
  expect(bR1.log).toContain('R1:心魔获1盾');
  expect(bR1.demonIntroBannerText).toContain('机制:两回合都得 1 盾');
  await dismissBattleBannerIfPresent(page, canvas);
  await playHandCardByName(page, canvas, '秤砣'); // breaks 1 shield
  const bR2 = await advanceEndTurn(page, canvas, 1);
  expect(bR2.demonShield).toBe(1);
  expect(bR2.log).toContain('R2:心魔获1盾');

  // Demon C: 3 / 5 / 7 escalating damage
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=7&demon=c',
    buildSeededSave({ day: 3, deck: ['钢笔'] }),
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  const cR1 = await waitForBattleReady(page, 'play');
  expect(cR1.demonIntroBannerText).toContain('机制:伤害每回合涨，3/5/7');
  await dismissBattleBannerIfPresent(page, canvas);
  const cR2 = await advanceEndTurn(page, canvas, 1);
  expect(cR2.playerHp).toBe(27);
  const cR3 = await advanceEndTurn(page, canvas, 2);
  expect(cR3.playerHp).toBe(22);
  const cEnd = await advanceEndTurn(page, canvas, 3);
  expect(cEnd.playerHp).toBe(15);

  // Demon D: R1 2 shield + R2 2 shield verified via battle state & log
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=7&demon=d&deck=test',
    buildSeededSave({ day: 4, deck: ['钢笔'], pactChoice: 'steady_shop', day4TrimDone: true }),
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  const dR1 = await waitForBattleReady(page, 'play');
  expect(dR1.demonShield).toBe(2);
  expect(dR1.log).toContain('R1:心魔获2盾');
  expect(dR1.demonIntroBannerText).toContain('机制:两回合都得 2 盾');
  await dismissBattleBannerIfPresent(page, canvas);
  await playHandCardByName(page, canvas, '秤砣'); // breaks 2 shield
  const dR2 = await advanceEndTurn(page, canvas, 1);
  expect(dR2.demonShield).toBe(2);
  expect(dR2.log).toContain('R2:心魔获2盾');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 Follow-up 1: owned items never reappear in customer pool and short pool (<3) shows fewer customers without padding', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // 1) Buy watch on Day 1 (seed=24), then on Day 2 with only 2 other unowned items left (10 owned in deck),
  //    watch does NOT appear and Day 2 only presents the 2 unowned items (tin_trunk, gold_watch).
  const tenOwnedExceptLastTwo = [
    '倒转',
    '守诺',
    '旧书',
    '飞驰',
    '余音',
    '集邮',
    '布票',
    '口琴',
    '药箱',
    '账本',
  ];
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=5',
    buildSeededSave({
      day: 3,
      deck: tenOwnedExceptLastTwo,
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
  const neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(neg.itemsOrder).toHaveLength(2);
  expect(new Set(neg.itemsOrder)).toEqual(new Set(['tin_trunk', 'gold_watch']));
  expect(neg.itemsOrder).not.toContain('watch');

  // Skip the 2 customers -> enters summary cleanly without padding a 3rd owned customer
  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  await waitForPawnshopPhase(page, 'summary');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

async function winBattleWithCard(
  page: Page,
  canvas: Locator,
  preferredCardName: string,
): Promise<BattleDebugState> {
  let state = await waitForBattleReady(page, 'play');
  for (let safety = 0; safety < 20 && state.phase === 'play'; safety += 1) {
    if (state.hand.includes(preferredCardName) && state.renqing >= 1) {
      state = await playHandCardByName(page, canvas, preferredCardName);
      continue;
    }
    state = await advanceEndTurn(page, canvas, state.round);
  }
  return waitForBattleReady(page, 'result_scene');
}

test('P12 Phase B fix: non-primary linked items (harmonica / medicine_box) show per-item banner and victory aftermath narrative', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // 1) Only 口琴 (harmonica) pawned -> Night 2 Demon B shows 口琴 narrative, not 婚戒/新娘
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=7',
    buildSeededSave({
      day: 2,
      deck: ['口琴', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣'],
      pawnedItemIds: ['harmonica'],
    }),
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  const bStart = await waitForBattleReady(page, 'play');
  expect(bStart.demonId).toBe('b');
  expect(bStart.demonIntroBannerText).toContain('白天当了口琴的工人的难处');
  expect(bStart.demonIntroBannerText).not.toContain('婚戒');
  expect(bStart.demonIntroBannerText).not.toContain('新娘');
  await dismissBattleBannerIfPresent(page, canvas);

  const bResult = await winBattleWithCard(page, canvas, '秤砣');
  expect(bResult.result).toBe('win');
  expect(bResult.victoryLine).toBe('今晚，车票被扛过去了。当了口琴的工人，离回家又近了一步。');
  expect(bResult.victoryLine).not.toContain('新娘');
  expect(bResult.aftermathLine).toBe('白天口琴仍在铺里，远路还得自己走。');
  expect(bResult.aftermathLine).not.toContain('婚戒');

  // 2) Only 药箱 (medicine_box) pawned -> Night 1 Demon A shows 药箱 narrative, not 手表/父亲
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=7&demon=a',
    buildSeededSave({
      day: 2,
      deck: ['药箱', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣'],
      pawnedItemIds: ['medicine_box'],
    }),
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  const aStart = await waitForBattleReady(page, 'play');
  expect(aStart.demonId).toBe('a');
  expect(aStart.demonIntroBannerText).toContain('白天当了药箱的老头的难处');
  expect(aStart.demonIntroBannerText).not.toContain('手表');
  expect(aStart.demonIntroBannerText).not.toContain('父亲');
  await dismissBattleBannerIfPresent(page, canvas);

  const aResult = await winBattleWithCard(page, canvas, '秤砣');
  expect(aResult.result).toBe('win');
  expect(aResult.victoryLine).toBe('今晚，药费被扛过去了。当了药箱的老头，能睡个安稳觉了。');
  expect(aResult.victoryLine).not.toContain('手表');
  expect(aResult.aftermathLine).toBe('白天药箱还在柜里，下月账单还在。');
  expect(aResult.aftermathLine).not.toContain('手表');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 Phase B fix: unlinked demon victory falls back to generic victoryLine and aftermathLine', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=7',
    buildSeededSave({
      day: 2,
      deck: ['钢笔', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣'],
      pawnedItemIds: [],
    }),
  );
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  const bStart = await waitForBattleReady(page, 'play');
  expect(bStart.demonId).toBe('b');
  expect(bStart.demonIntroBannerText).toContain('老街上又一桩没了结的事');
  expect(bStart.demonIntroBannerText).not.toContain('婚戒');
  expect(bStart.demonIntroBannerText).not.toContain('新娘');
  await dismissBattleBannerIfPresent(page, canvas);

  const bResult = await winBattleWithCard(page, canvas, '秤砣');
  expect(bResult.result).toBe('win');
  expect(bResult.victoryLine).toBe('今晚，车票被扛过去了。远路还得一步步走。');
  expect(bResult.victoryLine).not.toContain('手表');
  expect(bResult.victoryLine).not.toContain('新娘');
  expect(bResult.victoryLine).not.toContain('旧书');
  expect(bResult.victoryLine).not.toContain('自行车');
  expect(bResult.aftermathLine).toBe('今晚扛过去了，远路还得一步步走。');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

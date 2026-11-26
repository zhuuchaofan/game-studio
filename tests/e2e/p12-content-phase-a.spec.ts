import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  BOSS_PREVIEW_CONFIRM_BUTTON,
  CALENDAR_RETURN_BUTTON,
  DEMON_INTRO_BANNER_RECT,
  DIARY_CONTINUE_BUTTON,
  MORNING_OPTION_BUTTONS,
  PAWNSHOP_CALENDAR_BUTTON,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  TITLE_CONTINUE_BUTTON,
  TITLE_START_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const GLOSSARY_STORAGE_KEY = 'pawnshop-cards-glossary-v1';

interface PawnshopDebugState {
  phase: string;
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  day?: number;
  itemsOrder?: string[];
  bossPreview?: {
    componentCount: number;
    finalHp: number;
    r1Shield: number;
    chargeThreshold: number;
    fragmentNames: string[];
    hpLine: string;
  } | null;
}

interface CalendarDebugState {
  active: boolean;
  bossHp: number;
  bossComponentCount: number;
  bossActiveItemIds: string[];
  bossFragmentNames: string[];
  bossChargeThreshold: number;
  bossPreviewText: string;
}

interface BattleDebugState {
  phase: string;
  round: number;
  playerHp: number;
  maxPlayerHp?: number;
  shield: number;
  renqing: number;
  demonHp: number;
  demonMaxHp?: number;
  demonShield?: number;
  isBoss?: boolean;
  bossComposedChargeThreshold?: number;
  bossComponentCount?: number;
  bossFragmentNames?: string[];
  demonIntroBannerText?: string;
  introBannerVisible?: boolean;
  endingLedger?: {
    returnedItems: string[];
    retainedItems: string[];
    bossFragmentItems: string[];
    pawnedItems: string[];
    lines: string[];
  } | null;
  hand: string[];
  handSlotXs?: number[];
  handSlotYs?: number[];
  deckCount: number;
  discardCount: number;
  result: string;
  resultView?: 'normal' | 'diary' | 'ending' | 'epilogue' | 'chapter_failed';
  isAnimating?: boolean;
}

const ALL_GLOSSARY_SEEN = JSON.stringify([
  'reputation',
  'renqing',
  'obsession',
  'charge_threshold',
  'debt_note',
]);

const NEW_BOSS_FRAGMENTS = [
  '布票的执念',
  '口琴的执念',
  '药箱的执念',
  '账本的执念',
  '铁箱的执念',
  '金表的执念',
] as const;

const NEW_ITEM_IDS = [
  'cloth_ticket',
  'harmonica',
  'medicine_box',
  'ledger',
  'tin_trunk',
  'gold_watch',
] as const;

const CARD_COSTS: Record<string, number> = {
  金表: 2,
  秤砣: 1,
  口琴: 1,
  布票: 1,
  顶住: 1,
  飞驰: 2,
  余音: 1,
  算盘: 1,
  钢笔: 1,
  旧书: 1,
  当票: 0,
  药箱: 1,
  账本: 1,
};

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

async function waitForPawnshopPhase(
  page: Page,
  expected: string,
): Promise<PawnshopDebugState> {
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

async function playHandCardByName(
  page: Page,
  canvas: Locator,
  cardName: string,
): Promise<BattleDebugState> {
  const before = await waitForBattleReady(page, 'play');
  const idx = before.hand.indexOf(cardName);
  expect(idx, `expected card "${cardName}" in hand [${before.hand.join(', ')}]`).toBeGreaterThanOrEqual(0);
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

async function seedAndEnterDay2Battle(
  page: Page,
  canvas: Locator,
  opts: { seed: number; deck: string[]; currentHp?: number; shopLevel?: number },
): Promise<BattleDebugState> {
  await page.goto(`/?seed=${opts.seed}&demon=a`);
  await page.evaluate(
    ([saveKey, tutKey, glosKey, glosVal, saveJson]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(glosKey, glosVal);
      localStorage.setItem(saveKey, saveJson);
    },
    [
      SAVE_STORAGE_KEY,
      TUTORIAL_STORAGE_KEY,
      GLOSSARY_STORAGE_KEY,
      ALL_GLOSSARY_SEEN,
      JSON.stringify({
        version: 3,
        day: 2,
        money: 200,
        reputation: 0,
        deck: opts.deck,
        shopLevel: opts.shopLevel ?? 4,
        redeemTickets: 0,
        currentHp: opts.currentHp ?? 30,
        tutorialCompleted: true,
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
          pawnsCollected: opts.deck.length,
          demonsDefeated: 1,
          day4TrimDone: false,
          day6SideQuestDone: false,
        },
      }),
    ] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  await waitForBattleReady(page, 'play');
  await dismissBattleBannerIfPresent(page, canvas);
  return getBattleState(page);
}

test('P12 Phase A (a)+(b): daytime customer pool surfaces new items and buying adds corresponding new cards to deck', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // seed=13 Day 1 lineup: ['cloth_ticket', 'erhu', 'harmonica'] (high total 30+75+45 = 150 <= 240)
  await page.goto('/?seed=13');
  await page.evaluate(
    ([saveKey, tutKey, glosKey, glosVal]) => {
      localStorage.removeItem(saveKey);
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(glosKey, glosVal);
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY, ALL_GLOSSARY_SEEN] as const,
  );
  await page.reload();
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_START_BUTTON);

  const dayStart13 = await waitForPawnshopPhase(page, 'negotiating');
  expect(dayStart13.itemsOrder).toEqual(['cloth_ticket', 'erhu', 'harmonica']);

  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
    await waitForPawnshopPhase(page, 'feedback');
    await clickLogical(page, canvas, PAWNSHOP_FEEDBACK_NEXT_BUTTON);
  }
  const summary13 = await waitForPawnshopPhase(page, 'summary');
  expect(summary13.deck).toEqual(['布票', '余音', '口琴']);

  // seed=21 Day 1 lineup: ['bicycle', 'ledger', 'medicine_box'] -> skip 1st, buy ledger & medicine_box
  await page.goto('/?seed=21');
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

  const dayStart21 = await waitForPawnshopPhase(page, 'negotiating');
  expect(dayStart21.itemsOrder).toEqual(['bicycle', 'ledger', 'medicine_box']);

  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  for (let i = 0; i < 2; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
    await waitForPawnshopPhase(page, 'feedback');
    await clickLogical(page, canvas, PAWNSHOP_FEEDBACK_NEXT_BUTTON);
  }
  const summary21 = await waitForPawnshopPhase(page, 'summary');
  expect(summary21.deck).toEqual(['账本', '药箱']);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 Phase A (c): Day 7 Boss composition (>6 fragments), calendar preview, battle banner, and ending ledger include new items', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // Sub-case A: 8 components (watch, ring + all 6 new items) -> >6 compact branches across preview, calendar, banner
  await page.goto('/?seed=7&demon=boss_ch1');
  await page.evaluate(
    ([saveKey, tutKey, glosKey, glosVal]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(glosKey, glosVal);
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 7,
          money: 200,
          reputation: 3,
          deck: ['倒转', '守诺', '布票', '口琴', '药箱', '账本', '顶住', '金表'],
          shopLevel: 4,
          redeemTickets: 0,
          currentHp: 30,
          tutorialCompleted: true,
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
            day7FatherRedemptionDone: true,
            pawnedItemIds: [
              'watch',
              'ring',
              'cloth_ticket',
              'harmonica',
              'medicine_box',
              'ledger',
              'tin_trunk',
              'gold_watch',
            ],
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY, ALL_GLOSSARY_SEEN] as const,
  );
  await page.reload();

  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);

  const preview = await waitForPawnshopPhase(page, 'boss_preview');
  expect(preview.bossPreview).not.toBeNull();
  expect(preview.bossPreview?.componentCount).toBe(8);
  expect(preview.bossPreview?.finalHp).toBe(36);
  expect(preview.bossPreview?.r1Shield).toBe(4);
  expect(preview.bossPreview?.chargeThreshold).toBe(11);
  for (const frag of NEW_BOSS_FRAGMENTS) {
    expect(preview.bossPreview?.fragmentNames).toContain(frag);
  }
  await clickLogical(page, canvas, BOSS_PREVIEW_CONFIRM_BUTTON);

  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_CALENDAR_BUTTON);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(true);
  const cal = (await getCalendarState(page))!;
  expect(cal.bossComponentCount).toBe(8);
  expect(cal.bossHp).toBe(36);
  for (const itemId of NEW_ITEM_IDS) {
    expect(cal.bossActiveItemIds).toContain(itemId);
  }
  for (const frag of NEW_BOSS_FRAGMENTS) {
    expect(cal.bossFragmentNames).toContain(frag);
  }
  expect(cal.bossPreviewText).toContain('8件');
  expect(cal.bossPreviewText).toContain('36血');
  await clickLogical(page, canvas, CALENDAR_RETURN_BUTTON);
  await expect.poll(async () => (await getCalendarState(page))?.active).toBe(false);

  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  const bossStart = await waitForBattleReady(page, 'play');
  expect(bossStart.isBoss).toBe(true);
  expect(bossStart.bossComponentCount).toBe(8);
  expect(bossStart.demonMaxHp).toBe(36);
  expect(bossStart.demonShield).toBe(4);
  expect(bossStart.bossComposedChargeThreshold).toBe(11);
  for (const frag of NEW_BOSS_FRAGMENTS) {
    expect(bossStart.bossFragmentNames).toContain(frag);
  }
  expect(bossStart.demonIntroBannerText).toContain('·等8件');

  // Sub-case B: Defeat Boss with 4 new items in deck and verify ending ledger lists them
  await page.goto('/?seed=7&demon=boss_ch1');
  await page.evaluate(
    ([saveKey]) => {
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 3,
          day: 7,
          money: 200,
          reputation: 3,
          deck: ['布票', '口琴', '顶住', '金表', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣'],
          shopLevel: 4,
          redeemTickets: 0,
          currentHp: 30,
          tutorialCompleted: true,
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
            pawnsCollected: 4,
            demonsDefeated: 6,
            day4TrimDone: true,
            day6SideQuestDone: true,
            day7FatherRedemptionDone: true,
            pawnedItemIds: ['cloth_ticket', 'harmonica', 'tin_trunk', 'gold_watch'],
          },
        }),
      );
    },
    [SAVE_STORAGE_KEY] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'boss_preview');
  await clickLogical(page, canvas, BOSS_PREVIEW_CONFIRM_BUTTON);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  let state = await waitForBattleReady(page, 'play');
  await dismissBattleBannerIfPresent(page, canvas);
  state = await getBattleState(page);

  const attackPriority = ['金表', '秤砣', '口琴'] as const;
  let safety = 0;
  while (state.phase === 'play' && state.result === 'ongoing' && safety < 50) {
    safety += 1;
    let chosen: string | null = null;
    for (const name of attackPriority) {
      if (state.hand.includes(name) && state.renqing >= (CARD_COSTS[name] ?? 99)) {
        chosen = name;
        break;
      }
    }
    if (chosen) {
      state = await playHandCardByName(page, canvas, chosen);
    } else {
      const prevRound = state.round;
      await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return !s.isAnimating && (s.phase === 'result_scene' || s.round !== prevRound);
        })
        .toBe(true);
      state = await getBattleState(page);
    }
  }

  const winRes = await waitForBattleReady(page, 'result_scene');
  expect(winRes.result).toBe('win');
  expect(winRes.resultView).toBe('diary');
  expect(winRes.endingLedger?.bossFragmentItems).toEqual(['布票', '口琴', '铁皮箱', '金表']);

  await clickLogical(page, canvas, DIARY_CONTINUE_BUTTON);
  await expect.poll(async () => (await getBattleState(page)).resultView).toBe('ending');
  const ending = await getBattleState(page);
  const ledgerText = ending.endingLedger?.lines.join('\n') ?? '';
  expect(ledgerText).toContain('布票');
  expect(ledgerText).toContain('口琴');
  expect(ledgerText).toContain('铁皮箱');
  expect(ledgerText).toContain('金表');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 Phase A (d) part 1: 口琴 & 账本 conditional trigger vs non-trigger in battle', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // 1. 口琴 without another item card in hand -> 2 dmg (20 -> 18)
  const hNoItem = await seedAndEnterDay2Battle(page, canvas, {
    seed: 7,
    deck: ['口琴', '当票', '当票'],
  });
  expect(hNoItem.demonHp).toBe(20);
  const afterHNoItem = await playHandCardByName(page, canvas, '口琴');
  expect(afterHNoItem.demonHp).toBe(18);

  // 2. 口琴 with another item card (旧书) in hand -> 4 dmg (20 -> 16)
  const hWithItem = await seedAndEnterDay2Battle(page, canvas, {
    seed: 7,
    deck: ['口琴', '旧书', '当票'],
  });
  expect(hWithItem.demonHp).toBe(20);
  const afterHWithItem = await playHandCardByName(page, canvas, '口琴');
  expect(afterHWithItem.demonHp).toBe(16);

  // 3. 账本 without another item card in hand -> draw 1 (hand stays 5, deckCount 2 -> 1)
  // seed=2 places 账本 in opening 5-card hand for both 7-card decks
  const lNoItem = await seedAndEnterDay2Battle(page, canvas, {
    seed: 2,
    deck: ['账本', '钢笔', '钢笔', '钢笔', '钢笔', '钢笔', '钢笔'],
  });
  expect(lNoItem.hand).toContain('账本');
  expect(lNoItem.hand).toHaveLength(5);
  expect(lNoItem.deckCount).toBe(2);
  const afterLNoItem = await playHandCardByName(page, canvas, '账本');
  expect(afterLNoItem.hand).toHaveLength(5);
  expect(afterLNoItem.deckCount).toBe(1);

  // 4. 账本 with another item card (旧书) in hand -> draw 2 (hand 5 -> 6, deckCount 2 -> 0)
  const lWithItem = await seedAndEnterDay2Battle(page, canvas, {
    seed: 2,
    deck: ['账本', '旧书', '旧书', '旧书', '旧书', '钢笔', '钢笔'],
  });
  expect(lWithItem.hand).toContain('账本');
  expect(lWithItem.hand).toContain('旧书');
  expect(lWithItem.hand).toHaveLength(5);
  expect(lWithItem.deckCount).toBe(2);
  const afterLWithItem = await playHandCardByName(page, canvas, '账本');
  expect(afterLWithItem.hand).toHaveLength(6);
  expect(afterLWithItem.deckCount).toBe(0);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 Phase A (d) part 2: 顶住 shield condition, 金表 10/11 execute boundary, 药箱 heal cap 30, and 布票 draw+shield', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // 1. 顶住: 0 shield -> +4 (4), existing shield -> +7 (11)
  const shieldStart = await seedAndEnterDay2Battle(page, canvas, {
    seed: 7,
    deck: ['顶住', '顶住', '当票'],
  });
  expect(shieldStart.shield).toBe(0);
  const afterT1 = await playHandCardByName(page, canvas, '顶住');
  expect(afterT1.shield).toBe(4);
  const afterT2 = await playHandCardByName(page, canvas, '顶住');
  expect(afterT2.shield).toBe(11);

  // 2. 金表 enemy_hp_le=10 boundary: at 11 HP -> 5 dmg (11 -> 6)
  await seedAndEnterDay2Battle(page, canvas, {
    seed: 7,
    deck: ['金表', '飞驰', '余音'],
  });
  await playHandCardByName(page, canvas, '飞驰'); // 20 -> 14
  const at11 = await playHandCardByName(page, canvas, '余音'); // 14 -> 11 (+1 renqing)
  expect(at11.demonHp).toBe(11);
  const afterGold11 = await playHandCardByName(page, canvas, '金表');
  expect(afterGold11.demonHp).toBe(6);

  // 3. 金表 enemy_hp_le=10 boundary: at 10 HP -> 9 dmg (10 -> 1)
  await seedAndEnterDay2Battle(page, canvas, {
    seed: 7,
    deck: ['金表', '秤砣', '秤砣'],
  });
  await playHandCardByName(page, canvas, '秤砣'); // 20 -> 15
  const at10 = await playHandCardByName(page, canvas, '秤砣'); // 15 -> 10
  expect(at10.demonHp).toBe(10);
  const afterGold10 = await playHandCardByName(page, canvas, '金表');
  expect(afterGold10.demonHp).toBe(1);

  // 4. 药箱 heal 4 capped at 30 + 布票 draw 1 + shield 2
  const healStart = await seedAndEnterDay2Battle(page, canvas, {
    seed: 7,
    currentHp: 24,
    deck: ['药箱', '药箱', '布票', '当票', '当票'],
  });
  expect(healStart.playerHp).toBe(24);
  expect(healStart.maxPlayerHp).toBe(30);
  const afterMed1 = await playHandCardByName(page, canvas, '药箱');
  expect(afterMed1.playerHp).toBe(28);
  const afterMed2 = await playHandCardByName(page, canvas, '药箱');
  expect(afterMed2.playerHp).toBe(30);
  const afterCloth = await playHandCardByName(page, canvas, '布票');
  expect(afterCloth.shield).toBe(2);
  expect(afterCloth.hand).toHaveLength(3);
  expect(afterCloth.deckCount).toBe(1);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

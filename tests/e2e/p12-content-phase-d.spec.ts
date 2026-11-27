import { expect, test, type Page } from '@playwright/test';
import {
  LEDGER_CLOSE_BUTTON,
  LEDGER_COLLECTION_SCROLL_DOWN_BUTTON,
  LEDGER_COLLECTION_SCROLL_UP_BUTTON,
  LEDGER_DECK_NEXT_BUTTON,
  LEDGER_TAB_BUTTONS,
  MORNING_OPTION_BUTTONS,
  PAWNSHOP_LEDGER_BUTTON,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_LEDGER_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  REDEMPTION_ACCEPT_BUTTON,
  TITLE_CONTINUE_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const GLOSSARY_STORAGE_KEY = 'pawnshop-cards-glossary-v1';
const PAWN_PRICES_STORAGE_KEY = 'pawnshop-cards-pawn-prices-v1';

const ALL_GLOSSARY_SEEN = JSON.stringify([
  'reputation',
  'renqing',
  'obsession',
  'charge_threshold',
  'debt_note',
]);

interface LedgerDebugSnapshot {
  open: boolean;
  tab: 'deck' | 'heirlooms' | 'collection';
  deckPage: number;
  deckTotalPages: number;
  deckCardNames: string[];
  visibleDeckCardNames: string[];
  ownedHeirloomIds: string[];
  unownedHeirloomIds: string[];
  counts: {
    seenItemsCount: number;
    totalItems: number;
    seenCardsCount: number;
    totalCards: number;
    ownedHeirloomsCount: number;
    totalHeirlooms: number;
  };
  countBarText: string;
  visibleAftermaths: Record<string, string>;
  unlockedDiaryFragments: string[];
  diarySlots: { id: string; unlocked: boolean; text: string }[];
  collectionScrollY: number;
  collectionMaxScrollY: number;
}

interface PawnshopDebugState {
  phase: string;
  day?: number;
  deck: string[];
  itemsOrder?: string[];
  chapter?: {
    seenItems?: string[];
    seenCards?: string[];
    redeemedItems?: string[];
    diaryFragments?: string[];
    heirlooms?: string[];
  };
  ledger?: LedgerDebugSnapshot;
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

function buildSeededSave(opts: {
  day?: number;
  money?: number;
  reputation?: number;
  redeemTickets?: number;
  deck: string[];
  heirlooms?: string[];
  seenItems?: string[];
  seenCards?: string[];
  redeemedItems?: string[];
  diaryFragments?: string[];
  omitPhaseDFields?: boolean;
}): string {
  const day = opts.day ?? 2;
  const daysCleared: number[] = [];
  const daysVisited: number[] = [];
  for (let d = 1; d < day; d += 1) {
    daysCleared.push(d);
    daysVisited.push(d);
  }
  const chapter: Record<string, unknown> = {
    currentChapter: 1,
    dayInChapter: day,
    chapter1Completed: false,
    chapter1FailedCount: 0,
    status: 'in_progress',
    bossBattleActive: false,
    pactChoice: null,
    sideQuestChoice: null,
    daysCleared,
    daysVisited,
    pawnsCollected: opts.deck.length,
    demonsDefeated: day - 1,
    day4TrimDone: false,
    day6SideQuestDone: false,
    heirlooms: opts.heirlooms ?? [],
    heirloomMilestonesClaimed: [],
  };
  if (!opts.omitPhaseDFields) {
    chapter.seenItems = opts.seenItems ?? [];
    chapter.seenCards = opts.seenCards ?? [];
    chapter.redeemedItems = opts.redeemedItems ?? [];
    chapter.diaryFragments = opts.diaryFragments ?? [];
  }
  return JSON.stringify({
    version: 3,
    day,
    money: opts.money ?? 240,
    reputation: opts.reputation ?? 0,
    deck: opts.deck,
    shopLevel: 2,
    redeemTickets: opts.redeemTickets ?? 0,
    currentHp: 30,
    tutorialCompleted: true,
    chapter,
  });
}

async function seedAndContinue(
  page: Page,
  url: string,
  saveJson: string,
  pawnPricesJson?: string,
): Promise<void> {
  const canvas = page.locator('#game-container canvas');
  await page.goto(url);
  await page.evaluate(
    ([saveKey, tutKey, glossaryKey, pricesKey, save, glossary, prices]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(glossaryKey, glossary);
      localStorage.setItem(saveKey, save);
      if (prices) {
        localStorage.setItem(pricesKey, prices);
      } else {
        localStorage.removeItem(pricesKey);
      }
    },
    [
      SAVE_STORAGE_KEY,
      TUTORIAL_STORAGE_KEY,
      GLOSSARY_STORAGE_KEY,
      PAWN_PRICES_STORAGE_KEY,
      saveJson,
      ALL_GLOSSARY_SEEN,
      pawnPricesJson ?? '',
    ] as const,
  );
  await page.goto(url);
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await expect.poll(async () => (await getPawnshopState(page)).phase).not.toBe('title');
}

test('P12 阶段 D：账本覆层三页切换、9/14张牌库完整展示、老物件/收集/日谈/日记与模态收起', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  const nineCards = ['倒转', '守诺', '旧书', '飞驰', '余音', '集邮', '布票', '口琴', '药箱'];
  await seedAndContinue(
    page,
    '/?seed=5',
    buildSeededSave({
      day: 2,
      deck: nineCards,
      heirlooms: ['old_abacus', 'quilt'],
      seenItems: ['watch', 'ring', 'erhu'],
      seenCards: ['rewind', 'promise', 'echo'],
      redeemedItems: ['watch'],
      diaryFragments: ['first_clear'],
    }),
  );

  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'negotiating');

  // 1) 点击 HUD「账本」按钮打开覆层，默认在牌库 Tab，显示全部 9 张（无「等N张」截断）
  await clickLogical(page, canvas, PAWNSHOP_LEDGER_BUTTON);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.open).toBe(true);
  const deckState = await getPawnshopState(page);
  expect(deckState.ledger?.tab).toBe('deck');
  expect(deckState.ledger?.visibleDeckCardNames).toEqual(nineCards);

  // 打开期间点底层报价按钮区域（x=116, y=330 在覆层下方空白处）应关闭覆层而非触发报价
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.low);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.open).toBe(false);
  expect((await getPawnshopState(page)).phase).toBe('negotiating');

  // 重新打开并切到「老物件」Tab
  await clickLogical(page, canvas, PAWNSHOP_LEDGER_BUTTON);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.open).toBe(true);
  await clickLogical(page, canvas, LEDGER_TAB_BUTTONS.heirlooms);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.tab).toBe('heirlooms');
  const heirloomState = await getPawnshopState(page);
  expect(heirloomState.ledger?.ownedHeirloomIds).toEqual(['old_abacus', 'quilt']);
  expect(heirloomState.ledger?.unownedHeirloomIds).toHaveLength(5);

  // 切到「收集」Tab：计数行、日谈、日记 3 格、滚动按钮
  await clickLogical(page, canvas, LEDGER_TAB_BUTTONS.collection);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.tab).toBe('collection');
  const colState = await getPawnshopState(page);
  expect(colState.ledger?.countBarText).toBe('收集 3/12 | 牌 3/29 | 老物件 2/7');
  expect(colState.ledger?.visibleAftermaths).toEqual({
    watch: '父亲回来赎走了手表，说药费有着落了',
  });
  expect(colState.ledger?.diarySlots.map((s) => s.text)).toEqual([
    '腊月前的账总算平了',
    '未找到',
    '未找到',
  ]);
  expect(colState.ledger?.collectionMaxScrollY).toBeGreaterThan(0);
  await clickLogical(page, canvas, LEDGER_COLLECTION_SCROLL_DOWN_BUTTON);
  await expect
    .poll(async () => (await getPawnshopState(page)).ledger?.collectionScrollY ?? 0)
    .toBeGreaterThan(0);
  await clickLogical(page, canvas, LEDGER_COLLECTION_SCROLL_UP_BUTTON);
  await expect
    .poll(async () => (await getPawnshopState(page)).ledger?.collectionScrollY ?? -1)
    .toBe(0);

  // 点击右上角「×」关闭覆层
  await clickLogical(page, canvas, LEDGER_CLOSE_BUTTON);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.open).toBe(false);

  // 跳过 3 位当客进入日间结算页，测结算页「账本」按钮
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_LEDGER_BUTTON);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.open).toBe(true);
  await clickLogical(page, canvas, LEDGER_CLOSE_BUTTON);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.open).toBe(false);

  // 2) 14 张牌时验证牌库翻页无截断（保留未拥有旧物以便进入当客阶段）
  const fourteenCards = [
    '倒转',
    '守诺',
    '旧书',
    '飞驰',
    '余音',
    '集邮',
    '布票',
    '口琴',
    '药箱',
    '钢笔',
    '算盘',
    '秤砣',
    '手电',
    '铜镜',
  ];
  await seedAndContinue(
    page,
    '/?seed=5',
    buildSeededSave({
      day: 2,
      deck: fourteenCards,
      diaryFragments: ['own_10_cards'],
    }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_LEDGER_BUTTON);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.open).toBe(true);
  const page1 = await getPawnshopState(page);
  expect(page1.ledger?.deckTotalPages).toBe(2);
  expect(page1.ledger?.visibleDeckCardNames).toEqual(fourteenCards.slice(0, 12));
  await clickLogical(page, canvas, LEDGER_DECK_NEXT_BUTTON);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.deckPage).toBe(1);
  const page2 = await getPawnshopState(page);
  expect(page2.ledger?.visibleDeckCardNames).toEqual(fourteenCards.slice(12));

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 阶段 D：收集持久化（成交/赎当后重载仍在 + 赎当后日谈抽查 + 老存档兼容）', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // 1) 老存档（无 seenItems/seenCards/redeemedItems/diaryFragments）加载不判损坏，按空数组处理
  await seedAndContinue(
    page,
    '/?seed=3',
    buildSeededSave({
      day: 2,
      money: 240,
      redeemTickets: 1,
      deck: ['倒转'],
      omitPhaseDFields: true,
    }),
    JSON.stringify({ 倒转: [40] }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);

  // 第 2 天有 1 张赎当券 + 倒转，进入随机赎当页并接受赎当（watch）
  await waitForPawnshopPhase(page, 'redemption');
  await clickLogical(page, canvas, REDEMPTION_ACCEPT_BUTTON);
  const afterRedeem = await waitForPawnshopPhase(page, 'negotiating');
  expect(afterRedeem.chapter?.redeemedItems).toContain('watch');
  expect(afterRedeem.chapter?.seenItems).toContain('watch');

  // 高价收下第 1 位当客（必然成交）
  const firstCustomerItem = afterRedeem.itemsOrder![0];
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  await waitForPawnshopPhase(page, 'feedback');

  // 重载页面读档，验证 seenItems / seenCards / redeemedItems 持久保留
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  const reloaded = await waitForPawnshopPhase(page, 'negotiating');
  expect(reloaded.chapter?.redeemedItems).toContain('watch');
  expect(reloaded.chapter?.seenItems).toContain('watch');
  expect(reloaded.chapter?.seenItems).toContain(firstCustomerItem);
  expect((reloaded.chapter?.seenCards ?? []).length).toBeGreaterThanOrEqual(1);

  // 打开账本收集页抽查已赎旧物日谈
  await clickLogical(page, canvas, PAWNSHOP_LEDGER_BUTTON);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.open).toBe(true);
  await clickLogical(page, canvas, LEDGER_TAB_BUTTONS.collection);
  await expect.poll(async () => (await getPawnshopState(page)).ledger?.tab).toBe('collection');
  const colSnap = (await getPawnshopState(page)).ledger!;
  expect(colSnap.visibleAftermaths.watch).toBe('父亲回来赎走了手表，说药费有着落了');
  expect(colSnap.visibleAftermaths[firstCustomerItem]).toBeUndefined();

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

for (const vp of [
  { name: '390x844', width: 390, height: 844 },
  { name: '844x390', width: 844, height: 390 },
  { name: '800x500', width: 800, height: 500 },
]) {
  test(`P12 阶段 D：多尺寸视口 ${vp.name} 账本按钮与覆层无溢出/点击命中`, async ({ page }) => {
    const { pageErrors, failedRequests } = trackErrors(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const canvas = page.locator('#game-container canvas');

    await seedAndContinue(
      page,
      '/?seed=5',
      buildSeededSave({
        day: 2,
        deck: ['倒转', '守诺', '旧书', '飞驰', '余音', '集邮', '布票', '口琴'],
        heirlooms: ['old_abacus'],
        seenItems: ['watch', 'ring'],
        seenCards: ['rewind', 'promise'],
        redeemedItems: ['watch'],
        diaryFragments: ['first_clear'],
      }),
    );

    await waitForPawnshopPhase(page, 'morning');
    await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
    await waitForPawnshopPhase(page, 'negotiating');

    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW);

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-0.5);
    expect(box!.y).toBeGreaterThanOrEqual(-0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 0.5);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 0.5);

    await clickLogical(page, canvas, PAWNSHOP_LEDGER_BUTTON);
    await expect.poll(async () => (await getPawnshopState(page)).ledger?.open).toBe(true);
    await clickLogical(page, canvas, LEDGER_TAB_BUTTONS.collection);
    await expect.poll(async () => (await getPawnshopState(page)).ledger?.tab).toBe('collection');
    await clickLogical(page, canvas, LEDGER_CLOSE_BUTTON);
    await expect.poll(async () => (await getPawnshopState(page)).ledger?.open).toBe(false);

    expect(failedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

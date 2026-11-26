import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  DEMON_INTRO_BANNER_RECT,
  DIARY_CONTINUE_BUTTON,
  HEIRLOOM_BAR_SLOTS,
  HEIRLOOM_REPLACE_SKIP_BUTTON,
  HEIRLOOM_REPLACE_SLOTS,
  MORNING_OPTION_BUTTONS,
  PACT_OPTION_BUTTONS,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  TITLE_CONTINUE_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

const HEIRLOOMS = JSON.parse(readFileSync('src/data/heirlooms.json', 'utf-8')) as {
  id: string;
  name: string;
  shortLabel: string;
  effectText: string;
  story: string;
}[];

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const GLOSSARY_STORAGE_KEY = 'pawnshop-cards-glossary-v1';

const ALL_GLOSSARY_SEEN = JSON.stringify([
  'reputation',
  'renqing',
  'obsession',
  'charge_threshold',
  'debt_note',
]);

interface PawnshopDebugState {
  phase: string;
  money: number;
  reputation: number;
  deck: string[];
  day?: number;
  pactChoice?: string | null;
  heirlooms?: string[];
  heirloomMilestonesClaimed?: number[];
  heirloomBarVisible?: boolean;
  inspectedHeirloomId?: string | null;
  inspectedHeirloomText?: string | null;
  pendingHeirloomOffer?: { id: string; name: string; shortLabel: string; effectText: string } | null;
}

interface BattleDebugState {
  phase: string;
  round: number;
  playerHp: number;
  shield: number;
  renqing: number;
  demonHp: number;
  demonId: string;
  hand: string[];
  handSlotXs?: number[];
  handSlotYs?: number[];
  discardCount: number;
  result: string;
  resultView?: string;
  isAnimating?: boolean;
  introBannerVisible?: boolean;
  log?: string[];
  heirlooms?: string[];
  bossHeirloomDrop?: { id: string; name: string; shortLabel: string; effectText: string } | null;
  lastFloatSpawns?: { label: string; lane: string; startY: number; endY: number }[];
  savedData?: {
    deck: string[];
    chapter?: {
      heirlooms?: string[];
      heirloomMilestonesClaimed?: number[];
      pactChoice?: string | null;
      chapter1Completed?: boolean;
    };
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

function buildSeededSave(opts: {
  day?: number;
  money?: number;
  reputation?: number;
  currentHp?: number;
  deck: string[];
  shopLevel?: number;
  pactChoice?: string | null;
  day4TrimDone?: boolean;
  heirlooms?: string[];
  heirloomMilestonesClaimed?: number[];
}): string {
  const day = opts.day ?? 2;
  const daysCleared: number[] = [];
  const daysVisited: number[] = [];
  for (let d = 1; d < day; d += 1) {
    daysCleared.push(d);
    daysVisited.push(d);
  }
  return JSON.stringify({
    version: 3,
    day,
    money: opts.money ?? 240,
    reputation: opts.reputation ?? 0,
    deck: opts.deck,
    shopLevel: opts.shopLevel ?? 2,
    redeemTickets: 0,
    currentHp: opts.currentHp ?? 30,
    tutorialCompleted: true,
    chapter: {
      currentChapter: 1,
      dayInChapter: day,
      chapter1Completed: false,
      chapter1FailedCount: 0,
      status: 'in_progress',
      bossBattleActive: false,
      pactChoice: opts.pactChoice ?? null,
      sideQuestChoice: null,
      daysCleared,
      daysVisited,
      pawnsCollected: opts.deck.length,
      demonsDefeated: day - 1,
      day4TrimDone: opts.day4TrimDone ?? false,
      day6SideQuestDone: false,
      heirlooms: opts.heirlooms ?? [],
      heirloomMilestonesClaimed: opts.heirloomMilestonesClaimed ?? [],
    },
  });
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
  if (s.introBannerVisible === false) return;
  await clickLogical(page, canvas, {
    x: Math.floor(DEMON_INTRO_BANNER_RECT.x + DEMON_INTRO_BANNER_RECT.width / 2),
    y: Math.floor(DEMON_INTRO_BANNER_RECT.y + DEMON_INTRO_BANNER_RECT.height / 2),
  });
  await expect
    .poll(async () => (await getBattleState(page)).introBannerVisible)
    .toBe(false);
}

async function seedAndStartSavedDay(
  page: Page,
  canvas: Locator,
  url: string,
  saveJson: string,
): Promise<PawnshopDebugState> {
  await page.goto(url);
  await page.evaluate(
    ([saveKey, tutKey, glossaryKey, save, glossary]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(glossaryKey, glossary);
      localStorage.setItem(saveKey, save);
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY, saveJson, ALL_GLOSSARY_SEEN] as const,
  );
  await page.goto(url);
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await expect.poll(async () => (await getPawnshopState(page)).phase).not.toBe('title');
  return getPawnshopState(page);
}

async function enterNightFromSeededSave(
  page: Page,
  canvas: Locator,
  saveOpts: Parameters<typeof buildSeededSave>[0],
  url = '/?seed=7',
): Promise<BattleDebugState> {
  await seedAndStartSavedDay(page, canvas, url, buildSeededSave(saveOpts));
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  return waitForBattleReady(page, 'play');
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
          s.renqing !== before.renqing)
      );
    })
    .toBe(true);
  return getBattleState(page);
}

test('P12 阶段 C：7 件传家宝战斗效果逐一验证（含棉被开局回血飘字）', async ({ page }) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // 1. 老算盘 old_abacus
  await enterNightFromSeededSave(page, canvas, {
    day: 2,
    deck: ['手电', '余音', '钢笔', '钢笔', '钢笔'],
    heirlooms: ['old_abacus'],
  });
  await dismissBattleBannerIfPresent(page, canvas);
  const s1 = await playHandCardByName(page, canvas, '手电');
  expect(s1.renqing).toBe(4); // 4 - 1 + 1 = 4
  expect(s1.log?.some((l) => l.includes('老物件[老算盘]人情+1'))).toBe(true);

  // 2. 金招牌 gold_signboard
  await enterNightFromSeededSave(page, canvas, {
    day: 2,
    deck: ['守诺', '钢笔', '钢笔', '钢笔', '钢笔'],
    heirlooms: ['gold_signboard'],
  });
  await dismissBattleBannerIfPresent(page, canvas);
  const s2 = await playHandCardByName(page, canvas, '守诺');
  expect(s2.shield).toBe(6); // 5 + 1
  expect(s2.log?.some((l) => l.includes('老物件[金招牌]护盾+1'))).toBe(true);

  // 3. 老秤 old_scale
  await enterNightFromSeededSave(page, canvas, {
    day: 2,
    deck: ['守诺', '守诺', '守诺', '守诺', '守诺', '钢笔'],
    heirlooms: ['old_scale'],
  });
  await dismissBattleBannerIfPresent(page, canvas);
  const s3Before = await getBattleState(page);
  const s3 = await playHandCardByName(page, canvas, '守诺');
  expect(s3.hand.length).toBe(s3Before.hand.length); // -1 +1
  expect(s3.log?.some((l) => l.includes('老物件[老秤]抽1张牌'))).toBe(true);

  // 4. 棉被 quilt（含开局回血飘字）
  const s4 = await enterNightFromSeededSave(page, canvas, {
    day: 2,
    currentHp: 20,
    deck: ['钢笔', '钢笔', '钢笔', '钢笔', '钢笔'],
    heirlooms: ['quilt'],
  });
  expect(s4.playerHp).toBe(23);
  expect(s4.log?.some((l) => l.includes('老物件[棉被]回血+3'))).toBe(true);
  expect(s4.lastFloatSpawns?.some((f) => f.label === '回血+3')).toBe(true);

  // 5. 铜盘 copper_tray
  await enterNightFromSeededSave(page, canvas, {
    day: 2,
    deck: ['钢笔', '钢笔', '钢笔', '钢笔', '钢笔'],
    heirlooms: ['copper_tray'],
  });
  await dismissBattleBannerIfPresent(page, canvas);
  const s5Played = await playHandCardByName(page, canvas, '钢笔'); // 4 - 1 = 3 renqing left
  expect(s5Played.renqing).toBe(3);
  await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.round === 2;
    })
    .toBe(true);
  const s5After = await getBattleState(page);
  expect(s5After.playerHp).toBe(30); // 3*3 = 9 盾挡住心魔 B 2 伤
  expect(s5After.log?.some((l) => l.includes('老物件[铜盘]3人情换9盾'))).toBe(true);

  // 6. 纸灯 paper_lantern
  await enterNightFromSeededSave(page, canvas, {
    day: 2,
    deck: ['钢笔', '钢笔', '钢笔', '钢笔', '钢笔', '钢笔'],
    heirlooms: ['paper_lantern'],
  });
  await dismissBattleBannerIfPresent(page, canvas);
  const s6Before = await getBattleState(page);
  const s6 = await playHandCardByName(page, canvas, '钢笔');
  expect(s6.hand.length).toBe(s6Before.hand.length); // -1 +1
  expect(s6.log?.some((l) => l.includes('老物件[纸灯]抽1张牌'))).toBe(true);

  // 7. 旧报纸 old_newspaper
  const s7Start = await enterNightFromSeededSave(page, canvas, {
    day: 2,
    deck: ['当票', '当票', '钢笔', '钢笔', '钢笔'],
    heirlooms: ['old_newspaper'],
  });
  await dismissBattleBannerIfPresent(page, canvas);
  const ticketIdx = s7Start.hand.indexOf('当票');
  expect(ticketIdx).toBeGreaterThanOrEqual(0);
  await clickLogical(page, canvas, {
    x: s7Start.handSlotXs![ticketIdx],
    y: s7Start.handSlotYs![ticketIdx],
  });
  await expect.poll(async () => (await getBattleState(page)).isAnimating).toBe(false);
  const s7Choice = await getBattleState(page);
  const discardTargetIdx = s7Choice.hand.indexOf('钢笔');
  expect(discardTargetIdx).toBeGreaterThanOrEqual(0);
  await clickLogical(page, canvas, {
    x: s7Choice.handSlotXs![discardTargetIdx],
    y: s7Choice.handSlotYs![discardTargetIdx],
  });
  await expect.poll(async () => (await getBattleState(page)).shield).toBe(3);
  const s7After = await getBattleState(page);
  expect(s7After.log?.some((l) => l.includes('老物件[旧报纸]弃牌护盾+3'))).toBe(true);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 阶段 C：老物件栏(0/1/3件)、点击看说明、口碑≥3/≥5获取、第4天四选一与上限3件替换、不进牌组', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');
  const heirloomNamesAndIds = new Set<string>([
    ...HEIRLOOMS.map((h) => h.id),
    ...HEIRLOOMS.map((h) => h.name),
  ]);

  // 1) 0 件老物件栏 + 口碑 >=3 / >=5 里程碑获取
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=7',
    buildSeededSave({
      day: 2,
      money: 240,
      reputation: 2,
      deck: ['钢笔'],
      heirlooms: [],
      heirloomMilestonesClaimed: [],
    }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  const neg0 = await waitForPawnshopPhase(page, 'negotiating');
  expect(neg0.heirloomBarVisible).toBe(true);
  expect(neg0.heirlooms).toEqual([]);

  // 高价成交：口碑 2 -> 3，触发口碑里程碑 >=3
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  const fbRep3 = await waitForPawnshopPhase(page, 'feedback');
  expect(fbRep3.reputation).toBeGreaterThanOrEqual(3);
  expect(fbRep3.heirlooms).toHaveLength(1);
  expect(fbRep3.heirloomMilestonesClaimed).toContain(3);
  // 老物件不得进入牌组
  for (const card of fbRep3.deck) {
    expect(heirloomNamesAndIds.has(card)).toBe(false);
  }

  // 点击老物件栏第 1 槽位查看说明，再点关闭
  await clickLogical(page, canvas, HEIRLOOM_BAR_SLOTS[0]);
  await expect.poll(async () => (await getPawnshopState(page)).inspectedHeirloomId).toBe(
    fbRep3.heirlooms![0],
  );
  const inspected1 = await getPawnshopState(page);
  const expectedDef = HEIRLOOMS.find((h) => h.id === fbRep3.heirlooms![0])!;
  expect(inspected1.inspectedHeirloomText).toContain(expectedDef.name);
  expect(inspected1.inspectedHeirloomText).toContain(expectedDef.effectText);
  expect(inspected1.inspectedHeirloomText).toContain(expectedDef.story);
  await clickLogical(page, canvas, HEIRLOOM_BAR_SLOTS[0]);
  await expect.poll(async () => (await getPawnshopState(page)).inspectedHeirloomId).toBeNull();

  // 下一位继续高价成交，推高口碑到 >=5 触发第二档里程碑
  await clickLogical(page, canvas, PAWNSHOP_FEEDBACK_NEXT_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  const fbRep5 = await waitForPawnshopPhase(page, 'feedback');
  expect(fbRep5.heirlooms?.length).toBeGreaterThanOrEqual(1);

  // 显式在 rep=4 时验证 >=5 档触发一次、已领不重领
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=8',
    buildSeededSave({
      day: 2,
      money: 240,
      reputation: 4,
      deck: ['钢笔'],
      heirlooms: ['old_abacus'],
      heirloomMilestonesClaimed: [3],
    }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  const rep5After = await waitForPawnshopPhase(page, 'feedback');
  expect(rep5After.reputation).toBeGreaterThanOrEqual(5);
  expect(rep5After.heirlooms).toHaveLength(2);
  expect(rep5After.heirloomMilestonesClaimed).toEqual([3, 5]);

  // 2) 第 4 天四选一契约（4 槽位全在 640×360 内，选第 4 选项「老街人情」立得 1 件且存档可读）
  for (const slot of PACT_OPTION_BUTTONS) {
    expect(slot.x - slot.width / 2).toBeGreaterThanOrEqual(0);
    expect(slot.x + slot.width / 2).toBeLessThanOrEqual(640);
    expect(slot.y - slot.height / 2).toBeGreaterThanOrEqual(34);
    expect(slot.y + slot.height / 2).toBeLessThanOrEqual(360);
  }
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=9',
    buildSeededSave({
      day: 4,
      deck: ['钢笔'],
      pactChoice: null,
      day4TrimDone: true,
      heirlooms: ['old_abacus'],
      heirloomMilestonesClaimed: [3],
    }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'pact');
  await clickLogical(page, canvas, PACT_OPTION_BUTTONS[3]);
  const afterPact4 = await waitForPawnshopPhase(page, 'negotiating');
  expect(afterPact4.pactChoice).toBe('street_favor');
  expect(afterPact4.heirlooms).toHaveLength(2);
  for (const card of afterPact4.deck) {
    expect(heirloomNamesAndIds.has(card)).toBe(false);
  }

  // 重载页面读档，确认 street_favor 与老物件未判损坏且完整保留（当天已选过早上三选一，直接进 negotiating）
  await page.goto('/?seed=9');
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  const reloaded = await getPawnshopState(page);
  expect(reloaded.pactChoice).toBe('street_favor');
  expect(reloaded.heirlooms).toEqual(afterPact4.heirlooms);

  // 3) 持有上限 3 件：获得第 4 件进入替换面板 -> 验证跳过（暂不换）与替换（点第 1 槽）
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=10',
    buildSeededSave({
      day: 4,
      deck: ['钢笔'],
      pactChoice: null,
      day4TrimDone: true,
      heirlooms: ['old_abacus', 'gold_signboard', 'quilt'],
      heirloomMilestonesClaimed: [3, 5],
    }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'pact');
  await clickLogical(page, canvas, PACT_OPTION_BUTTONS[3]);
  const replaceState1 = await waitForPawnshopPhase(page, 'replace_heirloom');
  expect(replaceState1.pendingHeirloomOffer).not.toBeNull();
  const offeredId = replaceState1.pendingHeirloomOffer!.id;
  // 点选第 1 槽替换
  await clickLogical(page, canvas, HEIRLOOM_REPLACE_SLOTS[0]);
  const afterReplace = await waitForPawnshopPhase(page, 'negotiating');
  expect(afterReplace.heirlooms).toHaveLength(3);
  expect(afterReplace.heirlooms![0]).toBe(offeredId);
  expect(afterReplace.heirloomBarVisible).toBe(true);

  // 再测暂不换分支
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=10',
    buildSeededSave({
      day: 4,
      deck: ['钢笔'],
      pactChoice: null,
      day4TrimDone: true,
      heirlooms: ['old_abacus', 'gold_signboard', 'quilt'],
      heirloomMilestonesClaimed: [3, 5],
    }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'pact');
  await clickLogical(page, canvas, PACT_OPTION_BUTTONS[3]);
  await waitForPawnshopPhase(page, 'replace_heirloom');
  await clickLogical(page, canvas, HEIRLOOM_REPLACE_SKIP_BUTTON);
  const afterSkipReplace = await waitForPawnshopPhase(page, 'negotiating');
  expect(afterSkipReplace.heirlooms).toEqual(['old_abacus', 'gold_signboard', 'quilt']);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 阶段 C：Boss 胜掉落传家宝并与胜利奖励同屏显示', async ({ page }) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // 第 7 天高伤害牌组速杀 Boss
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=11',
    buildSeededSave({
      day: 7,
      money: 200,
      reputation: 2,
      shopLevel: 6,
      deck: ['秤砣', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣'],
      pactChoice: 'steady_shop',
      day4TrimDone: true,
      heirlooms: ['old_abacus'],
      heirloomMilestonesClaimed: [],
    }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'boss_preview');
  await clickLogical(page, canvas, { x: 320, y: 316 });
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  await waitForBattleReady(page, 'play');
  await dismissBattleBannerIfPresent(page, canvas);

  // R1 出完 5 张秤砣 (25伤) 后结束回合，R2 抽剩牌再出秤砣击破 30 血素体 Boss
  for (let i = 0; i < 12; i += 1) {
    const s = await waitForBattleReady(page, 'play').catch(() => null);
    if (!s || s.phase === 'result_scene') break;
    if (s.hand.includes('秤砣') && s.renqing >= 1) {
      await playHandCardByName(page, canvas, '秤砣');
    } else {
      const prevRound = s.round;
      await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
      await expect
        .poll(async () => {
          const cur = await getBattleState(page);
          return !cur.isAnimating && (cur.phase === 'result_scene' || cur.round !== prevRound);
        })
        .toBe(true);
    }
  }
  await expect.poll(async () => (await getBattleState(page)).phase).toBe('result_scene');

  const resultState = await getBattleState(page);
  expect(resultState.result).toBe('win');
  expect(resultState.resultView).toBe('diary');
  expect(resultState.bossHeirloomDrop).not.toBeNull();
  expect(resultState.savedData?.chapter?.chapter1Completed).toBe(true);
  expect(resultState.savedData?.chapter?.heirlooms).toHaveLength(2);
  expect(resultState.savedData?.chapter?.heirlooms).toContain(resultState.bossHeirloomDrop!.id);

  // 可继续点「翻到结局」
  await clickLogical(page, canvas, DIARY_CONTINUE_BUTTON);
  await expect.poll(async () => (await getBattleState(page)).resultView).toBe('ending');

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

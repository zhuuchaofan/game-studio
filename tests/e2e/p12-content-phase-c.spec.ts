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
  chapter?: {
    chapter1Completed?: boolean;
    status?: string;
    heirlooms?: string[];
  };
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
  bossDropNeedsReplace?: boolean;
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

test('P12 阶段 C：老物件栏(0/1/3件)、点击看说明、口碑≥2/≥4获取、第4天四选一与上限3件替换、不进牌组', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');
  const heirloomNamesAndIds = new Set<string>([
    ...HEIRLOOMS.map((h) => h.id),
    ...HEIRLOOMS.map((h) => h.name),
  ]);

  // 1) 0 件老物件栏 + 口碑 >=2 / >=4 两档里程碑连续获取
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=7',
    buildSeededSave({
      day: 2,
      money: 500,
      reputation: 1,
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

  // 高价成交：口碑 1 -> 2/3，触发第一档里程碑 >=2，得第 1 件老物件
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  const fbRep2 = await waitForPawnshopPhase(page, 'feedback');
  expect(fbRep2.reputation).toBeGreaterThanOrEqual(2);
  expect(fbRep2.reputation).toBeLessThan(4);
  expect(fbRep2.heirlooms).toHaveLength(1);
  expect(fbRep2.heirloomMilestonesClaimed).toEqual([2]);
  // 老物件不得进入牌组
  for (const card of fbRep2.deck) {
    expect(heirloomNamesAndIds.has(card)).toBe(false);
  }

  // 点击老物件栏第 1 槽位查看说明，再点关闭
  await clickLogical(page, canvas, HEIRLOOM_BAR_SLOTS[0]);
  await expect.poll(async () => (await getPawnshopState(page)).inspectedHeirloomId).toBe(
    fbRep2.heirlooms![0],
  );
  const inspected1 = await getPawnshopState(page);
  const expectedDef = HEIRLOOMS.find((h) => h.id === fbRep2.heirlooms![0])!;
  expect(inspected1.inspectedHeirloomText).toContain(expectedDef.name);
  expect(inspected1.inspectedHeirloomText).toContain(expectedDef.effectText);
  expect(inspected1.inspectedHeirloomText).toContain(expectedDef.story);
  await clickLogical(page, canvas, HEIRLOOM_BAR_SLOTS[0]);
  await expect.poll(async () => (await getPawnshopState(page)).inspectedHeirloomId).toBeNull();

  // 继续高价成交推高口碑到 >=4，触发第二档里程碑 >=4 再得第 2 件老物件
  let fbAfter = fbRep2;
  for (let i = 0; i < 2 && fbAfter.reputation < 4; i += 1) {
    await clickLogical(page, canvas, PAWNSHOP_FEEDBACK_NEXT_BUTTON);
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
    fbAfter = await waitForPawnshopPhase(page, 'feedback');
  }
  expect(fbAfter.reputation).toBeGreaterThanOrEqual(4);
  expect(fbAfter.heirlooms).toHaveLength(2);
  expect(fbAfter.heirloomMilestonesClaimed).toEqual([2, 4]);

  // 显式在 rep=3 时验证 >=4 档触发一次、已领不重领
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=8',
    buildSeededSave({
      day: 2,
      money: 240,
      reputation: 3,
      deck: ['钢笔'],
      heirlooms: ['old_abacus'],
      heirloomMilestonesClaimed: [2],
    }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  const rep4After = await waitForPawnshopPhase(page, 'feedback');
  expect(rep4After.reputation).toBeGreaterThanOrEqual(4);
  expect(rep4After.heirlooms).toHaveLength(2);
  expect(rep4After.heirloomMilestonesClaimed).toEqual([2, 4]);

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
      heirloomMilestonesClaimed: [2],
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
      heirloomMilestonesClaimed: [2, 4],
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
      heirloomMilestonesClaimed: [2, 4],
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

async function readStoredSave(page: Page): Promise<{
  money: number;
  reputation: number;
  deck: string[];
  chapter: {
    status: string;
    chapter1Completed: boolean;
    pactChoice: string | null;
    heirlooms?: string[];
    heirloomMilestonesClaimed?: number[];
  };
}> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), SAVE_STORAGE_KEY);
  expect(raw).not.toBeNull();
  return JSON.parse(raw!);
}

async function replayBossFromBossPreview(
  page: Page,
  canvas: Locator,
): Promise<BattleDebugState> {
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
  return getBattleState(page);
}

async function playSeededDay7ToBossResult(
  page: Page,
  canvas: Locator,
): Promise<BattleDebugState> {
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  return replayBossFromBossPreview(page, canvas);
}

test('P12 修整 2：满持有时契约与口碑触发待替换，刷新后不丢触发且可恢复完成替换/跳过', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');
  const initialThree = ['old_abacus', 'gold_signboard', 'quilt'];

  // 路径 A：第 4 天契约「老街人情」满持有触发替换面板 -> 刷新 -> 重做契约再次出面板 -> 替换
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=10',
    buildSeededSave({
      day: 4,
      deck: ['钢笔'],
      pactChoice: null,
      day4TrimDone: true,
      heirlooms: initialThree,
      heirloomMilestonesClaimed: [2, 4],
    }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'pact');
  await clickLogical(page, canvas, PACT_OPTION_BUTTONS[3]);
  const pactReplace1 = await waitForPawnshopPhase(page, 'replace_heirloom');
  expect(pactReplace1.pendingHeirloomOffer).not.toBeNull();
  const pactOfferId = pactReplace1.pendingHeirloomOffer!.id;

  // 在替换面板未解决前，磁盘不得包含已消耗的 pactChoice，且持有仍为原 3 件
  const diskBeforePactReload = await readStoredSave(page);
  expect(diskBeforePactReload.chapter.pactChoice).toBeNull();
  expect(diskBeforePactReload.chapter.heirlooms).toEqual(initialThree);

  // 刷新页面 -> 点「继续」回到第 4 天 pact -> 重做契约 -> 再次出现同一老物件替换面板
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'pact');
  await clickLogical(page, canvas, PACT_OPTION_BUTTONS[3]);
  const pactReplace2 = await waitForPawnshopPhase(page, 'replace_heirloom');
  expect(pactReplace2.pendingHeirloomOffer?.id).toBe(pactOfferId);

  // 完成第 1 槽替换 -> 恰得 1 件新老物件、不重复发放、磁盘落盘
  await clickLogical(page, canvas, HEIRLOOM_REPLACE_SLOTS[0]);
  const afterPactReplace = await waitForPawnshopPhase(page, 'negotiating');
  expect(afterPactReplace.pactChoice).toBe('street_favor');
  expect(afterPactReplace.heirlooms).toEqual([pactOfferId, 'gold_signboard', 'quilt']);
  const diskAfterPactReplace = await readStoredSave(page);
  expect(diskAfterPactReplace.chapter.pactChoice).toBe('street_favor');
  expect(diskAfterPactReplace.chapter.heirlooms).toEqual([pactOfferId, 'gold_signboard', 'quilt']);

  // 再刷新验证不会再次触发契约或重复发放
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  const pactSteady = await waitForPawnshopPhase(page, 'negotiating');
  expect(pactSteady.pactChoice).toBe('street_favor');
  expect(pactSteady.heirlooms).toEqual([pactOfferId, 'gold_signboard', 'quilt']);

  // 路径 B：口碑里程碑 >=2 满持有触发替换面板 -> 刷新 -> 重做成交再次出面板 -> 替换 & 再测跳过
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=12',
    buildSeededSave({
      day: 2,
      money: 300,
      reputation: 1,
      deck: ['钢笔'],
      heirlooms: initialThree,
      heirloomMilestonesClaimed: [],
    }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  const repReplace1 = await waitForPawnshopPhase(page, 'replace_heirloom');
  expect(repReplace1.pendingHeirloomOffer).not.toBeNull();
  const repOfferId = repReplace1.pendingHeirloomOffer!.id;

  // 在替换面板未解决前，磁盘不得写入已领取档位与成交后口碑
  const diskBeforeRepReload = await readStoredSave(page);
  expect(diskBeforeRepReload.reputation).toBe(1);
  expect(diskBeforeRepReload.chapter.heirloomMilestonesClaimed).toEqual([]);
  expect(diskBeforeRepReload.chapter.heirlooms).toEqual(initialThree);

  // 刷新后读档回到 negotiating，重做高价成交，面板再次出现同件老物件
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  const negAfterReload = await waitForPawnshopPhase(page, 'negotiating');
  expect(negAfterReload.reputation).toBe(1);
  expect(negAfterReload.heirloomMilestonesClaimed).toEqual([]);
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  const repReplace2 = await waitForPawnshopPhase(page, 'replace_heirloom');
  expect(repReplace2.pendingHeirloomOffer?.id).toBe(repOfferId);

  // 选择第 2 槽替换 -> 恰得 1 件新老物件且档位 [2] 落盘
  await clickLogical(page, canvas, HEIRLOOM_REPLACE_SLOTS[1]);
  const afterRepReplace = await waitForPawnshopPhase(page, 'feedback');
  expect(afterRepReplace.reputation).toBeGreaterThanOrEqual(2);
  expect(afterRepReplace.heirloomMilestonesClaimed).toEqual([2]);
  expect(afterRepReplace.heirlooms).toEqual(['old_abacus', repOfferId, 'quilt']);
  const diskAfterRepReplace = await readStoredSave(page);
  expect(diskAfterRepReplace.chapter.heirloomMilestonesClaimed).toEqual([2]);
  expect(diskAfterRepReplace.chapter.heirlooms).toEqual(['old_abacus', repOfferId, 'quilt']);

  // 补充验证口碑路径主动跳过（暂不换）：刷新重做后点暂不换，保留原 3 件且档位 [2] 已落盘不再重发
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=14',
    buildSeededSave({
      day: 2,
      money: 300,
      reputation: 1,
      deck: ['钢笔'],
      heirlooms: initialThree,
      heirloomMilestonesClaimed: [],
    }),
  );
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  await waitForPawnshopPhase(page, 'replace_heirloom');
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
  await waitForPawnshopPhase(page, 'replace_heirloom');
  await clickLogical(page, canvas, HEIRLOOM_REPLACE_SKIP_BUTTON);
  const afterRepSkip = await waitForPawnshopPhase(page, 'feedback');
  expect(afterRepSkip.heirlooms).toEqual(initialThree);
  expect(afterRepSkip.heirloomMilestonesClaimed).toEqual([2]);
  const diskAfterRepSkip = await readStoredSave(page);
  expect(diskAfterRepSkip.chapter.heirlooms).toEqual(initialThree);
  expect(diskAfterRepSkip.chapter.heirloomMilestonesClaimed).toEqual([2]);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 修整 3a：Boss 掉落满持有时刷新不丢进度，回第7天重打后可完成替换且不重复发放', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');
  const initialThree = ['old_abacus', 'gold_signboard', 'quilt'];

  // 路径 A：Boss 胜掉落满持有 -> 进入替换面板后刷新 -> 标题「继续」回到第 7 天 -> 重打 Boss -> 替换
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
      heirlooms: initialThree,
      heirloomMilestonesClaimed: [2, 4],
    }),
  );
  const bossRes1 = await playSeededDay7ToBossResult(page, canvas);
  expect(bossRes1.result).toBe('win');
  expect(bossRes1.resultView).toBe('diary');
  expect(bossRes1.bossHeirloomDrop).not.toBeNull();
  expect(bossRes1.savedData?.chapter?.heirlooms).toEqual(initialThree);
  const dropId = bossRes1.bossHeirloomDrop!.id;

  // 在处理替换前，磁盘不得提前把章节标记为已完成
  const diskBeforeBossReload = await readStoredSave(page);
  expect(diskBeforeBossReload.chapter.chapter1Completed).toBe(false);
  expect(diskBeforeBossReload.chapter.status).toBe('in_progress');
  expect(diskBeforeBossReload.chapter.heirlooms).toEqual(initialThree);

  // 点「替换老物件」进入替换面板后再刷新
  await clickLogical(page, canvas, { x: 192, y: DIARY_CONTINUE_BUTTON.y });
  await page.reload();
  const titleAfterBossReload = await waitForPawnshopPhase(page, 'title');
  expect(titleAfterBossReload.chapter?.chapter1Completed).toBe(false);
  expect(titleAfterBossReload.chapter?.status).toBe('in_progress');

  // 点标题「继续」回到第 7 天当铺（因为当天已选过早上工作，直接进 boss_preview）
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  const bossRes2 = await replayBossFromBossPreview(page, canvas);
  expect(bossRes2.bossDropNeedsReplace).toBe(true);
  expect(bossRes2.bossHeirloomDrop?.id).toBe(dropId);

  // 完成替换（点「替换老物件」-> 点第 1 槽）-> 回到日记页且章节完成落盘
  await clickLogical(page, canvas, { x: 192, y: DIARY_CONTINUE_BUTTON.y });
  await clickLogical(page, canvas, HEIRLOOM_REPLACE_SLOTS[0]);
  await expect.poll(async () => (await getBattleState(page)).savedData?.chapter?.chapter1Completed).toBe(true);
  const bossAfterReplace = await getBattleState(page);
  expect(bossAfterReplace.bossDropNeedsReplace).toBe(false);
  expect(bossAfterReplace.savedData?.chapter?.chapter1Completed).toBe(true);
  expect(bossAfterReplace.savedData?.chapter?.heirlooms).toEqual([dropId, 'gold_signboard', 'quilt']);
  const diskAfterBossReplace = await readStoredSave(page);
  expect(diskAfterBossReplace.chapter.chapter1Completed).toBe(true);
  expect(diskAfterBossReplace.chapter.status).toBe('completed');
  expect(diskAfterBossReplace.chapter.heirlooms).toEqual([dropId, 'gold_signboard', 'quilt']);

  // 再刷新确认进入已通关标题，不重复发放
  await page.reload();
  const titleCompleted1 = await waitForPawnshopPhase(page, 'title');
  expect(titleCompleted1.chapter?.chapter1Completed).toBe(true);
  expect(titleCompleted1.chapter?.heirlooms).toEqual([dropId, 'gold_signboard', 'quilt']);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('P12 修整 3b：Boss 掉落满持有时刷新不丢进度，回第7天重打后可跳过且不重复发放', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');
  const initialThree = ['old_abacus', 'gold_signboard', 'quilt'];

  // 路径 B：Boss 掉落满持有 -> 刷新 -> 回第 7 天重打 -> 日记页直接点「翻到结局」跳过
  await seedAndStartSavedDay(
    page,
    canvas,
    '/?seed=13',
    buildSeededSave({
      day: 7,
      money: 200,
      reputation: 2,
      shopLevel: 6,
      deck: ['秤砣', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣'],
      pactChoice: 'steady_shop',
      day4TrimDone: true,
      heirlooms: initialThree,
      heirloomMilestonesClaimed: [2, 4],
    }),
  );
  const bossSkipRes1 = await playSeededDay7ToBossResult(page, canvas);
  expect(bossSkipRes1.bossHeirloomDrop).not.toBeNull();
  expect((await readStoredSave(page)).chapter.chapter1Completed).toBe(false);

  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await replayBossFromBossPreview(page, canvas);

  // 在日记页点「翻到结局」跳过掉落并落盘完成
  await clickLogical(page, canvas, { x: 448, y: DIARY_CONTINUE_BUTTON.y });
  await expect.poll(async () => (await getBattleState(page)).resultView).toBe('ending');
  const bossAfterSkip = await getBattleState(page);
  expect(bossAfterSkip.heirlooms).toEqual(initialThree);
  const diskAfterBossSkip = await readStoredSave(page);
  expect(diskAfterBossSkip.chapter.chapter1Completed).toBe(true);
  expect(diskAfterBossSkip.chapter.status).toBe('completed');
  expect(diskAfterBossSkip.chapter.heirlooms).toEqual(initialThree);

  // 再刷新确认章节已完成，不再重复发放
  await page.reload();
  const titleCompleted2 = await waitForPawnshopPhase(page, 'title');
  expect(titleCompleted2.chapter?.chapter1Completed).toBe(true);
  expect(titleCompleted2.chapter?.heirlooms).toEqual(initialThree);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

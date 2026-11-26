import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  BATTLE_END_TURN_BUTTON,
  DEMON_INTRO_BANNER_RECT,
  HAND_SCROLL_ARROW_WIDTH,
  HAND_SCROLL_ARROW_Y,
  HAND_SLOT_STEP,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  TITLE_CONTINUE_BUTTON,
  TITLE_TUTORIAL_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

// 任务书 18：开局 240 钱、手牌横向滚动（方案 B）、牌组列表净空、等N张余数、「新手局」改名、版本号。
const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const GLOSSARY_STORAGE_KEY = 'pawnshop-cards-glossary-v1';
const SHOT_DIR = 'test-results/opening-layout';

const VIEWPORTS = [
  { name: 'portrait', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'desktop800', width: 800, height: 500 },
] as const;

const CARD_COST = new Map<string, number>(
  (JSON.parse(readFileSync('src/data/cards.json', 'utf-8')) as { name: string; cost: number }[]).map((c) => [
    c.name,
    c.cost,
  ]),
);

interface PawnshopDebugState {
  phase: string;
  money: number;
  deck: string[];
  version?: string;
  tutorialButtonLabel?: string;
  tutorialActive?: boolean;
  currentStep?: string | null;
  lastGlossaryTip?: string | null;
}

interface BattleDebugState {
  phase: string;
  round: number;
  renqing: number;
  hand: string[];
  handSlotXs?: number[];
  handSlotYs?: number[];
  handScroll?: number;
  handScrollMax?: number;
  introBannerVisible?: boolean;
  discardCount: number;
  isAnimating?: boolean;
}

function trackErrors(page: Page): { pageErrors: string[]; failedRequests: string[] } {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) =>
    failedRequests.push(`requestfailed ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`HTTP ${response.status()} ${response.url()}`);
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

async function waitForBattleReady(page: Page): Promise<BattleDebugState> {
  await expect
    .poll(async () => {
      try {
        const s = await getBattleState(page);
        return s.isAnimating ? 'animating' : s.phase;
      } catch {
        return null;
      }
    })
    .toBe('play');
  return getBattleState(page);
}

function day3Save(deck: string[], shopLevel: number): string {
  return JSON.stringify({
    version: 3,
    day: 3,
    money: 160,
    reputation: 5,
    deck,
    shopLevel,
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
      pawnsCollected: deck.length,
      demonsDefeated: 2,
      day4TrimDone: false,
      day6SideQuestDone: false,
    },
  });
}

async function seedSave(page: Page, saveJson: string): Promise<void> {
  await page.evaluate(
    ([saveKey, tutKey, glossaryKey, save]) => {
      localStorage.setItem(tutKey, '1');
      // 术语提示存档格式是「已见术语数组」；旧夹具写成对象会被当成空集，导致口碑提示条在白天流程里弹出
      localStorage.setItem(glossaryKey, JSON.stringify(['reputation', 'renqing', 'obsession', 'charge_threshold']));
      localStorage.setItem(saveKey, save);
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY, saveJson] as const,
  );
}

const ARROW_LEFT = { x: HAND_SCROLL_ARROW_WIDTH / 2, y: HAND_SCROLL_ARROW_Y };
const ARROW_RIGHT = { x: 640 - HAND_SCROLL_ARROW_WIDTH / 2, y: HAND_SCROLL_ARROW_Y };

async function waitScroll(page: Page, expected: number): Promise<BattleDebugState> {
  await expect.poll(async () => (await getBattleState(page)).handScroll).toBe(expected);
  return getBattleState(page);
}

/** 点两侧箭头把第 idx 张手牌滚进可点区域，返回滚动后的状态（槽位坐标已含滚动偏移）。 */
async function bringIntoView(page: Page, canvas: Locator, idx: number): Promise<BattleDebugState> {
  let s = await getBattleState(page);
  for (let i = 0; i < 12 && (s.handSlotXs![idx] < 40 || s.handSlotXs![idx] > 600); i += 1) {
    const prev = s.handScroll!;
    await clickLogical(page, canvas, s.handSlotXs![idx] < 40 ? ARROW_LEFT : ARROW_RIGHT);
    await expect.poll(async () => (await getBattleState(page)).handScroll).not.toBe(prev);
    s = await getBattleState(page);
  }
  return s;
}

async function dragHand(page: Page, canvas: Locator, fromX: number, toX: number): Promise<void> {
  const box = (await canvas.boundingBox())!;
  const px = (x: number): number => box.x + (x / 640) * box.width;
  const py = box.y + (HAND_SCROLL_ARROW_Y / 360) * box.height;
  await page.mouse.move(px(fromX), py);
  await page.mouse.down();
  await page.mouse.move(px((fromX + toX) / 2), py, { steps: 4 });
  await page.mouse.move(px(toX), py, { steps: 4 });
  await page.mouse.up();
}

async function settle(page: Page, prev: BattleDebugState): Promise<BattleDebugState> {
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return (
        !s.isAnimating &&
        (s.discardCount !== prev.discardCount || s.hand.length !== prev.hand.length || s.renqing !== prev.renqing)
      );
    })
    .toBe(true);
  return getBattleState(page);
}

/** 以 旧书(抽2)/算盘(情+2) 滚大手牌到至少 target 张；其余回合用结束回合续情。 */
async function growHandTo(page: Page, canvas: Locator, start: BattleDebugState, target: number): Promise<BattleDebugState> {
  let state = start;
  while (state.hand.length < target) {
    const abacusIdx = state.hand.indexOf('算盘');
    const bookIdx = state.hand.indexOf('旧书');
    const pickIdx = abacusIdx >= 0 && state.renqing >= 1 ? abacusIdx : bookIdx;
    if (pickIdx >= 0 && state.renqing >= 1) {
      state = await bringIntoView(page, canvas, pickIdx);
      await clickLogical(page, canvas, { x: state.handSlotXs![pickIdx], y: state.handSlotYs![pickIdx] });
      state = await settle(page, state);
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
  return state;
}

/**
 * 在页内解码 canvas 截图，对牌组列表某格测量「色条底缘 → 字墨顶缘」的逻辑净空。
 * 色条中心在格中心 y−14（高 2px）：从该行向下走过实心色条行，再找第一行深色字墨。
 */
async function measureDeckRowClearance(
  page: Page,
  canvas: Locator,
  centerX: number,
  centerY: number,
): Promise<{ clearance: number; scale: number } | null> {
  const buffer = await canvas.screenshot();
  return page.evaluate(
    async ([b64, cx, cy]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const scale = img.width / 640;
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const x0 = Math.round((cx - 40) * scale);
      const x1 = Math.round((cx + 40) * scale);
      const paperHex = [0xfb, 0xf6, 0xe9];
      const rowInfo = (py: number): { solidRatio: number; hasInk: boolean } => {
        const data = ctx.getImageData(x0, py, x1 - x0, 1).data;
        let solid = 0;
        let ink = false;
        const n = x1 - x0;
        for (let i = 0; i < n; i += 1) {
          const r = data[i * 4];
          const g = data[i * 4 + 1];
          const bl = data[i * 4 + 2];
          const lum = 0.3 * r + 0.59 * g + 0.11 * bl;
          if (lum < 110) ink = true;
          const dist = Math.abs(r - paperHex[0]) + Math.abs(g - paperHex[1]) + Math.abs(bl - paperHex[2]);
          if (dist > 60) solid += 1;
        }
        return { solidRatio: solid / n, hasInk: ink };
      };
      let py = Math.round((cy - 14) * scale);
      if (rowInfo(py).solidRatio < 0.9) return null; // 色条被遮挡或不存在
      while (rowInfo(py + 1).solidRatio >= 0.9) py += 1;
      const stripBottom = py + 1; // 色条底缘（物理像素边界）
      const limit = Math.round(cy * scale);
      let inkTop = -1;
      for (let y = stripBottom; y < limit; y += 1) {
        if (rowInfo(y).hasInk) {
          inkTop = y;
          break;
        }
      }
      if (inkTop < 0) return null;
      return { clearance: (inkTop - stripBottom) / scale, scale };
    },
    [buffer.toString('base64'), centerX, centerY] as const,
  );
}

test('Task 18 §2/§6/§7: new game starts with 240, title shows 新手局 button + v0.4.4-OpeningLayout, and 新手局 starts guided Day 1', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  await page.goto('/?seed=7');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.removeItem(saveKey);
      localStorage.removeItem(tutKey);
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const title = await waitForPawnshopPhase(page, 'title');
  expect(title.tutorialButtonLabel).toBe('新手局');
  expect(title.version).toBe('v0.4.4-OpeningLayout');
  await page.screenshot({ path: `${SHOT_DIR}/title.png` });

  await clickLogical(page, canvas, TITLE_TUTORIAL_BUTTON);
  const day1 = await waitForPawnshopPhase(page, 'negotiating');
  expect(day1.tutorialActive).toBe(true);
  expect(day1.currentStep).toBe('pawnshop_intro');
  expect(day1.money).toBe(240);
  await page.screenshot({ path: `${SHOT_DIR}/day1-hud-240.png` });

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

for (const vp of VIEWPORTS) {
  test(`Task 18 §4/§5/§8 ${vp.name}: Day 3 summary 7-card deck list keeps >=5px ink clearance on both rows with no glossary tip covering`, async ({
    page,
  }) => {
    const { pageErrors, failedRequests } = trackErrors(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/?seed=7');
    await seedSave(page, day3Save(['旧书', '飞驰', '集邮', '余音', '守诺', '算盘', '钢笔'], 3));
    await page.reload();
    const canvas = page.locator('#game-container canvas');
    await expect(canvas).toBeVisible();
    await waitForPawnshopPhase(page, 'title');
    await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
    for (let i = 0; i < 3; i += 1) {
      await waitForPawnshopPhase(page, 'negotiating');
      await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
    }
    const summary = await waitForPawnshopPhase(page, 'summary');
    expect(summary.deck).toHaveLength(7);
    // §8 回归：口碑术语提示条不在结算屏遮盖牌组列表（指针移开、提示未触发）
    expect(summary.lastGlossaryTip ?? null).toBeNull();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    await canvas.screenshot({ path: `${SHOT_DIR}/summary-7cards-${vp.name}.png` });

    // 第 3 天风声版：第一行 y=159、第二行 y=194；左列 x=144。口碑提示条若盖住第二行会让色条测量失败
    for (const rowY of [159, 194]) {
      const m = await measureDeckRowClearance(page, canvas, 144, rowY);
      expect(m, `row y=${rowY} strip/ink not measurable (covered?)`).not.toBeNull();
      // 竖屏 0.61× 下取整会少 1 个物理像素，容差 1/scale 逻辑像素
      expect(m!.clearance).toBeGreaterThanOrEqual(5 - 1 / m!.scale);
    }
    expect(failedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test('Task 18 §3 (plan B): 7/9/11-card hand scrolls at fixed 104 spacing, every card readable across 3 viewports, tap/drag/arrow/wheel work', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { pageErrors, failedRequests } = trackErrors(page);
  await page.goto('/?seed=7&demon=c');
  // 长效果行：倒转「血回上回」、手电「下回+1情」、集邮「抽1情+1」、余音「伤3情+1」、蒲扇「盾3抽1」
  const deck = [
    '旧书', '旧书', '旧书', '旧书', '算盘', '算盘', '算盘', '倒转', '手电', '集邮', '余音', '蒲扇', '铁皮青蛙', '守诺', '守诺',
  ];
  await seedSave(page, day3Save(deck, 4));
  await page.reload();
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);
  let state = await waitForBattleReady(page);
  await clickLogical(page, canvas, {
    x: Math.floor(DEMON_INTRO_BANNER_RECT.x + DEMON_INTRO_BANNER_RECT.width / 2),
    y: Math.floor(DEMON_INTRO_BANNER_RECT.y + DEMON_INTRO_BANNER_RECT.height / 2),
  });
  await expect.poll(async () => (await getBattleState(page)).introBannerVisible).toBe(false);
  state = await getBattleState(page);

  for (const target of [7, 9, 11]) {
    state = await growHandTo(page, canvas, state, target);
    expect(state.hand.length).toBeGreaterThanOrEqual(target);
    expect(state.handScrollMax!).toBeGreaterThan(0);
    // 槽位间距永为 104、不转动不压缩（滚动偏移相同，故屏幕间距也是 104）
    for (let i = 1; i < state.hand.length; i += 1) {
      expect(state.handSlotXs![i] - state.handSlotXs![i - 1]).toBe(HAND_SLOT_STEP);
    }

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(150);
      // 回到最左，逐档点右箭头滚到最右，截图覆盖全部牌面：每张牌都在某一档完整可读
      while ((await getBattleState(page)).handScroll! > 0) {
        const prev = (await getBattleState(page)).handScroll!;
        await clickLogical(page, canvas, ARROW_LEFT);
        await expect.poll(async () => (await getBattleState(page)).handScroll).toBeLessThan(prev);
      }
      let step = 0;
      for (;;) {
        const cur = await getBattleState(page);
        const atEnd = cur.handScroll! >= cur.handScrollMax!;
        if (step % 2 === 0 || atEnd) {
          await canvas.screenshot({ path: `${SHOT_DIR}/hand-${target}-${vp.name}-n${state.hand.length}-s${step}.png` });
        }
        if (atEnd) break;
        await clickLogical(page, canvas, ARROW_RIGHT);
        await expect.poll(async () => (await getBattleState(page)).handScroll).toBeGreaterThan(cur.handScroll!);
        step += 1;
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    // 拖动：从最右向左回拖 150px，滚动量变化、手牌不出（<6px 才算点按）
    const before = await getBattleState(page);
    await dragHand(page, canvas, 150, 300);
    const dragged = await getBattleState(page);
    const expectedDragScroll = Math.max(0, before.handScroll! - 150);
    expect(dragged.handScroll!).toBeLessThan(before.handScroll!);
    expect(Math.abs(dragged.handScroll! - expectedDragScroll)).toBeLessThanOrEqual(4);
    expect(dragged.hand).toEqual(before.hand);
    expect(dragged.discardCount).toBe(before.discardCount);
    // 滚轮
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + (288 / 360) * box.height);
    await page.mouse.wheel(0, HAND_SLOT_STEP);
    const wheeled = await waitScroll(page, Math.min(dragged.handScrollMax!, dragged.handScroll! + HAND_SLOT_STEP));
    expect(wheeled.hand).toEqual(before.hand);
    // 点按：费用够的最右侧一张，必须出牌成功（箭头滚入可点区域后点按）
    const idx = state.hand.map((n, i) => ({ n, i })).filter(({ n }) => (CARD_COST.get(n) ?? 9) <= state.renqing).pop();
    if (idx) {
      const view = await bringIntoView(page, canvas, idx.i);
      await clickLogical(page, canvas, { x: view.handSlotXs![idx.i], y: view.handSlotYs![idx.i] });
      state = await settle(page, view);
      expect(state.renqing !== view.renqing || state.hand.length !== view.hand.length).toBe(true);
    }
  }
  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

import { expect, test, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  BATTLE_HAND_Y,
  computeHandCardX,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  RESULT_NEXT_DAY_BUTTON,
  TITLE_START_BUTTON,
} from '../../src/game/layout';
import { BASE_HEIGHT, BASE_WIDTH, calculateScaledDimensions } from '../../src/utils/scale';
import { clickLogical, waitForPhaserInputFlush } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const GLOSSARY_STORAGE_KEY = 'pawnshop-cards-glossary-v1';

async function getPawnshopPhase(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => { phase: string } } })
      .__PAWNSHOP_DEBUG__;
    return hook?.getState().phase ?? null;
  });
}

async function getBattleState(page: Page): Promise<{
  phase: string;
  round: number;
  hand: string[];
  handSlotXs?: number[];
  isAnimating?: boolean;
  result: string;
  renqing: number;
} | null> {
  return page.evaluate(() => {
    const hook = (
      window as unknown as {
        __BATTLE_DEBUG__?: {
          getState: () => {
            phase: string;
            round: number;
            hand: string[];
            handSlotXs?: number[];
            isAnimating?: boolean;
            result: string;
            renqing: number;
          };
        };
      }
    ).__BATTLE_DEBUG__;
    return hook ? hook.getState() : null;
  });
}

for (const vp of [
  { width: 1920, height: 1024 },
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
]) {
  test(`scaling & click accuracy at ${vp.width}x${vp.height} (Title -> Pawnshop -> Battle -> Result)`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('requestfailed', (req) =>
      failedRequests.push(`requestfailed ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`),
    );
    page.on('response', (res) => {
      if (res.status() >= 400) {
        failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
      }
    });

    await page.setViewportSize(vp);
    await page.goto('/?seed=4&demon=a');
    await page.evaluate(
      ([saveKey, tutKey, glosKey]) => {
        localStorage.removeItem(saveKey);
        localStorage.setItem(tutKey, '1');
        localStorage.setItem(
          glosKey,
          JSON.stringify(['reputation', 'renqing', 'obsession', 'charge_threshold']),
        );
      },
      [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY] as const,
    );
    await page.reload();

    const canvas = page.locator('#game-container canvas');
    await expect(canvas).toBeVisible();

    const expected = calculateScaledDimensions(vp.width, vp.height);
    await expect
      .poll(async () => {
        const box = await canvas.boundingBox();
        return box ? { width: box.width, height: box.height } : null;
      })
      .toEqual({ width: expected.width, height: expected.height });

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);

    // 1. Title Start button
    await expect.poll(() => getPawnshopPhase(page)).toBe('title');
    await clickLogical(page, canvas, TITLE_START_BUTTON);
    await expect.poll(() => getPawnshopPhase(page)).toBe('negotiating');

    // 2. Pawnshop: buy first item on high tier, skip remaining 2, enter battle
    await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
    await expect.poll(() => getPawnshopPhase(page)).toBe('feedback');
    await clickLogical(page, canvas, PAWNSHOP_FEEDBACK_NEXT_BUTTON);
    for (let i = 0; i < 2; i += 1) {
      await expect.poll(() => getPawnshopPhase(page)).toBe('negotiating');
      await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
    }
    await expect.poll(() => getPawnshopPhase(page)).toBe('summary');
    await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

    // 3. Battle: play 1 card & end turns until result_scene, then click Result button
    await expect
      .poll(async () => {
        const s = await getBattleState(page);
        return s?.phase === 'play' && !s.isAnimating;
      })
      .toBe(true);

    const battleStart = (await getBattleState(page))!;
    const firstX = battleStart.handSlotXs?.[0] ?? computeHandCardX(0, battleStart.hand.length);
    await clickLogical(page, canvas, { x: firstX, y: BATTLE_HAND_Y });
    await expect
      .poll(async () => {
        const s = await getBattleState(page);
        return Boolean(s && !s.isAnimating && s.hand.length < battleStart.hand.length);
      })
      .toBe(true);

    for (let r = 0; r < 4; r += 1) {
      const cur = await getBattleState(page);
      if (!cur || cur.phase === 'result_scene') {
        break;
      }
      await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return Boolean(s && !s.isAnimating && (s.phase === 'result_scene' || s.round > cur.round));
        })
        .toBe(true);
    }

    await expect.poll(async () => (await getBattleState(page))?.phase).toBe('result_scene');

    // 4. Result scene: click "下一天" button -> returns to Day 2 PawnshopScene
    await clickLogical(page, canvas, RESULT_NEXT_DAY_BUTTON);
    await expect.poll(() => getPawnshopPhase(page)).toBe('negotiating');

    expect(failedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test('1920x1024 independent screen-coordinate click verification WITHOUT clickLogical (§7.3)', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('requestfailed', (req) =>
    failedRequests.push(`requestfailed ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });

  await page.setViewportSize({ width: 1920, height: 1024 });
  await page.goto('/?seed=4&demon=a');
  await page.evaluate(
    ([saveKey, tutKey, glosKey]) => {
      localStorage.removeItem(saveKey);
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        glosKey,
        JSON.stringify(['reputation', 'renqing', 'obsession', 'charge_threshold']),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY] as const,
  );
  await page.reload();

  // Compute screen coordinates strictly from window.innerWidth/innerHeight & integer scale formula
  // (bypassing canvas.boundingBox() and clickLogical completely)
  const clickViaViewportFormula = async (logicalPt: { x: number; y: number }): Promise<void> => {
    await waitForPhaserInputFlush(page);
    const pt = await page.evaluate(
      ({ lx, ly, baseW, baseH }) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const scale = Math.max(1, Math.floor(Math.min(vw / baseW, vh / baseH)));
        const canvasW = baseW * scale;
        const canvasH = baseH * scale;
        const left = (vw - canvasW) / 2;
        const top = (vh - canvasH) / 2;
        return {
          clientX: left + (lx / baseW) * canvasW,
          clientY: top + (ly / baseH) * canvasH,
          scale,
          canvasW,
          canvasH,
        };
      },
      { lx: logicalPt.x, ly: logicalPt.y, baseW: BASE_WIDTH, baseH: BASE_HEIGHT },
    );
    expect(pt.scale).toBe(2);
    expect(pt.canvasW).toBe(1280);
    expect(pt.canvasH).toBe(720);
    await page.mouse.click(pt.clientX, pt.clientY);
  };

  await expect.poll(() => getPawnshopPhase(page)).toBe('title');
  await clickViaViewportFormula(TITLE_START_BUTTON);
  await expect.poll(() => getPawnshopPhase(page)).toBe('negotiating');
  await page.screenshot({ path: 'test-results/scaling-1920x1024-pawnshop.png' });

  await clickViaViewportFormula(PAWNSHOP_TIER_BUTTONS.high);
  await expect.poll(() => getPawnshopPhase(page)).toBe('feedback');
  await clickViaViewportFormula(PAWNSHOP_FEEDBACK_NEXT_BUTTON);
  for (let i = 0; i < 2; i += 1) {
    await expect.poll(() => getPawnshopPhase(page)).toBe('negotiating');
    await clickViaViewportFormula(PAWNSHOP_SKIP_BUTTON);
  }
  await expect.poll(() => getPawnshopPhase(page)).toBe('summary');
  await clickViaViewportFormula(PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return s?.phase === 'play' && !s.isAnimating;
    })
    .toBe(true);
  await page.screenshot({ path: 'test-results/scaling-1920x1024-battle.png' });

  const battleStart = (await getBattleState(page))!;
  const cardX = battleStart.handSlotXs?.[0] ?? computeHandCardX(0, battleStart.hand.length);
  await clickViaViewportFormula({ x: cardX, y: BATTLE_HAND_Y });
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return Boolean(s && !s.isAnimating && s.hand.length < battleStart.hand.length);
    })
    .toBe(true);

  await clickViaViewportFormula(BATTLE_END_TURN_BUTTON);
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return Boolean(s && !s.isAnimating && s.round === 2);
    })
    .toBe(true);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  BATTLE_HAND_Y,
  computeHandCardX,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  TITLE_CONTINUE_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';

interface PawnshopDebugState {
  phase: 'title' | 'redemption' | 'negotiating' | 'feedback' | 'summary';
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  itemsOrder?: string[];
  tutorialActive?: boolean;
  currentStep?: string | null;
}

interface BattleDebugState {
  phase: string;
  hand: string[];
  renqing: number;
  pendingChoice?: { kind: string; sourceCardName: string; prompt: string } | null;
  isAnimating?: boolean;
}

const HAND_Y = BATTLE_HAND_Y;

const BUTTONS = {
  titleContinue: TITLE_CONTINUE_BUTTON,
  tierHigh: PAWNSHOP_TIER_BUTTONS.high,
  skipCustomer: PAWNSHOP_SKIP_BUTTON,
  nextOrSummary: PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  enterNightBattle: PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  cancelChoice: BATTLE_END_TURN_BUTTON,
} as const;

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

async function maybeSaveShot(page: Page, filename: string): Promise<void> {
  const dir = process.env.P8_SHOTS_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, filename) });
}

test('P8 Fix 1: 当票 pending-choice prompt displays cleanly below card detail panel without overlap', async ({
  page,
}) => {
  await page.goto('/?seed=7');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 2,
          day: 1,
          money: 200,
          reputation: 0,
          deck: ['当票', '旧书', '钢笔', '守诺', '秤砣'],
          shopLevel: 1,
          redeemTickets: 0,
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

  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  const battleStart = await waitForBattleReady(page, 'play');
  const ticketIdx = battleStart.hand.indexOf('当票');
  expect(ticketIdx).toBeGreaterThanOrEqual(0);

  await clickLogical(page, canvas, {
    x: computeHandCardX(ticketIdx, battleStart.hand.length),
    y: HAND_Y,
  });

  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.pendingChoice !== null;
    })
    .toBe(true);

  const choosing = await getBattleState(page);
  expect(choosing.pendingChoice?.sourceCardName).toBe('当票');
  expect(choosing.pendingChoice?.prompt).toBe('选1张手牌弃掉');

  // Move mouse away from cards so screenshot captures clean resting choice state
  await page.mouse.move(10, 10);
  await page.waitForTimeout(100);
  await maybeSaveShot(page, '01-battle-pending-choice.png');

  // Cancel choice works cleanly via the right-hand button
  await clickLogical(page, canvas, BUTTONS.cancelChoice);
  await expect
    .poll(async () => (await getBattleState(page)).pendingChoice)
    .toBeNull();
});

test('P8 Fix 2: all 6 item deal feedback stories wrap inside settlement panel and clear 3/6 tutorial bubble', async ({
  page,
}) => {
  const seenItems = new Set<string>();
  const canvas = page.locator('#game-container canvas');

  // seed=2 covers [old_book, erhu, stamp_album]; seed=4 covers [watch, bicycle, ring]
  const runs: readonly { seed: number; enableTutorial: boolean }[] = [
    { seed: 2, enableTutorial: false },
    { seed: 4, enableTutorial: false },
    { seed: 10, enableTutorial: true }, // stamp_album first with 3/6 tutorial bubble active
  ];

  for (const run of runs) {
    await page.goto(`/?seed=${run.seed}`);
    await page.evaluate(
      ([saveKey, tutKey, enableTut]) => {
        if (enableTut) {
          localStorage.removeItem(tutKey);
        } else {
          localStorage.setItem(tutKey, '1');
        }
        localStorage.setItem(
          saveKey,
          JSON.stringify({
            version: 2,
            day: 1,
            money: 500,
            reputation: 0,
            deck: [],
            shopLevel: 1,
            redeemTickets: 0,
          }),
        );
      },
      [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, run.enableTutorial] as const,
    );
    await page.reload();

    await expect(canvas).toBeVisible();
    await waitForPawnshopPhase(page, 'title');
    await clickLogical(page, canvas, BUTTONS.titleContinue);

    const firstState = await waitForPawnshopPhase(page, 'negotiating');
    const order = firstState.itemsOrder ?? [];
    const limit = run.enableTutorial ? 1 : order.length;

    for (let i = 0; i < limit; i += 1) {
      const itemId = order[i];
      await waitForPawnshopPhase(page, 'negotiating');
      // High tier has 100% acceptance so deal always closes
      await clickLogical(page, canvas, BUTTONS.tierHigh);
      const fb = await waitForPawnshopPhase(page, 'feedback');
      expect(fb.deck.length).toBeGreaterThanOrEqual(i + 1);

      if (run.enableTutorial) {
        expect(fb.tutorialActive).toBe(true);
        expect(fb.currentStep).toBe('deal_card');
        await page.waitForTimeout(100);
        await maybeSaveShot(page, `04-feedback-${itemId}-with-tutorial-3of6.png`);
      } else {
        seenItems.add(itemId);
        await page.waitForTimeout(100);
        if (itemId === 'bicycle') {
          await maybeSaveShot(page, '02-feedback-bicycle.png');
        } else if (itemId === 'stamp_album') {
          await maybeSaveShot(page, '03-feedback-stamp-album.png');
        } else {
          await maybeSaveShot(page, `05-feedback-${itemId}.png`);
        }
        await clickLogical(page, canvas, BUTTONS.nextOrSummary);
      }
    }
  }

  expect([...seenItems].sort()).toEqual([
    'bicycle',
    'erhu',
    'old_book',
    'ring',
    'stamp_album',
    'watch',
  ]);
});

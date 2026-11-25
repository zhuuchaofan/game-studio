import { expect, test, type Page } from '@playwright/test';
import { clickLogical, LOGICAL_WIDTH } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const CORRUPT_SAVE_STORAGE_KEY = 'pawnshop-cards-save-corrupt-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';

interface AudioDebugState {
  muted: boolean;
  currentTrack: 'day' | 'night' | null;
  isPlayingBgm: boolean;
  sfxCounts: Record<string, number>;
}

interface PawnshopDebugState {
  phase: 'title' | 'redemption' | 'negotiating' | 'feedback' | 'summary';
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  currentTemperament?: string | null;
  currentTemperamentLabel?: string | null;
  lastMessage?: string | null;
  corruptSaveQuarantined?: boolean;
}

interface BattleDebugState {
  phase: string;
  round: number;
  playerHp: number;
  shield: number;
  renqing: number;
  demonHp: number;
  hand: string[];
  discardCount: number;
  pendingChoice?: { kind: string; sourceCardName: string; prompt: string } | null;
  isAnimating?: boolean;
}

const CARD_WIDTH = 48;
const CARD_GAP = 4;
const HAND_MARGIN_X = 6;
const HAND_Y = 144;

const BUTTONS = {
  titleStart: { x: 160, y: 122 },
  titleContinue: { x: 160, y: 156 },
  redeemAccept: { x: 96, y: 151 },
  tierLow: { x: 58, y: 151 },
  tierHigh: { x: 262, y: 151 },
  skipCustomer: { x: 270, y: 107 },
  nextOrSummary: { x: 160, y: 151 },
  enterNightBattle: { x: 88, y: 151 },
  endTurn: { x: 283, y: 95 },
} as const;

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

async function getAudioState(page: Page): Promise<AudioDebugState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __AUDIO_DEBUG__?: { getState: () => AudioDebugState } })
      .__AUDIO_DEBUG__;
    return hook!.getState();
  });
}

test('P7 Sub-item 3: playing 当票 enters PendingChoice and discards the exact clicked non-leftmost card for +2 renqing', async ({
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
          deck: ['当票', '钢笔', '守诺', '旧书', '秤砣'],
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

  // Skip all 3 daytime customers so night battle starts with our exact 5-card deck containing 当票
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);

  const battleStart = await waitForBattleReady(page, 'play');
  expect(battleStart.hand).toHaveLength(5);
  const ticketIdx = battleStart.hand.indexOf('当票');
  expect(ticketIdx).toBeGreaterThanOrEqual(0);
  const initialRenqing = battleStart.renqing;

  // Click 当票 -> enters PendingChoice (4 remaining cards in hand, renqing not yet +2)
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
  expect(choosing.pendingChoice?.kind).toBe('discard');
  expect(choosing.pendingChoice?.sourceCardName).toBe('当票');
  expect(choosing.hand).toHaveLength(4);
  expect(choosing.renqing).toBe(initialRenqing);

  // Pick index 2 (NOT index 0!) to prove player chooses exact card to discard
  const targetIdx = 2;
  const chosenCardName = choosing.hand[targetIdx];
  const expectedRemaining = choosing.hand.filter((_, i) => i !== targetIdx);

  await clickLogical(page, canvas, {
    x: computeHandCardX(targetIdx, choosing.hand.length),
    y: HAND_Y - 3,
  });

  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return s.pendingChoice === null && s.renqing === initialRenqing + 2;
    })
    .toBe(true);

  const afterChoice = await getBattleState(page);
  expect(afterChoice.hand).toEqual(expectedRemaining);
  expect(afterChoice.hand).not.toContain(chosenCardName);
  expect(afterChoice.discardCount).toBe(2);
  expect(afterChoice.renqing).toBe(initialRenqing + 2);
});

test('P7 Sub-item 2 & 4 & 5: temperament badges, 1987 dialogue, all 6 ZzFX SFX triggers & corrupt save quarantine', async ({
  page,
}) => {
  // 1. Corrupt save quarantine on TitleScene
  await page.goto('/?seed=10');
  await page.evaluate(
    ([saveKey, corruptKey, tutKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.removeItem(corruptKey);
      localStorage.setItem(saveKey, '{broken-save-json');
    },
    [SAVE_STORAGE_KEY, CORRUPT_SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  const titleState = await waitForPawnshopPhase(page, 'title');
  expect(titleState.corruptSaveQuarantined).toBe(true);
  const quarantined = await page.evaluate(
    (key) => localStorage.getItem(key),
    CORRUPT_SAVE_STORAGE_KEY,
  );
  expect(quarantined).toBe('{broken-save-json');

  // 2. Seed save with redeemTicket + 50 money to verify redeem_deal, temperament badge, insufficient_funds, offer_rejected
  await page.evaluate(
    ([saveKey]) => {
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 1, // Also proves v1 -> v2 migration works in live browser
          day: 1,
          money: 50,
          reputation: 0,
          deck: ['守诺', '钢笔', '秤砣'],
          shopLevel: 1,
          redeemTickets: 1,
        }),
      );
    },
    [SAVE_STORAGE_KEY] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);

  // Accept redemption -> triggers redeem_deal SFX
  await waitForPawnshopPhase(page, 'redemption');
  await clickLogical(page, canvas, BUTTONS.redeemAccept);
  const neg = await waitForPawnshopPhase(page, 'negotiating');
  expect(neg.currentTemperament).toBeTruthy();
  expect(['急用钱', '爱面子', '念旧']).toContain(neg.currentTemperamentLabel);
  expect((await getAudioState(page)).sfxCounts.redeem_deal).toBe(1);

  // seed=10 low offer on customer 1 (proud item) -> rejected -> triggers offer_rejected SFX + 1987 dialogue
  await clickLogical(page, canvas, BUTTONS.tierLow);
  const fb = await waitForPawnshopPhase(page, 'feedback');
  expect(fb.lastMessage).toBe('这价太寒碜人，我还得要脸面');
  expect((await getAudioState(page)).sfxCounts.offer_rejected).toBeGreaterThanOrEqual(1);

  // Also trigger insufficient_funds by seeding money=10 on seed=4 (watch low=20)
  await page.goto('/?seed=4');
  await page.evaluate(
    ([saveKey]) => {
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          version: 2,
          day: 1,
          money: 10,
          reputation: 0,
          deck: ['钢笔', '守诺', '秤砣', '暖水瓶', '相机'],
          shopLevel: 1,
          redeemTickets: 0,
        }),
      );
    },
    [SAVE_STORAGE_KEY] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, BUTTONS.titleContinue);
  const c1 = await waitForPawnshopPhase(page, 'negotiating');
  expect(c1.currentTemperament).toBe('urgent');
  expect(c1.currentTemperamentLabel).toBe('急用钱');

  // Click unaffordable High tier -> insufficient_funds SFX
  await clickLogical(page, canvas, BUTTONS.tierHigh);
  await expect
    .poll(async () => (await getAudioState(page)).sfxCounts.insufficient_funds)
    .toBeGreaterThanOrEqual(1);

  // Skip all 3 customers and enter night battle to verify hit_demon, shield_block, player_hurt SFX
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.skipCustomer);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  const bState = await waitForBattleReady(page, 'play');

  // Play 钢笔 (damage -> hit_demon) and 守诺 (shield -> shield_block)
  const penIdx = bState.hand.indexOf('钢笔');
  await clickLogical(page, canvas, { x: computeHandCardX(penIdx, bState.hand.length), y: HAND_Y });
  await expect
    .poll(async () => (await getAudioState(page)).sfxCounts.hit_demon)
    .toBeGreaterThanOrEqual(1);

  const afterPen = await waitForBattleReady(page, 'play');
  const shieldIdx = afterPen.hand.indexOf('守诺');
  await clickLogical(page, canvas, {
    x: computeHandCardX(shieldIdx, afterPen.hand.length),
    y: HAND_Y,
  });
  await expect
    .poll(async () => (await getAudioState(page)).sfxCounts.shield_block)
    .toBeGreaterThanOrEqual(1);

  // End Round 1 (shield 5 absorbs 3 dmg -> shield_block), then End Round 2 (0 shield -> player_hurt!)
  await waitForBattleReady(page, 'play');
  await clickLogical(page, canvas, BUTTONS.endTurn);
  await expect.poll(async () => (await getBattleState(page)).round).toBe(2);
  await waitForBattleReady(page, 'play');
  await clickLogical(page, canvas, BUTTONS.endTurn);
  await expect
    .poll(async () => (await getAudioState(page)).sfxCounts.player_hurt)
    .toBeGreaterThanOrEqual(1);
});

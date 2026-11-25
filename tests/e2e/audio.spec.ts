import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  BATTLE_HAND_Y,
  computeHandCardX,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  TITLE_START_BUTTON,
  TITLE_VOLUME_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const AUDIO_STORAGE_KEY = 'pawnshop-cards-audio-v1';

interface AudioDebugState {
  muted: boolean;
  volume: number;
  effectiveGain: number;
  currentTrack: 'day' | 'night' | null;
  unlocked: boolean;
  contextAvailable: boolean;
  isPlayingBgm: boolean;
  sfxLog: string[];
  audibleSfxCount: number;
  sfxCounts: Record<string, number>;
  lastSfx: string | null;
}

interface PawnshopDebugState {
  phase: 'title' | 'negotiating' | 'feedback' | 'summary';
}

interface BattleDebugState {
  phase: 'draw' | 'play' | 'demonAct' | 'roundEnd' | 'result' | 'empty_deck' | 'result_scene';
  round: number;
  renqing: number;
  hand: string[];
  discardCount: number;
  result: 'ongoing' | 'win' | 'lose_hp' | 'lose_timeout' | 'empty_deck';
  isAnimating?: boolean;
}

const BUTTONS = {
  titleStart: TITLE_START_BUTTON,
  titleVolume: TITLE_VOLUME_BUTTON,
  tierHigh: PAWNSHOP_TIER_BUTTONS.high,
  nextOrSummary: PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  enterNightBattle: PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  endTurn: BATTLE_END_TURN_BUTTON,
} as const;

const HAND_Y = BATTLE_HAND_Y;
const DAMAGE_PRIORITY = ['秤砣', '钢笔', '相机', '弹珠'] as const;
const UTILITY_PRIORITY = ['算盘', '旧书', '蒲扇'] as const;
const CARD_COSTS: Record<string, number> = {
  倒转: 2,
  守诺: 1,
  旧书: 1,
  算盘: 1,
  钢笔: 1,
  秤砣: 1,
  相机: 1,
  弹珠: 1,
  蒲扇: 1,
  暖水瓶: 1,
};

async function getAudioState(page: Page): Promise<AudioDebugState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __AUDIO_DEBUG__?: { getState: () => AudioDebugState } })
      .__AUDIO_DEBUG__;
    if (!hook) {
      throw new Error('window.__AUDIO_DEBUG__ is not initialized');
    }
    return hook.getState();
  });
}

async function waitForPawnshopPhase(
  page: Page,
  expected: PawnshopDebugState['phase'],
): Promise<void> {
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
}

async function getBattleState(page: Page): Promise<BattleDebugState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __BATTLE_DEBUG__?: { getState: () => BattleDebugState } })
      .__BATTLE_DEBUG__;
    if (!hook) {
      throw new Error('window.__BATTLE_DEBUG__ is not initialized');
    }
    return hook.getState();
  });
}

async function waitForBattleReady(
  page: Page,
  expectedPhase?: BattleDebugState['phase'],
): Promise<BattleDebugState> {
  await expect
    .poll(
      async () =>
        page.evaluate((targetPhase) => {
          const hook = (
            window as unknown as { __BATTLE_DEBUG__?: { getState: () => BattleDebugState } }
          ).__BATTLE_DEBUG__;
          const s = hook?.getState();
          if (!s || s.isAnimating) {
            return false;
          }
          if (targetPhase && s.phase !== targetPhase) {
            return false;
          }
          return true;
        }, expectedPhase ?? null),
    )
    .toBe(true);
  return getBattleState(page);
}

async function playGreedyUntilResult(page: Page, canvas: Locator): Promise<BattleDebugState> {
  let state = await waitForBattleReady(page);
  let safety = 0;

  while (state.phase === 'play' && state.result === 'ongoing' && safety < 40) {
    safety += 1;
    let chosenIdx = -1;

    for (const cardName of DAMAGE_PRIORITY) {
      const idx = state.hand.indexOf(cardName);
      if (idx !== -1 && state.renqing >= (CARD_COSTS[cardName] ?? 99)) {
        chosenIdx = idx;
        break;
      }
    }

    if (chosenIdx === -1) {
      for (const cardName of UTILITY_PRIORITY) {
        const idx = state.hand.indexOf(cardName);
        if (idx !== -1 && state.renqing >= (CARD_COSTS[cardName] ?? 99)) {
          chosenIdx = idx;
          break;
        }
      }
    }

    if (chosenIdx !== -1) {
      const prevRenqing = state.renqing;
      const prevHandLen = state.hand.length;
      const prevDiscard = state.discardCount;
      const x = computeHandCardX(chosenIdx, state.hand.length);
      await clickLogical(page, canvas, { x, y: HAND_Y });

      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return (
            !s.isAnimating &&
            (s.phase === 'result_scene' ||
              s.result !== 'ongoing' ||
              s.renqing !== prevRenqing ||
              s.hand.length !== prevHandLen ||
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

test('Title volume toggle persists mute state, tracks switch day->night, and actions trigger 8-bit SFX + screenshot', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (req) =>
    failedRequests.push(`requestfailed ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });

  await page.goto('/?seed=2&deck=test');
  await page.evaluate(
    ([saveKey, tutKey, audioKey]) => {
      localStorage.removeItem(saveKey);
      localStorage.setItem(tutKey, '1');
      localStorage.removeItem(audioKey);
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, AUDIO_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');

  // Default: ON, quiet master gain, not unlocked yet (autoplay policy)
  const initialAudio = await getAudioState(page);
  expect(initialAudio.muted).toBe(false);
  expect(initialAudio.volume).toBeGreaterThanOrEqual(0.15);
  expect(initialAudio.volume).toBeLessThanOrEqual(0.25);
  expect(initialAudio.effectiveGain).toBe(initialAudio.volume);
  expect(initialAudio.unlocked).toBe(false);
  expect(initialAudio.currentTrack).toBeNull();

  // Screenshot of TitleScene showing the volume switch (音量:开)
  await page.screenshot({ path: 'test-results/audio-title-volume.png' });

  // Click volume switch -> mutes and persists in localStorage
  await clickLogical(page, canvas, BUTTONS.titleVolume);
  await expect.poll(async () => (await getAudioState(page)).muted).toBe(true);
  const mutedState = await getAudioState(page);
  expect(mutedState.effectiveGain).toBe(0);
  expect(mutedState.unlocked).toBe(true);
  expect(mutedState.audibleSfxCount).toBe(0);

  // Reload -> muted state persists from localStorage
  await page.reload();
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');
  expect((await getAudioState(page)).muted).toBe(true);

  // Click volume switch again -> unmutes and plays audible button_click SFX
  await clickLogical(page, canvas, BUTTONS.titleVolume);
  await expect.poll(async () => (await getAudioState(page)).muted).toBe(false);
  const unmutedState = await getAudioState(page);
  expect(unmutedState.effectiveGain).toBe(unmutedState.volume);
  expect(unmutedState.sfxCounts.button_click).toBeGreaterThanOrEqual(1);
  expect(unmutedState.audibleSfxCount).toBeGreaterThanOrEqual(1);

  // Click Start -> button_click SFX + PawnshopScene switches BGM to 'day'
  await clickLogical(page, canvas, BUTTONS.titleStart);
  await waitForPawnshopPhase(page, 'negotiating');
  const dayAudio = await getAudioState(page);
  expect(dayAudio.currentTrack).toBe('day');
  expect(dayAudio.isPlayingBgm).toBe(true);
  expect(dayAudio.sfxCounts.button_click).toBeGreaterThanOrEqual(2);

  // Accept deals across all 3 customers -> deal_closed & receive_card SFX fire
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, BUTTONS.tierHigh);
    await waitForPawnshopPhase(page, 'feedback');
    await clickLogical(page, canvas, BUTTONS.nextOrSummary);
  }
  await waitForPawnshopPhase(page, 'summary');

  await expect.poll(async () => (await getAudioState(page)).sfxCounts.deal_closed).toBe(3);
  await expect
    .poll(async () => (await getAudioState(page)).sfxCounts.receive_card)
    .toBeGreaterThanOrEqual(1);

  // Enter Night Battle -> switches BGM to 'night'
  await clickLogical(page, canvas, BUTTONS.enterNightBattle);
  await waitForBattleReady(page, 'play');
  const nightAudio = await getAudioState(page);
  expect(nightAudio.currentTrack).toBe('night');
  expect(nightAudio.isPlayingBgm).toBe(true);

  // Win Night 1 -> triggers play_card and demon_defeated ("叮") SFX
  const winResult = await playGreedyUntilResult(page, canvas);
  expect(winResult.result).toBe('win');
  const afterBattleAudio = await getAudioState(page);
  expect(afterBattleAudio.sfxCounts.play_card).toBeGreaterThanOrEqual(1);
  expect(afterBattleAudio.sfxCounts.demon_defeated).toBe(1);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

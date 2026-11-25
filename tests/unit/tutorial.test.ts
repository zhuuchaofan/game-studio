import { describe, expect, it } from 'vitest';
import {
  advanceTutorialStep,
  createTutorialState,
  finishTutorialOnDayEnd,
  getTutorialBubbleLayout,
  getTutorialCopy,
  skipTutorial,
  syncTutorialForBattle,
  syncTutorialForPawnshop,
  syncTutorialForResult,
  TUTORIAL_STEP_ORDER,
  TUTORIAL_STEPS,
} from '../../src/game/tutorial';
import {
  BATTLE_CARD_HEIGHT,
  BATTLE_DETAIL_TOGGLE_BUTTON,
  BATTLE_END_TURN_BUTTON,
  BATTLE_HAND_Y,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  RESULT_NEXT_DAY_BUTTON,
  RESULT_RETURN_BUTTON,
} from '../../src/game/layout';
import { BASE_HEIGHT, BASE_WIDTH } from '../../src/utils/scale';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function fromCenter(x: number, y: number, width: number, height: number): Rect {
  return {
    left: x - width / 2,
    top: y - height / 2,
    right: x + width / 2,
    bottom: y + height / 2,
  };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe('Day 1 tutorial state machine', () => {
  it('activates on first-time Day 1 and stays inactive on Day 2+ or when already completed', () => {
    const firstDay1 = createTutorialState({ day: 1, tutorialDone: false });
    expect(firstDay1.active).toBe(true);
    expect(firstDay1.done).toBe(false);

    const repeatDay1 = createTutorialState({ day: 1, tutorialDone: true });
    expect(repeatDay1.active).toBe(false);
    expect(repeatDay1.done).toBe(true);

    const day2 = createTutorialState({ day: 2, tutorialDone: false });
    expect(day2.active).toBe(false);

    const replay = createTutorialState({ day: 1, tutorialDone: true, forceReplay: true });
    expect(replay.active).toBe(true);
    expect(replay.isReplay).toBe(true);
  });

  it('walks through all 6 Day 1 steps in exact flow order and completes on final click', () => {
    let state = createTutorialState({ day: 1, tutorialDone: false });

    // 1. 收当 (Pawnshop negotiating)
    state = syncTutorialForPawnshop(state, 'negotiating');
    expect(state.currentStep).toBe('pawnshop_intro');
    expect(TUTORIAL_STEPS.pawnshop_intro.label).toBe('收当');
    expect(getTutorialCopy(state.currentStep)).toContain('掌柜：');

    // 2. 报价三档 (one click advances)
    state = advanceTutorialStep(state);
    expect(state.currentStep).toBe('offer_tiers');
    expect(TUTORIAL_STEPS.offer_tiers.label).toBe('报价三档');

    // Click hides bubble while player chooses a tier
    state = advanceTutorialStep(state);
    expect(state.currentStep).toBeNull();
    expect(state.active).toBe(true);

    // 3. 成交得牌 (Pawnshop feedback)
    state = syncTutorialForPawnshop(state, 'feedback');
    expect(state.currentStep).toBe('deal_card');
    expect(TUTORIAL_STEPS.deal_card.label).toBe('成交得牌');

    state = advanceTutorialStep(state);
    expect(state.currentStep).toBeNull();

    // Subsequent customers & summary stay clean (no duplicate bubbles)
    state = syncTutorialForPawnshop(state, 'negotiating');
    expect(state.currentStep).toBeNull();
    state = syncTutorialForPawnshop(state, 'feedback');
    expect(state.currentStep).toBeNull();
    state = syncTutorialForPawnshop(state, 'summary');
    expect(state.currentStep).toBeNull();

    // 4. 夜里出牌 (CardBattle play)
    state = syncTutorialForBattle(state, 'play');
    expect(state.currentStep).toBe('night_play');
    expect(TUTORIAL_STEPS.night_play.label).toBe('夜里出牌');

    // 5. 人情 (one click advances)
    state = advanceTutorialStep(state);
    expect(state.currentStep).toBe('renqing');
    expect(TUTORIAL_STEPS.renqing.label).toBe('人情');

    state = advanceTutorialStep(state);
    expect(state.currentStep).toBeNull();
    expect(state.active).toBe(true);

    // 6. 结算 (ResultScene)
    state = syncTutorialForResult(state);
    expect(state.currentStep).toBe('settlement');
    expect(TUTORIAL_STEPS.settlement.label).toBe('结算');

    // Final click ends tutorial and marks done
    state = advanceTutorialStep(state);
    expect(state.active).toBe(false);
    expect(state.currentStep).toBeNull();
    expect(state.done).toBe(true);
    expect(state.completedSteps).toEqual([...TUTORIAL_STEP_ORDER]);
  });

  it('skipTutorial immediately dismisses active guidance and marks tutorial done', () => {
    let state = createTutorialState({ day: 1, tutorialDone: false });
    state = syncTutorialForPawnshop(state, 'negotiating');
    expect(state.currentStep).toBe('pawnshop_intro');

    state = skipTutorial(state);
    expect(state.active).toBe(false);
    expect(state.currentStep).toBeNull();
    expect(state.done).toBe(true);

    // Subsequent sync calls remain inactive
    expect(syncTutorialForPawnshop(state, 'feedback').currentStep).toBeNull();
    expect(syncTutorialForBattle(state, 'play').currentStep).toBeNull();
    expect(syncTutorialForResult(state).currentStep).toBeNull();
  });

  it('finishTutorialOnDayEnd completes tutorial if player leaves ResultScene directly', () => {
    let state = createTutorialState({ day: 1, tutorialDone: false });
    state = syncTutorialForResult(state);
    expect(state.active).toBe(true);
    expect(state.currentStep).toBe('settlement');

    state = finishTutorialOnDayEnd(state);
    expect(state.active).toBe(false);
    expect(state.currentStep).toBeNull();
    expect(state.done).toBe(true);
  });
});

describe('Tutorial bubble geometry (640x360 non-overlapping layout)', () => {
  it('fits every bubble inside 640x360 and never covers next-action buttons, reputation bar, or toast', () => {
    const pawnshopNegotiatingButtons: Rect[] = [
      fromCenter(
        PAWNSHOP_TIER_BUTTONS.low.x,
        PAWNSHOP_TIER_BUTTONS.low.y,
        PAWNSHOP_TIER_BUTTONS.low.width,
        PAWNSHOP_TIER_BUTTONS.low.height,
      ),
      fromCenter(
        PAWNSHOP_TIER_BUTTONS.fair.x,
        PAWNSHOP_TIER_BUTTONS.fair.y,
        PAWNSHOP_TIER_BUTTONS.fair.width,
        PAWNSHOP_TIER_BUTTONS.fair.height,
      ),
      fromCenter(
        PAWNSHOP_TIER_BUTTONS.high.x,
        PAWNSHOP_TIER_BUTTONS.high.y,
        PAWNSHOP_TIER_BUTTONS.high.width,
        PAWNSHOP_TIER_BUTTONS.high.height,
      ),
      fromCenter(
        PAWNSHOP_SKIP_BUTTON.x,
        PAWNSHOP_SKIP_BUTTON.y,
        PAWNSHOP_SKIP_BUTTON.width,
        PAWNSHOP_SKIP_BUTTON.height,
      ),
      { left: 16, top: 36, right: 624, bottom: 158 }, // Customer ticket panel
      { left: 40, top: 274, right: 600, bottom: 298 }, // §3.1④: Reputation hint bar
      { left: 498, top: 182, right: 626, bottom: 214 }, // §3.1⑤: Insufficient-funds toast
    ];
    const pawnshopFeedbackButtons: Rect[] = [
      fromCenter(
        PAWNSHOP_FEEDBACK_NEXT_BUTTON.x,
        PAWNSHOP_FEEDBACK_NEXT_BUTTON.y,
        PAWNSHOP_FEEDBACK_NEXT_BUTTON.width,
        PAWNSHOP_FEEDBACK_NEXT_BUTTON.height,
      ),
      { left: 16, top: 40, right: 624, bottom: 176 }, // Entire feedback settlement panel
    ];
    const battleButtons: Rect[] = [
      fromCenter(
        BATTLE_END_TURN_BUTTON.x,
        BATTLE_END_TURN_BUTTON.y,
        BATTLE_END_TURN_BUTTON.width,
        BATTLE_END_TURN_BUTTON.height,
      ),
      fromCenter(
        BATTLE_DETAIL_TOGGLE_BUTTON.x,
        BATTLE_DETAIL_TOGGLE_BUTTON.y,
        BATTLE_DETAIL_TOGGLE_BUTTON.width,
        BATTLE_DETAIL_TOGGLE_BUTTON.height,
      ),
      {
        left: 12,
        top: BATTLE_HAND_Y - Math.floor(BATTLE_CARD_HEIGHT / 2),
        right: BASE_WIDTH - 12,
        bottom: BATTLE_HAND_Y + Math.floor(BATTLE_CARD_HEIGHT / 2),
      }, // Hand cards band
      { left: 108, top: 42, right: 540, bottom: 126 }, // Demon area & HP bar
    ];
    const resultButtons: Rect[] = [
      fromCenter(
        RESULT_NEXT_DAY_BUTTON.x,
        RESULT_NEXT_DAY_BUTTON.y,
        RESULT_NEXT_DAY_BUTTON.width,
        RESULT_NEXT_DAY_BUTTON.height,
      ),
      fromCenter(
        RESULT_RETURN_BUTTON.x,
        RESULT_RETURN_BUTTON.y,
        RESULT_RETURN_BUTTON.width,
        RESULT_RETURN_BUTTON.height,
      ),
      { left: 20, top: 12, right: 620, bottom: 176 }, // Result settlement, victory narrative & aftermath
    ];

    const sceneTargets: Record<string, Rect[]> = {
      pawnshop_intro: pawnshopNegotiatingButtons,
      offer_tiers: pawnshopNegotiatingButtons,
      deal_card: pawnshopFeedbackButtons,
      night_play: battleButtons,
      renqing: battleButtons,
      settlement: resultButtons,
    };

    for (const stepId of TUTORIAL_STEP_ORDER) {
      const layout = getTutorialBubbleLayout(stepId);
      const { box, skipButton, continueClickPoint } = layout;

      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(BASE_WIDTH);
      expect(box.y + box.height).toBeLessThanOrEqual(BASE_HEIGHT);

      const bubbleRect: Rect = {
        left: box.x,
        top: box.y,
        right: box.x + box.width,
        bottom: box.y + box.height,
      };

      for (const btn of sceneTargets[stepId]) {
        expect(
          rectsOverlap(bubbleRect, btn),
          `Step "${stepId}" bubble overlaps an interactive button`,
        ).toBe(false);
      }

      // Continue click point must sit inside the bubble and outside the skip button
      const skipRect = fromCenter(skipButton.x, skipButton.y, skipButton.width, skipButton.height);
      expect(continueClickPoint.x).toBeGreaterThan(bubbleRect.left);
      expect(continueClickPoint.x).toBeLessThan(bubbleRect.right);
      expect(continueClickPoint.y).toBeGreaterThan(bubbleRect.top);
      expect(continueClickPoint.y).toBeLessThan(bubbleRect.bottom);
      expect(
        continueClickPoint.x >= skipRect.left &&
          continueClickPoint.x <= skipRect.right &&
          continueClickPoint.y >= skipRect.top &&
          continueClickPoint.y <= skipRect.bottom,
      ).toBe(false);
    }
  });

  it('P10: pawnshop_intro gives Night 1 20HP/3-round goal and damage-card route, and settlement distinguishes win vs lose copy', () => {
    const introCopy = getTutorialCopy('pawnshop_intro') ?? '';
    expect(introCopy).toContain('3回合');
    expect(introCopy).toContain('20血');
    expect(introCopy).toContain('二胡余音');
    expect(introCopy).toContain('3伤');
    expect(introCopy).toContain('自行车飞驰');
    expect(introCopy).toContain('6伤');
    expect(TUTORIAL_STEPS.pawnshop_intro.lines.length).toBeLessThanOrEqual(3);

    // Win settlement keeps original copy
    let winState = createTutorialState({ day: 1, tutorialDone: false });
    winState = syncTutorialForResult(winState, 'win');
    expect(winState.currentStep).toBe('settlement');
    expect(winState.settlementOutcome).toBe('win');
    const winCopy = getTutorialCopy(winState.currentStep, winState.settlementOutcome) ?? '';
    expect(winCopy).toContain('头一天算过关了！赢了得钱得新牌');

    // Lose settlement never says "过关" and matches Night 1 defeat tone
    let loseState = createTutorialState({ day: 1, tutorialDone: false });
    loseState = syncTutorialForResult(loseState, 'lose');
    expect(loseState.currentStep).toBe('settlement');
    expect(loseState.settlementOutcome).toBe('lose');
    const loseCopy = getTutorialCopy(loseState.currentStep, loseState.settlementOutcome) ?? '';
    expect(loseCopy).toContain('头一天没打下来');
    expect(loseCopy).not.toContain('过关');
    expect(loseCopy).not.toContain('赢了得钱');
  });
});

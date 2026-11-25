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

describe('Tutorial bubble geometry (320x180 non-overlapping layout)', () => {
  it('fits every bubble inside 320x180 and never covers next-action buttons', () => {
    const pawnshopNegotiatingButtons: Rect[] = [
      fromCenter(58, 154, 92, 32), // low
      fromCenter(160, 154, 92, 32), // fair
      fromCenter(262, 154, 92, 32), // high
      fromCenter(270, 107, 64, 18), // skip customer
      { left: 66, top: 27, right: 304, bottom: 79 }, // A2/C2: item title, story & effect area
    ];
    const pawnshopFeedbackButtons: Rect[] = [
      fromCenter(160, 154, 118, 26), // next / summary
      { left: 10, top: 24, right: 310, bottom: 88 }, // A2: entire feedback settlement panel
    ];
    const battleButtons: Rect[] = [
      fromCenter(283, 95, 62, 21), // end turn
      { left: 6, top: 112, right: 314, bottom: 176 }, // hand cards band
      { left: 14, top: 26, right: 306, bottom: 62 }, // C5: demon intro banner & demon area
    ];
    const resultButtons: Rect[] = [
      fromCenter(88, 148, 116, 24), // next day
      fromCenter(222, 148, 136, 24), // return title
      { left: 12, top: 8, right: 308, bottom: 84 }, // A2/C5: result settlement & victory narrative
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
});

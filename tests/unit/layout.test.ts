import { describe, expect, it } from 'vitest';
import {
  BATTLE_CARD_WIDTH,
  computeHandCardPose,
  computeHandCardX,
  computeHandMaxScroll,
  HAND_SCROLL_THRESHOLD,
  HAND_SLOT_STEP,
} from '../../src/game/layout';
import { BASE_WIDTH } from '../../src/utils/scale';

describe('Hand horizontal-scroll layout (Task 18 §3 plan B)', () => {
  it('keeps natural centered 104px spacing for 1..6 cards with no scroll', () => {
    for (let count = 1; count < HAND_SCROLL_THRESHOLD; count += 1) {
      const xs = Array.from({ length: count }, (_, i) => computeHandCardPose(i, count).x);
      expect(xs[0]).toBe(computeHandCardX(0, count));
      for (let i = 1; i < xs.length; i += 1) expect(xs[i] - xs[i - 1]).toBe(104);
      expect(computeHandMaxScroll(count)).toBe(0);
    }
  });

  it('keeps slot spacing at exactly 104 (never squeezed) and flat for 7/9/11 cards', () => {
    expect(HAND_SLOT_STEP).toBe(104);
    for (const count of [7, 9, 11]) {
      const poses = Array.from({ length: count }, (_, i) => computeHandCardPose(i, count));
      for (let i = 1; i < count; i += 1) {
        expect(poses[i].x - poses[i - 1].x).toBe(104);
        expect(poses[i].y).toBe(poses[0].y);
      }
      expect(Object.keys(poses[0]).sort()).toEqual(['x', 'y']); // no rotation / compact-text mode
    }
  });

  it('scrolls so the first and last card are fully reachable for 7/9/11 cards', () => {
    for (const count of [7, 9, 11]) {
      const max = computeHandMaxScroll(count);
      expect(max).toBeGreaterThan(0);
      const first = computeHandCardPose(0, count).x - BATTLE_CARD_WIDTH / 2;
      const lastRight = computeHandCardPose(count - 1, count).x + BATTLE_CARD_WIDTH / 2;
      expect(first).toBeGreaterThanOrEqual(0);
      expect(lastRight - max).toBeLessThanOrEqual(BASE_WIDTH);
    }
  });
});

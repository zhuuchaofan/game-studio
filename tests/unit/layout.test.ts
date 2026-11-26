import { describe, expect, it } from 'vitest';
import {
  BATTLE_CARD_HEIGHT,
  BATTLE_CARD_WIDTH,
  computeHandCardPose,
  computeHandCardX,
  HAND_FAN_THRESHOLD,
} from '../../src/game/layout';
import { BASE_HEIGHT, BASE_WIDTH } from '../../src/utils/scale';

describe('Hand fixed-slot fan layout (Task 17 §2)', () => {
  it('keeps natural flat spacing for 1..6 cards without rotation', () => {
    for (let count = 1; count < HAND_FAN_THRESHOLD; count += 1) {
      const xs: number[] = [];
      for (let i = 0; i < count; i += 1) {
        const pose = computeHandCardPose(i, count);
        expect(pose.rotation).toBe(0);
        expect(pose.compactText).toBe(false);
        expect(pose.x).toBe(computeHandCardX(i, count));
        xs.push(pose.x);
      }
      for (let i = 1; i < xs.length; i += 1) {
        expect(xs[i] - xs[i - 1]).toBe(104);
      }
    }
  });

  it('uses fixed-slot fan poses for 7..11 cards with all corners inside 640x360', () => {
    const halfW = BATTLE_CARD_WIDTH / 2;
    const halfH = BATTLE_CARD_HEIGHT / 2;

    for (const count of [7, 8, 9, 10, 11]) {
      const poses = Array.from({ length: count }, (_, i) => computeHandCardPose(i, count));
      for (let i = 0; i < poses.length; i += 1) {
        const p = poses[i];
        expect(p.compactText).toBe(true);
        if (i > 0) {
          expect(p.x).toBeGreaterThan(poses[i - 1].x);
          expect(p.rotation).toBeGreaterThan(poses[i - 1].rotation);
        }

        // Verify all 4 rotated corners remain safely inside canvas
        const cos = Math.cos(p.rotation);
        const sin = Math.sin(p.rotation);
        for (const [lx, ly] of [
          [-halfW, -halfH],
          [halfW, -halfH],
          [-halfW, halfH],
          [halfW, halfH],
        ]) {
          const wx = p.x + lx * cos - ly * sin;
          const wy = p.y + lx * sin + ly * cos;
          expect(wx).toBeGreaterThanOrEqual(0);
          expect(wx).toBeLessThanOrEqual(BASE_WIDTH);
          expect(wy).toBeGreaterThanOrEqual(216);
          expect(wy).toBeLessThanOrEqual(BASE_HEIGHT + 1);
        }
      }
      // Leftmost and rightmost tilt stay gentle (<= 5 degrees)
      expect(Math.abs(poses[0].rotation)).toBeLessThanOrEqual((5 * Math.PI) / 180 + 1e-6);
      expect(Math.abs(poses[count - 1].rotation)).toBeLessThanOrEqual((5 * Math.PI) / 180 + 1e-6);
    }
  });

  it('centers 7 cards onto the middle 7 slots of the 9-slot fixed table', () => {
    const seven = Array.from({ length: 7 }, (_, i) => computeHandCardPose(i, 7));
    const nine = Array.from({ length: 9 }, (_, i) => computeHandCardPose(i, 9));
    for (let i = 0; i < 7; i += 1) {
      expect(seven[i]).toEqual(nine[i + 1]);
    }
  });
});

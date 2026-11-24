import { describe, expect, it } from 'vitest';
import {
  BASE_HEIGHT,
  BASE_WIDTH,
  calculateIntegerScale,
  calculateScaledDimensions,
  isPortraitViewport,
} from '../../src/utils/scale';

describe('calculateIntegerScale', () => {
  it('returns exact integer scale for 16:9 viewport multiples', () => {
    expect(calculateIntegerScale(320, 180)).toBe(1);
    expect(calculateIntegerScale(1280, 720)).toBe(4);
    expect(calculateIntegerScale(1920, 1080)).toBe(6);
  });

  it('floors non-integer viewports to preserve crisp pixels', () => {
    expect(calculateIntegerScale(1000, 600)).toBe(3);
    expect(calculateIntegerScale(1920, 800)).toBe(4);
  });

  it('clamps to 1x when viewport is smaller than native resolution', () => {
    expect(calculateIntegerScale(200, 100)).toBe(1);
    expect(calculateIntegerScale(0, 0)).toBe(1);
  });

  it('throws on non-positive base dimensions', () => {
    expect(() => calculateIntegerScale(1280, 720, 0, 180)).toThrow(RangeError);
    expect(() => calculateIntegerScale(1280, 720, 320, -1)).toThrow(RangeError);
  });
});

describe('calculateScaledDimensions', () => {
  it('returns scaled width and height as integer multiples of native resolution', () => {
    const result = calculateScaledDimensions(1280, 720);
    expect(result).toEqual({
      scale: 4,
      width: BASE_WIDTH * 4,
      height: BASE_HEIGHT * 4,
    });
  });

  it('keeps 1x crisp integer scaling in portrait phone viewport 390x844', () => {
    expect(calculateScaledDimensions(390, 844)).toEqual({
      scale: 1,
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
    });
  });
});

describe('isPortraitViewport', () => {
  it('returns true only when height exceeds width', () => {
    expect(isPortraitViewport(390, 844)).toBe(true);
    expect(isPortraitViewport(720, 1280)).toBe(true);
    expect(isPortraitViewport(1280, 720)).toBe(false);
    expect(isPortraitViewport(844, 390)).toBe(false);
    expect(isPortraitViewport(500, 500)).toBe(false);
  });
});

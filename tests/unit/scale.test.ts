import { describe, expect, it } from 'vitest';
import {
  BASE_HEIGHT,
  BASE_WIDTH,
  calculateIntegerScale,
  calculateScaledDimensions,
  isPortraitViewport,
} from '../../src/utils/scale';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../e2e/helpers';

describe('calculateIntegerScale', () => {
  it('returns exact integer scale for 16:9 viewport multiples', () => {
    expect(calculateIntegerScale(640, 360)).toBe(1);
    expect(calculateIntegerScale(1280, 720)).toBe(2);
    expect(calculateIntegerScale(1920, 1080)).toBe(3);
  });

  it('floors non-integer viewports to preserve crisp pixels', () => {
    expect(calculateIntegerScale(1000, 600)).toBe(1);
    expect(calculateIntegerScale(1920, 800)).toBe(2);
  });

  it('clamps to 1x when viewport is smaller than native resolution', () => {
    expect(calculateIntegerScale(200, 100)).toBe(1);
    expect(calculateIntegerScale(0, 0)).toBe(1);
  });

  it('throws on non-positive base dimensions', () => {
    expect(() => calculateIntegerScale(1280, 720, 0, 360)).toThrow(RangeError);
    expect(() => calculateIntegerScale(1280, 720, 640, -1)).toThrow(RangeError);
  });
});

describe('calculateScaledDimensions', () => {
  it('returns scaled width and height as integer multiples of native resolution', () => {
    const result = calculateScaledDimensions(1280, 720);
    expect(result).toEqual({
      scale: 2,
      width: BASE_WIDTH * 2,
      height: BASE_HEIGHT * 2,
    });
  });

  it('keeps 1x crisp integer scaling in landscape phone (844x390) and narrow (800x500) viewports', () => {
    expect(calculateScaledDimensions(844, 390)).toEqual({
      scale: 1,
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
    });
    expect(calculateScaledDimensions(800, 500)).toEqual({
      scale: 1,
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
    });
  });

  it('keeps E2E helper logical dimensions as single source of truth with BASE_WIDTH/BASE_HEIGHT', () => {
    expect(LOGICAL_WIDTH).toBe(BASE_WIDTH);
    expect(LOGICAL_HEIGHT).toBe(BASE_HEIGHT);
    expect(BASE_WIDTH).toBe(640);
    expect(BASE_HEIGHT).toBe(360);
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

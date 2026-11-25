export const BASE_WIDTH = 640;
export const BASE_HEIGHT = 360;

export interface ScaledDimensions {
  scale: number;
  width: number;
  height: number;
}

/**
 * Calculates the largest integer scale factor (>= 1) that fits the native
 * pixel-art resolution within the given viewport dimensions.
 */
export function calculateIntegerScale(
  viewportWidth: number,
  viewportHeight: number,
  baseWidth: number = BASE_WIDTH,
  baseHeight: number = BASE_HEIGHT,
): number {
  if (baseWidth <= 0 || baseHeight <= 0) {
    throw new RangeError('Base dimensions must be positive numbers.');
  }

  const scaleX = Math.floor(viewportWidth / baseWidth);
  const scaleY = Math.floor(viewportHeight / baseHeight);
  return Math.max(1, Math.min(scaleX, scaleY));
}

export function calculateScaledDimensions(
  viewportWidth: number,
  viewportHeight: number,
  baseWidth: number = BASE_WIDTH,
  baseHeight: number = BASE_HEIGHT,
): ScaledDimensions {
  const scale = calculateIntegerScale(viewportWidth, viewportHeight, baseWidth, baseHeight);
  return {
    scale,
    width: baseWidth * scale,
    height: baseHeight * scale,
  };
}

/**
 * Returns true when the viewport is taller than it is wide (portrait orientation).
 */
export function isPortraitViewport(viewportWidth: number, viewportHeight: number): boolean {
  return viewportHeight > viewportWidth;
}

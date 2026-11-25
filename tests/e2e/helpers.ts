import { expect, type Locator, type Page } from '@playwright/test';
import { BASE_HEIGHT, BASE_WIDTH } from '../../src/utils/scale';

export const LOGICAL_WIDTH = BASE_WIDTH;
export const LOGICAL_HEIGHT = BASE_HEIGHT;

/**
 * Wait two requestAnimationFrame ticks before dispatching a mouse click on the
 * Phaser canvas.
 *
 * Root cause of CI E2E phase-wait timeouts:
 * Phaser dispatches DOM mousedown synchronously in MouseManager -> InputManager
 * -> InputPlugin.update() -> hitTestPointer(this._list). When a pointerdown
 * handler synchronously updates scene state and recreates buttons via
 * setInteractive() (e.g. PawnshopScene.renderCurrentPhase(), or CardBattleScene
 * after a tween/timer), Phaser queues the new interactive objects in
 * InputPlugin._pendingInsertion and only flushes them into InputPlugin._list on
 * the next requestAnimationFrame via InputPlugin.preUpdate().
 *
 * Because the debug hook reads state synchronously, Playwright can observe the
 * new phase and fire the next click within the same rAF frame (<16.67ms),
 * before preUpdate() runs. That click misses `_list` and is silently dropped,
 * leaving waitForPawnshopPhase / waitForBattleReady stuck until timeout.
 *
 * Awaiting two rAF ticks guarantees at least one full Phaser Game.step() +
 * InputPlugin.preUpdate() flush and any syncInputBounds() rAF scale refresh
 * have completed before computing boundingBox() and clicking.
 */
export async function waitForPhaserInputFlush(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );
}

export async function clickLogical(
  page: Page,
  canvas: Locator,
  point: { x: number; y: number },
): Promise<void> {
  await waitForPhaserInputFlush(page);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const clientX = box!.x + (point.x / LOGICAL_WIDTH) * box!.width;
  const clientY = box!.y + (point.y / LOGICAL_HEIGHT) * box!.height;
  await page.mouse.click(clientX, clientY);
}

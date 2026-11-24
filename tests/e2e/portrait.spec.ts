import { expect, test } from '@playwright/test';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';

test('shows landscape hint in portrait (390x844) with crisp 1x integer scaling, hides it in landscape, and stays playable', async ({
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

  // Portrait mobile viewport (390x844)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=2');
  await page.evaluate(
    ([saveKey, tutKey]) => {
      localStorage.removeItem(saveKey);
      localStorage.setItem(tutKey, '1');
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  const hint = page.locator('#portrait-hint');

  await expect(canvas).toBeVisible();
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('横屏体验更佳');

  // Keep integer scaling (option b): 390x844 -> 1x = 320x180
  const canvasBox = await canvas.boundingBox();
  const hintBox = await hint.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(hintBox).not.toBeNull();
  expect(canvasBox!.width).toBe(320);
  expect(canvasBox!.height).toBe(180);
  // Hint must not overlap the game canvas
  expect(hintBox!.y).toBeGreaterThanOrEqual(canvasBox!.y + canvasBox!.height);

  await page.screenshot({ path: 'test-results/portrait-hint-390x844.png' });

  // Game remains fully playable in portrait: clicking Start enters Day 1 PawnshopScene
  await clickLogical(page, canvas, { x: 160, y: 122 });
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const hook = (
          window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => { phase: string } } }
        ).__PAWNSHOP_DEBUG__;
        return hook?.getState().phase ?? null;
      }),
    )
    .toBe('negotiating');

  // Rotate to landscape phone viewport (844x390) -> hint disappears, canvas scales to 2x (640x360)
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(hint).toBeHidden();
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox();
      return box ? { width: box.width, height: box.height } : null;
    })
    .toEqual({ width: 640, height: 360 });

  // Desktop landscape viewport (1280x720) -> hint stays hidden, canvas scales to 4x (1280x720)
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(hint).toBeHidden();
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox();
      return box ? { width: box.width, height: box.height } : null;
    })
    .toEqual({ width: 1280, height: 720 });

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

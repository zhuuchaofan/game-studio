import { expect, test } from '@playwright/test';
import { TITLE_START_BUTTON } from '../../src/game/layout';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';

test('shows fullscreen landscape prompt in portrait (390x844), blocks play during portrait, and restores crisp integer scaling in landscape/narrow/desktop', async ({
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

  // Portrait mobile viewport (390x844): fullscreen prompt overlay, no horizontal overflow, not playable
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

  await expect(hint).toBeVisible();
  await expect(hint).toContainText('请横屏游玩');

  const hintBox = await hint.boundingBox();
  expect(hintBox).not.toBeNull();
  expect(hintBox!.width).toBeGreaterThanOrEqual(390);
  expect(hintBox!.height).toBeGreaterThanOrEqual(844);

  const portraitOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(portraitOverflow).toBe(false);

  // Clicking during portrait overlay must NOT start the game
  await page.mouse.click(195, 422);
  await page.waitForTimeout(150);
  const phaseDuringPortrait = await page.evaluate(() => {
    const hook = (
      window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => { phase: string } } }
    ).__PAWNSHOP_DEBUG__;
    return hook?.getState().phase ?? null;
  });
  expect(phaseDuringPortrait).toBe('title');

  await page.screenshot({ path: 'test-results/portrait-hint-390x844.png' });

  // Rotate to landscape phone viewport (844x390) -> hint disappears, canvas scales to 1x (640x360), playable
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(hint).toBeHidden();
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox();
      return box ? { width: box.width, height: box.height } : null;
    })
    .toEqual({ width: 640, height: 360 });

  const landscapeOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(landscapeOverflow).toBe(false);

  await clickLogical(page, canvas, TITLE_START_BUTTON);
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

  // Narrow desktop window (800x500) -> hint stays hidden, canvas 1x (640x360), no horizontal overflow
  await page.setViewportSize({ width: 800, height: 500 });
  await expect(hint).toBeHidden();
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox();
      return box ? { width: box.width, height: box.height } : null;
    })
    .toEqual({ width: 640, height: 360 });
  const narrowOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(narrowOverflow).toBe(false);

  // Desktop landscape viewport (1280x720) -> hint stays hidden, canvas scales to 2x (1280x720)
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

import { expect, test } from '@playwright/test';

test('renders 640x360 pixel-art Phaser canvas with integer scaling', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto('/');

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();

  const intrinsicSize = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    return { width: c.width, height: c.height };
  });
  expect(intrinsicSize).toEqual({ width: 640, height: 360 });

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBe(1280);
  expect(box!.height).toBe(720);

  await page.screenshot({ path: 'test-results/smoke-hello-world.png' });

  expect(pageErrors).toEqual([]);
});

import { expect, test } from '@playwright/test';

test('主线程可以请求 Worker 并收到计算结果', async ({ page }) => {
  await page.goto('/');
  await expect(page.evaluate(() => window.runStoreWorkerScenario())).resolves.toBe(42);
});

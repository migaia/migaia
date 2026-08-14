import { test, expect } from '@playwright/test';

test('Provider 内的 Store 更新驱动真实浏览器渲染', async ({ page }) => {
  await page.goto('/');
  const counter = page.locator('#counter');
  await expect(counter).toHaveText('0');
  await counter.click();
  await expect(counter).toHaveText('1');
  await page.evaluate(() => window.disposeStoreReactE2E());
});

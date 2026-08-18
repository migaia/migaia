import { test, expect } from '@playwright/test';

test('Provider 内的 Store 更新驱动真实浏览器渲染', async ({ page }) => {
  await page.goto('/');
  const counter = page.locator('#counter');
  await expect(counter).toHaveText('0');
  await counter.click();
  await expect(counter).toHaveText('1');
});

test('同一 Store 的独立 selector 在浏览器提交中保持一致', async ({ page }) => {
  await page.goto('/');
  const counter = page.locator('#counter');
  const parity = page.locator('#parity');
  await expect(counter).toHaveText('0');
  await expect(parity).toHaveText('0');
  await counter.click();
  await expect(counter).toHaveText('1');
  await expect(parity).toHaveText('1');
  await counter.click();
  await expect(counter).toHaveText('2');
  await expect(parity).toHaveText('0');
});

test('批量写入只向 React 暴露最终提交值且可安全卸载', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.batchStoreReactE2E());
  await expect(page.locator('#counter')).toHaveText('2');
  await expect(page.locator('#parity')).toHaveText('0');
  await page.evaluate(() => window.disposeStoreReactE2E());
  await expect(page.locator('#root')).toBeEmpty();
});

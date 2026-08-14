import { expect, test } from '@playwright/test';

test('Memory 隔离复合 record key 的输入与迭代输出引用', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runMemoryCompositeKeyOwnershipScenario());
  expect(result).toEqual({
    directStable: true,
    transactionStable: true,
    iterationStable: true,
    rangeStable: true
  });
});

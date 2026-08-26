import { expect, test } from '@playwright/test'

test('definition、派生、override 与 dispose 在真实浏览器保持作用域语义', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreKeyedScenario())).resolves.toEqual([
    4,
    20,
    4,
    true
  ])
})

test('atom thenable guard 在浏览器收容 hostile getter 与 callable thenable', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreKeyedThenableGuardScenario())).resolves.toEqual([
    1,
    'INVALID_OPTION',
    true,
    'INVALID_OPTION'
  ])
})

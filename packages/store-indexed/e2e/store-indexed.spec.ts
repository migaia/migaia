import { expect, test } from '@playwright/test'

test('四类 indexed collection 在真实浏览器保持结构与快照语义', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreIndexedScenario())).resolves.toEqual([
    { name: 'Grace', active: true },
    [1, 4, 5, 3],
    [
      ['a', 1],
      ['b', 2]
    ],
    ['a', 'b']
  ])
})

test('iterable 在浏览器保持 getter/call 单次接纳、receiver 与字符串语义', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.evaluate(() => window.runStoreIndexedIterableAdmissionScenario())
  ).resolves.toEqual([[1, 2], 1, 1, true, ['a', 'b']])
})

test('Map replace 在浏览器物化失败时保持旧状态与 tagged cause', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreIndexedRollbackScenario())).resolves.toEqual([
    [['old', 1]],
    'INVALID_OPTION',
    true
  ])
})

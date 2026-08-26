import { expect, test } from '@playwright/test'

test('对象字段、getter、action、batch 与 dispose 在真实浏览器协同', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreLightScenario())).resolves.toEqual([
    4,
    8,
    2,
    4,
    true
  ])
})

test('StoreResource 自动清理在浏览器保持 disposer 与 thenable 单次接纳', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreLightResourceCleanupScenario())).resolves.toEqual(
    [1, 1, 1, 1]
  )
})

test('StoreResource factory 在浏览器只读取已知字段并固定 load 快照', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.evaluate(() => window.runStoreLightResourceAdmissionScenario())
  ).resolves.toEqual([42, 1, 0, 0])
})

test('StoreResourceScope 在浏览器委托 canonical admission 并保留 terminal callback', async ({
  page
}) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreLightResourceScopeScenario())).resolves.toEqual([
    42, 1, 0, 1
  ])
})

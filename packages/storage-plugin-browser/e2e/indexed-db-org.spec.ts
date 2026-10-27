import { expect, test } from '@playwright/test'

test('native IndexedDB organizations retain the configured default and delete only their databases', async ({
  page
}) => {
  await page.goto('/')
  const result = await page.evaluate(() => window.runBrowserIndexedDbOrgScenario())
  expect(result).toEqual({
    combinations: 2,
    defaultShared: true,
    isolated: true,
    deleted: true,
    reused: true
  })
})

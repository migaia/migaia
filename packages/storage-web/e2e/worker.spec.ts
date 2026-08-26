import { expect, test } from '@playwright/test'

test('真实 module Worker 支持 memory/IndexedDB，并拒绝 Web Storage/cookie', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(() => window.runWorkerScenario())
  expect(result.memory).toBe('ok')
  expect(result.indexedDb).toBe('ok')
  expect(result.localStorageCode).toBe('BACKEND_UNAVAILABLE')
  expect(result.cookiesCode).toBe('BACKEND_UNAVAILABLE')
})

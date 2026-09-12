import { test, expect } from '@playwright/test'

test('localStorageHost 写满真实配额时抛 QUOTA_EXCEEDED', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(() => window.runLocalStorageQuotaScenario())
  expect(result.wroteCount).toBeGreaterThan(0)
  expect(result.quotaErrorCode).toBe('QUOTA_EXCEEDED')
  expect(result.optionsCode).toBe('INVALID_CONFIG')
})

test('真实浏览器页面中的 Storage 异常归一化并保留 cause', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStorageFailureScenario())).resolves.toEqual({
    code: 'BACKEND_UNAVAILABLE',
    hasCause: true,
    invalidStorageCode: 'INVALID_CONFIG',
    invalidLengthCode: 'INVALID_CONFIG',
    constructorOptionReads: 3,
    optionGetterCode: 'INVALID_CONFIG',
    storageLengthReads: 1,
    storageGetterCode: 'INVALID_CONFIG',
    namespaceCodecReads: 2,
    runtimeLengthReads: 2,
    codecPhysicalClear: true,
    partialClearCode: 'BACKEND_UNAVAILABLE',
    partialClearOperation: 'local.clearAll',
    partialClearKey: 'second',
    snapshotClearCode: 'BACKEND_UNAVAILABLE',
    snapshotClearOperation: 'local.clearAll',
    reentrantAbortCode: 'ABORTED',
    reentrantAbortOperation: undefined,
    reentrantAbortKeyMatchesRemaining: false,
    incoherentClearCode: 'BACKEND_UNAVAILABLE',
    incoherentClearOperation: 'local.clearAll',
    incoherentClearPreservedValues: true
  })
})

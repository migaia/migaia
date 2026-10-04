import { test, expect } from '@playwright/test'

/** Compare library writes with the native loopback policy, which varies by WebKit platform/version. */
test('Secure cookie 遵循真实浏览器的 loopback 语义，普通 cookie 也正常', async ({ page }) => {
  await page.goto('/')
  /** Native cookie control isolates browser policy from the storage-web implementation. */
  const nativeSecureVisible = await page.evaluate(() => {
    document.cookie = 'secure-control=value; Path=/; Secure'
    /** Capture native visibility before removing the isolated control cookie. */
    const visible = document.cookie.includes('secure-control=value')
    document.cookie = 'secure-control=; Path=/; Secure; Max-Age=0'
    return visible
  })
  /** The host must retain Secure and delegate visibility to the browser rather than its engine name. */
  const result = await page.evaluate(() => window.runCookieSecureScenario())
  expect(result.insecureVisible).toBe(true)
  // WebKit added Cocoa loopback support in https://github.com/WebKit/WebKit/commit/aa297f.
  // Other builds may still reject it; ordinary HTTP rejection is asserted separately below.
  expect(result.secureVisible).toBe(nativeSecureVisible)
})

/** A routed non-loopback origin tests ordinary HTTP without DNS changes or external requests. */
test('Secure cookie 在普通 HTTP 主机不可见，普通 cookie 保持可用', async ({ page }) => {
  await page.route('http://storage-web.test:4180/**', async (route) => {
    /** Serve the real fixture from the local Vite server while preserving the browser origin. */
    const response = await route.fetch({
      url: route.request().url().replace('storage-web.test', '127.0.0.1')
    })
    await route.fulfill({ response })
  })
  await page.goto('http://storage-web.test:4180/')
  /** Secure writes must be rejected here in every engine; missing Secure attributes fail this case. */
  const result = await page.evaluate(() => window.runCookieSecureScenario())
  expect(result.insecureVisible).toBe(true)
  expect(result.secureVisible).toBe(false)
})

test('超过约 4KB 的 cookie 值触发 VALUE_TOO_LARGE（应用层先行拦截）', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(() => window.runCookieSizeLimitScenario())
  expect(result.code).toBe('VALUE_TOO_LARGE')
})

test('同名不同 path 的真实 cookie 不会被静默折叠为单一 scope', async ({ page }) => {
  await page.goto('/nested/')
  await expect(page.evaluate(() => window.runCookieDuplicateScopeScenario())).resolves.toEqual({
    duplicateVisible: true,
    codes: Array.from({ length: 7 }, () => 'COOKIE_SCOPE_AMBIGUOUS')
  })
})

test('真实浏览器 cookie scope 数组配置被拒绝', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(() => window.runCookieScopeGuardScenario())
  expect(result.scopeCode).toBe('INVALID_CONFIG')
  expect(result.codecCode).toBe('INVALID_CONFIG')
  expect(result.documentCode).toBe('INVALID_CONFIG')
  expect(result.optionsCode).toBe('INVALID_CONFIG')
  expect(result.expiresCode).toBe('INVALID_CONFIG')
  expect(result.maxAgeCode).toBe('INVALID_CONFIG')
  expect(result.expiresReads).toBe(1)
  expect(result.constructorOptionReads).toBe(4)
  expect(result.scopeReads).toBe(5)
  expect(result.removeContextReads).toBe(2)
  expect(result.snapshotValue).toBe('value')
  expect(result.documentReadCode).toBe('BACKEND_UNAVAILABLE')
  expect(result.documentTypeDriftCode).toBe('BACKEND_UNAVAILABLE')
  expect(result.documentWriteCode).toBe('WRITE_FAILED')
  expect(result.partialClearCode).toBe('WRITE_FAILED')
  expect(result.partialClearOperation).toBe('cookie.clearAll')
  expect(result.partialClearKey).toBe('second')
  expect(result.snapshotClearCode).toBe('BACKEND_UNAVAILABLE')
  expect(result.snapshotClearOperation).toBe('cookie.clearAll')
  expect(result.reentrantAbortCode).toBe('ABORTED')
  expect(result.reentrantAbortOperation).toBeUndefined()
  expect(result.reentrantAbortKeyMatchesRemaining).toBe(false)
  expect(result.syncRemoveOverrideReads).toBe(0)
  expect(result.writeContextReads).toBe(4)
  expect(result.writeContextReturnedPromise).toBe(true)
  expect(result.writeContextGetterCode).toBe('INVALID_CONFIG')
  expect(result.writeLifecycleMetadata).toBe(true)
  expect(result.removeLifecycleMetadata).toBe(true)
})

import { test, expect } from '@playwright/test';

test('Secure cookie 遵循真实浏览器的 loopback 语义，普通 cookie 也正常', async ({
  page,
  browserName
}) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runCookieSecureScenario());
  expect(result.insecureVisible).toBe(true);
  // Chromium treats loopback HTTP as trustworthy here; WebKit rejects Secure
  // cookies on the same HTTP origin. Both are valid browser-level outcomes.
  expect(result.secureVisible).toBe(browserName === 'chromium');
});

test('超过约 4KB 的 cookie 值触发 VALUE_TOO_LARGE（应用层先行拦截）', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runCookieSizeLimitScenario());
  expect(result.code).toBe('VALUE_TOO_LARGE');
});

test('同名不同 path 的真实 cookie 不会被静默折叠为单一 scope', async ({ page }) => {
  await page.goto('/nested/');
  await expect(page.evaluate(() => window.runCookieDuplicateScopeScenario())).resolves.toEqual({
    duplicateVisible: true,
    codes: Array.from({ length: 7 }, () => 'COOKIE_SCOPE_AMBIGUOUS')
  });
});

test('真实浏览器 cookie scope 数组配置被拒绝', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runCookieScopeGuardScenario());
  expect(result.scopeCode).toBe('INVALID_CONFIG');
  expect(result.codecCode).toBe('INVALID_CONFIG');
  expect(result.documentCode).toBe('INVALID_CONFIG');
  expect(result.optionsCode).toBe('INVALID_CONFIG');
  expect(result.expiresCode).toBe('INVALID_CONFIG');
  expect(result.maxAgeCode).toBe('INVALID_CONFIG');
  expect(result.expiresReads).toBe(1);
  expect(result.constructorOptionReads).toBe(4);
  expect(result.scopeReads).toBe(5);
  expect(result.removeContextReads).toBe(2);
  expect(result.snapshotValue).toBe('value');
  expect(result.documentReadCode).toBe('BACKEND_UNAVAILABLE');
  expect(result.documentTypeDriftCode).toBe('BACKEND_UNAVAILABLE');
  expect(result.documentWriteCode).toBe('WRITE_FAILED');
  expect(result.partialClearCode).toBe('WRITE_FAILED');
  expect(result.partialClearOperation).toBe('cookie.clearAll');
  expect(result.partialClearKey).toBe('second');
  expect(result.snapshotClearCode).toBe('BACKEND_UNAVAILABLE');
  expect(result.snapshotClearOperation).toBe('cookie.clearAll');
  expect(result.reentrantAbortCode).toBe('ABORTED');
  expect(result.reentrantAbortOperation).toBeUndefined();
  expect(result.reentrantAbortKeyMatchesRemaining).toBe(false);
  expect(result.syncRemoveOverrideReads).toBe(0);
  expect(result.writeContextReads).toBe(4);
  expect(result.writeContextReturnedPromise).toBe(true);
  expect(result.writeContextGetterCode).toBe('INVALID_CONFIG');
  expect(result.writeLifecycleMetadata).toBe(true);
  expect(result.removeLifecycleMetadata).toBe(true);
});

import { expect, test } from '@playwright/test';

test('RTCDataChannel loopback performs RPC and reaches terminal state', async ({ page }) => {
  await page.goto('/e2e/fixtures/index.html?scenario=rtc-data-channel');
  await page.evaluate(() => globalThis.e2eReady);
  const result = (await page.evaluate(() => globalThis.runRtcScenario())) as {
    result: string;
    terminal: string;
    errors: string[];
    snapshots: {
      left: { phase: string; pending: number; resources: number };
      right: { phase: string; pending: number; resources: number };
    };
  };
  expect(result.result).toBe('rtc-ok');
  expect(result.terminal).toBe('TRANSPORT');
  expect(result.errors).toEqual([]);
  expect(result.snapshots).toMatchObject({
    left: { phase: 'disposed', pending: 0, resources: 0 },
    right: { phase: 'disposed', pending: 0, resources: 0 }
  });
});

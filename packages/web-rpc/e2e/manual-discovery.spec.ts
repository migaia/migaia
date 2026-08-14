import { expect, test } from '@playwright/test';

test('MessagePort manual discovery accepts a candidate before request', async ({ page }) => {
  await page.goto('/e2e/fixtures/index.html?scenario=manual-discovery');
  await page.evaluate(() => globalThis.e2eReady);
  const result = (await page.evaluate(() => globalThis.runManualDiscoveryScenario())) as {
    candidates: readonly { targetId: string; receiverId?: string }[];
    rejectedCandidates: readonly unknown[];
    timedOutCandidates: readonly unknown[];
    abortedCandidates: readonly unknown[];
    disposeQueryResult: string | undefined;
    result: { manual: boolean };
    snapshots: {
      client: {
        pending: number;
        discovery: { waiters: number; tasks: number; timers: number };
      };
      server: {
        pending: number;
        discovery: { waiters: number; tasks: number; timers: number };
      };
    };
    errors: string[];
  };
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({ targetId: 'server' });
  expect(result.result).toEqual({ manual: true });
  expect(result.rejectedCandidates).toEqual([]);
  expect(result.timedOutCandidates).toEqual([]);
  expect(result.abortedCandidates).toEqual([]);
  expect(result.disposeQueryResult).toBe('endpoint disposed');
  expect(result.snapshots).toMatchObject({
    client: {
      pending: 0,
      discovery: { waiters: 0, tasks: 0, timers: 0 }
    },
    server: {
      pending: 0,
      discovery: { waiters: 0, tasks: 0, timers: 0 }
    }
  });
  expect(result.errors).toEqual([]);
});

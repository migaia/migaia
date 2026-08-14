import { expect, test } from '@playwright/test';

test('DedicatedWorker supports concurrent RPC and terminal convergence', async ({ page }) => {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/e2e/fixtures/index.html?scenario=dedicated-worker');
  await page.evaluate(() => globalThis.e2eReady);
  const result = (await page.evaluate(() => globalThis.runDedicatedWorkerScenario())) as {
    values: number[];
    chunkedRequest: string;
    chunkedTimeout: string;
    dispatchPayload: string;
    remoteError: string;
    abortedResult: string;
    schemaError: string;
    pingSuccess: boolean;
    pingTimeout: boolean;
    pingAborted: boolean;
    activePageSnapshot: {
      phase: string;
      pending: number;
      chunks: number;
      activeControllers: number;
    };
    terminal: string;
    errors: string[];
    workerErrors: string[];
    workerSnapshot: { phase: string; pending: number; resources: number };
    pageSnapshot: { phase: string; pending: number; resources: number };
  };
  expect(result.values).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(result.chunkedRequest).toBe('worker-chunked-request-😀');
  expect(result.chunkedTimeout).toBe('DEADLINE_EXCEEDED');
  expect(result.dispatchPayload).toBe('worker-chunked-dispatch-😀');
  expect(result.remoteError).toBe('REMOTE_FAILURE');
  expect(result.abortedResult).toBe('CANCELLED');
  expect(result.schemaError).toBe('SCHEMA_INVALID');
  expect(result.pingSuccess).toBe(true);
  expect(result.pingTimeout).toBe(false);
  expect(result.pingAborted).toBe(false);
  expect(result.activePageSnapshot).toMatchObject({
    phase: 'active',
    pending: 0,
    chunks: 0,
    activeControllers: 0
  });
  expect(result.terminal).toBe('DEADLINE_EXCEEDED');
  expect(result.errors).toEqual([]);
  expect(result.workerErrors).toEqual([]);
  expect(result.workerSnapshot).toMatchObject({ phase: 'disposed', pending: 0, resources: 0 });
  expect(result.pageSnapshot).toMatchObject({ phase: 'disposed', pending: 0, resources: 0 });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

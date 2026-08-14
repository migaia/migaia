import { expect, test } from '@playwright/test';

test('Window iframe proves source/origin and rejects sibling spoof', async ({ page }) => {
  await page.goto('/e2e/fixtures/index.html?scenario=window-iframe');
  await page.evaluate(() => globalThis.e2eReady);
  const result = (await page.evaluate(() => globalThis.runWindowIframeScenario())) as {
    echo: string;
    chunkedRequest: string;
    chunkedTimeout: string;
    dispatchPayload: string;
    remoteError: string;
    aborted: string;
    schemaError: string;
    pingSuccess: boolean;
    pingTimeout: boolean;
    pingAborted: boolean;
    parentResult: number;
    providerCalls: number;
    removedResult: string;
    activeSnapshot: {
      phase: string;
      pending: number;
      pingPending: number;
      activeControllers: number;
      chunks: number;
    };
    errors: string[];
    listenerAdds: number;
    listenerRemoves: number;
    snapshot: {
      phase: string;
      pending: number;
      pingPending: number;
      activeControllers: number;
      chunks: number;
      providers: number;
      events: number;
      hooks: number;
      resources: number;
      discovery: Record<string, number>;
    };
  };
  expect(result.echo).toBe('window-ok');
  expect(result.chunkedRequest).toBe('window-chunked-request-😀');
  expect(result.chunkedTimeout).toBe('DEADLINE_EXCEEDED');
  expect(result.dispatchPayload).toBe('window-chunked-dispatch-😀');
  expect(result.remoteError).toBe('REMOTE_FAILURE');
  expect(result.aborted).toBe('CANCELLED');
  expect(result.schemaError).toBe('SCHEMA_INVALID');
  expect(result.pingSuccess).toBe(true);
  expect(result.pingTimeout).toBe(false);
  expect(result.pingAborted).toBe(false);
  expect(result.parentResult).toBe(1);
  expect(result.providerCalls).toBe(1);
  expect(result.removedResult).toBe('DEADLINE_EXCEEDED');
  expect(result.activeSnapshot).toMatchObject({
    phase: 'active',
    pending: 0,
    pingPending: 0,
    activeControllers: 0,
    chunks: 0
  });
  expect(result.errors).toEqual([]);
  expect(result.listenerAdds).toBe(1);
  expect(result.listenerRemoves).toBe(1);
  expect(result.snapshot).toMatchObject({
    phase: 'disposed',
    pending: 0,
    pingPending: 0,
    activeControllers: 0,
    chunks: 0,
    providers: 0,
    events: 0,
    hooks: 0,
    resources: 0,
    discovery: {
      local: 0,
      remote: 0,
      waiters: 0,
      tasks: 0,
      timers: 0,
      manualWaiters: 0,
      inboundQueries: 0,
      inboundTimers: 0
    }
  });
});

test('Window iframe proves the same source boundary across origins', async ({ page }) => {
  await page.goto('/e2e/fixtures/index.html?scenario=window-iframe&origin=cross');
  await page.evaluate(() => globalThis.e2eReady);
  const result = (await page.evaluate(() => globalThis.runWindowIframeScenario())) as {
    echo: string;
    parentResult: number;
    providerCalls: number;
    removedResult: string;
    errors: string[];
    listenerAdds: number;
    listenerRemoves: number;
    snapshot: { phase: string; pending: number; resources: number };
  };
  expect(result.echo).toBe('window-ok');
  expect(result.parentResult).toBe(1);
  expect(result.providerCalls).toBe(1);
  expect(result.removedResult).toBe('DEADLINE_EXCEEDED');
  expect(result.errors).toEqual([]);
  expect(result.listenerAdds).toBe(1);
  expect(result.listenerRemoves).toBe(1);
  expect(result.snapshot).toMatchObject({ phase: 'disposed', pending: 0, resources: 0 });
});

test('Window iframe rejects a request forged by a different origin', async ({ page }) => {
  await page.goto('/e2e/fixtures/index.html?scenario=window-iframe&spoof=cross');
  await page.evaluate(() => globalThis.e2eReady);
  const result = (await page.evaluate(() => globalThis.runWindowIframeScenario())) as {
    echo: string;
    parentResult: number;
    providerCalls: number;
    removedResult: string;
    errors: string[];
    listenerAdds: number;
    listenerRemoves: number;
  };
  expect(result.echo).toBe('window-ok');
  expect(result.parentResult).toBe(1);
  expect(result.providerCalls).toBe(1);
  expect(result.removedResult).toBe('DEADLINE_EXCEEDED');
  expect(result.errors).toEqual([]);
  expect(result.listenerAdds).toBe(1);
  expect(result.listenerRemoves).toBe(1);
});

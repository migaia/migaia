import { expect, test } from '@playwright/test';

test('BroadcastChannel discovers identified receivers and pins one safely', async ({ context }) => {
  const serverA = await context.newPage();
  const serverB = await context.newPage();
  const client = await context.newPage();
  const attacker = await context.newPage();
  await Promise.all(
    [serverA, serverB, client, attacker].map((page) =>
      page.goto('/e2e/fixtures/index.html?scenario=broadcast-channel')
    )
  );
  await Promise.all(
    [serverA, serverB, client, attacker].map((page) => page.evaluate(() => globalThis.e2eReady))
  );
  await Promise.all([
    serverA.evaluate(() => globalThis.startBroadcastServer('server-a', 'A')),
    serverB.evaluate(() => globalThis.startBroadcastServer('server-b', 'B')),
    client.evaluate(() => globalThis.startBroadcastClient()),
    attacker.evaluate(() => globalThis.startBroadcastAttacker())
  ]);
  const first = (await client.evaluate(() => globalThis.sendBroadcast('cold'))) as {
    label: string;
  };
  expect(['A', 'B']).toContain(first.label);
  await expect.poll(() => client.evaluate(() => globalThis.broadcastServers().length)).toBe(2);
  const servers = await client.evaluate(() => globalThis.broadcastServers());
  expect(servers.some((entry) => entry.uniqueTargetId === 'attacker')).toBe(false);
  const serverBId = servers.find((entry) => entry.uniqueTargetId === 'server-b')!.receiverId;
  await client.evaluate((receiverId) => globalThis.pinBroadcast(receiverId), serverBId);
  await expect(client.evaluate(() => globalThis.sendBroadcast('pinned'))).resolves.toEqual({
    label: 'B',
    value: 'pinned'
  });
  await expect(client.evaluate(() => globalThis.sendBroadcastTerminal())).resolves.toEqual({
    chunkedRequest: 'broadcast-chunked-request-😀',
    chunkedRemoteError: 'REMOTE_FAILURE',
    chunkedTimeout: 'DEADLINE_EXCEEDED',
    remoteError: 'REMOTE_FAILURE',
    timeout: 'DEADLINE_EXCEEDED',
    aborted: 'CANCELLED',
    schemaError: 'SCHEMA_INVALID',
    activeSnapshot: expect.objectContaining({
      phase: 'active',
      pending: 0,
      chunks: 0,
      activeControllers: 0
    })
  });
  await client.evaluate(() => globalThis.unpinBroadcast());
  expect(await client.evaluate(() => globalThis.disposeBroadcast())).toEqual([]);
  await Promise.all([
    serverA.evaluate(() => globalThis.disposeBroadcast()),
    serverB.evaluate(() => globalThis.disposeBroadcast()),
    attacker.evaluate(() => globalThis.disposeBroadcast())
  ]);
});

test('authenticated BroadcastChannel rejects an observed forged response', async ({ context }) => {
  const server = await context.newPage();
  const client = await context.newPage();
  const attacker = await context.newPage();
  await Promise.all(
    [server, client, attacker].map((page) =>
      page.goto('/e2e/fixtures/index.html?scenario=broadcast-channel')
    )
  );
  await Promise.all(
    [server, client, attacker].map((page) => page.evaluate(() => globalThis.e2eReady))
  );
  await Promise.all([
    server.evaluate(() => globalThis.startAuthenticatedBroadcastServer()),
    client.evaluate(() => globalThis.startAuthenticatedBroadcastClient()),
    attacker.evaluate(() => globalThis.startAuthenticatedBroadcastAttacker())
  ]);
  await expect(client.evaluate(() => globalThis.sendBroadcast('authenticated'))).resolves.toEqual({
    value: 'authenticated',
    trusted: true
  });
  expect(await server.evaluate(() => globalThis.broadcastProviderCalls())).toBe(1);
  await expect(client.evaluate(() => globalThis.pingBroadcast())).resolves.toBe(true);
  await expect(client.evaluate(() => globalThis.dispatchBroadcast())).resolves.toBe(
    'broadcast-chunked-dispatch-😀'
  );
  await expect(client.evaluate(() => globalThis.pingBroadcastTerminal())).resolves.toEqual({
    success: true,
    timeout: false,
    aborted: false
  });
  expect(await client.evaluate(() => globalThis.disposeBroadcast())).toEqual([]);
  expect(await client.evaluate(() => globalThis.broadcastSnapshot())).toMatchObject({
    phase: 'disposed',
    pending: 0,
    pingPending: 0,
    activeControllers: 0,
    chunks: 0,
    resources: 0,
    discovery: {
      waiters: 0,
      tasks: 0,
      timers: 0,
      manualWaiters: 0,
      inboundQueries: 0,
      inboundTimers: 0
    }
  });
  await Promise.all([
    server.evaluate(() => globalThis.disposeBroadcast()),
    attacker.evaluate(() => globalThis.disposeBroadcast())
  ]);
  expect(await server.evaluate(() => globalThis.broadcastSnapshot())).toMatchObject({
    phase: 'disposed',
    pending: 0,
    pingPending: 0,
    activeControllers: 0,
    chunks: 0,
    resources: 0,
    discovery: {
      waiters: 0,
      tasks: 0,
      timers: 0,
      manualWaiters: 0,
      inboundQueries: 0,
      inboundTimers: 0
    }
  });
});

test('anonymous BroadcastChannel completes honest-peer discovery as one logical group', async ({
  context
}) => {
  const server = await context.newPage();
  const client = await context.newPage();
  await Promise.all(
    [server, client].map((page) => page.goto('/e2e/fixtures/index.html?scenario=broadcast-channel'))
  );
  await Promise.all([server, client].map((page) => page.evaluate(() => globalThis.e2eReady)));
  await server.evaluate(() => globalThis.startAnonymousBroadcastServer());
  await client.evaluate(() => globalThis.startAnonymousBroadcastClient());

  const outcome = await client.evaluate(async () => {
    try {
      return { value: await globalThis.sendBroadcast('honest') };
    } catch (error) {
      return { error: String(error), diagnostics: await globalThis.disposeBroadcast() };
    }
  });
  expect(outcome).toEqual({ value: { value: 'honest', mode: 'anonymous' } });
  await expect.poll(() => client.evaluate(() => globalThis.broadcastServers().length)).toBe(1);
  const clientErrors = await client.evaluate(() => globalThis.disposeBroadcast());
  const serverErrors = await server.evaluate(() => globalThis.disposeBroadcast());
  expect(clientErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});

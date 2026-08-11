import { describe, expect, it } from 'vitest';
import { WebRpcEndpoint } from '../src/endpoint';
import { createMemoryTransportPair } from '../src/adapters/memory';
import { readEndpointDebugSnapshot } from '../src/internal/test-observer';

describe('endpoint test-only lifecycle observer', () => {
  it('proves request and registry resources return to zero after disposal', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const server = new WebRpcEndpoint('server', serverTransport, {
      echo: (context) => context.success(context.data)
    });
    const client = new WebRpcEndpoint('client', clientTransport, {
      local: (context) => context.success(context.data)
    });

    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'active',
      pending: 0,
      pingPending: 0,
      activeControllers: 0,
      chunks: 0
    });
    await expect(client.send('server', 'echo', 'value')).resolves.toBe('value');
    await client.dispose();
    await server.dispose();

    expect(readEndpointDebugSnapshot(client)).toMatchObject({
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
});

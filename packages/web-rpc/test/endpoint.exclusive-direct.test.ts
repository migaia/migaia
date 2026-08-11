import { describe, expect, it } from 'vitest';
import { WebRpcEndpoint } from '../src/endpoint';
import { createMemoryTransportPair } from '../src/adapters/memory';

describe('WebRpcEndpoint exclusive direct routing', () => {
  it('does not require a discovery responder on an explicit exclusive channel', async () => {
    const [clientBase, serverTransport] = createMemoryTransportPair();
    const clientTransport = {
      ...clientBase,
      send(message: unknown, options?: Parameters<typeof clientBase.send>[1]) {
        if (
          message &&
          typeof message === 'object' &&
          (message as { kind?: unknown }).kind === 'discovery-query'
        )
          return;
        return clientBase.send(message, options);
      }
    };
    const server = new WebRpcEndpoint(
      'server',
      serverTransport,
      { echo: (context) => context.success(context.data) },
      { connect: { transport: serverTransport } }
    );
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      targetIds: ['server'],
      connect: { transport: clientTransport },
      timeout: { timeoutMs: 50 }
    });
    try {
      await expect(client.send('server', 'echo', 'direct')).resolves.toBe('direct');
    } finally {
      await client.dispose();
      await server.dispose();
    }
  });
});

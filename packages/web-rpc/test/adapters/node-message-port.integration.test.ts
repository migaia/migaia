import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { WebRpcEndpoint } from '../../src/endpoint';
import { createNodeMessagePortTransport } from '../../src/adapters/message-port';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';

describe('Node MessagePort integration', () => {
  it('reports native messageerror without entering the terminal closed state', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const port = {
      postMessage: () => undefined,
      on: (event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
      },
      off: (event: string) => {
        listeners.delete(event);
      }
    };
    const transport = createNodeMessagePortTransport(port);
    const errors: unknown[] = [];
    transport.onTransportError?.((error) => errors.push(error));
    transport.subscribe(() => undefined);

    listeners.get('messageerror')?.(new Error('malformed frame'));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(
      expect.objectContaining({ message: expect.stringContaining('deserialize') })
    );
    expect(transport.closed).toBe(false);
    expect(() => transport.send('still-open')).not.toThrow();
  });

  it('publishes a native remote close as terminal and rejects later work', async () => {
    const channel = new MessageChannel();
    const transport = createNodeMessagePortTransport(channel.port1);
    const terminal = new Promise<unknown>((resolve) => {
      transport.onTransportError?.(resolve);
    });
    transport.subscribe(() => undefined);

    channel.port2.close();
    await expect(terminal).resolves.toEqual(expect.any(Error));
    expect(transport.closed).toBe(true);
    expect(() => transport.send('late')).toThrow('closed');
    expect(() => transport.subscribe(() => undefined)).toThrow('closed');
    channel.port1.close();
  });

  it('runs bidirectional RPC over native worker_threads MessageChannel and disposes both ends', async () => {
    const channel = new MessageChannel();
    const server = new WebRpcEndpoint('server', createNodeMessagePortTransport(channel.port1), {
      echo: (context) => context.success(context.data)
    });
    const client = new WebRpcEndpoint(
      'client',
      createNodeMessagePortTransport(channel.port2),
      undefined,
      { targetIds: ['server'] }
    );

    try {
      await expect(client.send('server', 'echo', { native: true })).resolves.toEqual({
        native: true
      });
    } finally {
      await client.dispose();
      await server.dispose();
      channel.port1.close();
      channel.port2.close();
    }

    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      resources: 0
    });
    expect(readEndpointDebugSnapshot(server)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      resources: 0
    });
  });
});

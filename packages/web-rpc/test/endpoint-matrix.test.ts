import { describe, expect, it } from 'vitest';
import { WebRpcEndpoint } from '../src/endpoint';
import {
  WebRpcAbortError,
  WebRpcRemoteError,
  WebRpcSchemaValidationError,
  WebRpcTimeoutError
} from '../src/errors';
import { createMemoryTransportPair } from '../src/adapters/memory';
import { readEndpointDebugSnapshot } from '../src/internal/test-observer';

type ICase = {
  readonly name: string;
  readonly run: (client: WebRpcEndpoint<'server'>) => Promise<void>;
};

/** Exercises the terminal-state matrix against the deterministic Memory adapter. */
describe('endpoint operation × terminal matrix', () => {
  const cases: readonly ICase[] = [
    {
      name: 'success',
      run: async (client) => {
        await expect(client.send('server', 'echo', 'ok')).resolves.toBe('ok');
      }
    },
    {
      name: 'remote error',
      run: async (client) => {
        await expect(client.send('server', 'fail', null)).rejects.toBeInstanceOf(WebRpcRemoteError);
      }
    },
    {
      name: 'schema error',
      run: async (client) => {
        await expect(client.send('server', 'schema', null)).rejects.toBeInstanceOf(
          WebRpcSchemaValidationError
        );
      }
    },
    {
      name: 'timeout',
      run: async (client) => {
        await expect(client.send('server', 'hang', null, { timeoutMs: 1 })).rejects.toBeInstanceOf(
          WebRpcTimeoutError
        );
      }
    },
    {
      name: 'caller abort',
      run: async (client) => {
        const controller = new AbortController();
        const pending = client.send('server', 'hang', null, {
          timeoutMs: 1_000,
          signal: controller.signal
        });
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(WebRpcAbortError);
      }
    },
    {
      name: 'endpoint dispose',
      run: async (client) => {
        const pending = client.send('server', 'hang', null, { timeoutMs: 1_000 });
        await client.dispose();
        await expect(pending).rejects.toThrow('endpoint disposed');
      }
    }
  ];

  for (const operationCase of cases)
    it(operationCase.name, async () => {
      const [clientTransport, serverTransport] = createMemoryTransportPair();
      const server = new WebRpcEndpoint('server', serverTransport, {
        echo: (context) => context.success(context.data),
        fail: (context) => context.failed('remote failure', 'REMOTE_FAILURE'),
        schema: (context) => context.success(context.data),
        hang: async () => await new Promise<never>(() => undefined)
      });
      const contract = {
        schemas: {
          schema: {
            params: {
              parse: () => {
                throw new Error('schema rejected');
              }
            },
            result: { parse: (value: unknown) => value }
          }
        }
      };
      const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
        targetIds: ['server'],
        contract
      });
      try {
        await operationCase.run(client);
      } finally {
        await client.dispose();
        await server.dispose();
      }
    });
});

it('converges encode failure without retaining pending resources', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint('server', serverTransport);
  const client = new WebRpcEndpoint('client', clientTransport, undefined, {
    targetIds: ['server'],
    protocol: {
      encode: () => {
        throw new Error('encode rejected');
      }
    }
  });
  try {
    const before = readEndpointDebugSnapshot(client)!.resources;
    await expect(client.send('server', 'echo', null)).rejects.toThrow('Protocol encode failed');
    expect(readEndpointDebugSnapshot(client)).toMatchObject({ pending: 0, resources: before });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('WR-R5-1: converges dispatch encode failure without retaining its operation scope', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint('server', serverTransport, {
    echo: (context) => context.success(context.data),
    notify: (context) => context.success(undefined)
  });
  // The protocol only poisons the dispatch payload itself (method 'notify'); a warmup
  // request is used first so target discovery/resolution — which also calls #send() and
  // encode() — completes before poisoning, isolating the dispatch-specific code path.
  let poison = false;
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server'],
    protocol: {
      encode: (value: unknown) => {
        if (poison && (value as { method?: string }).method === 'notify')
          throw new Error('encode rejected');
        return value;
      }
    }
  });
  try {
    await client.send('server', 'echo', 'warmup');
    poison = true;
    const before = readEndpointDebugSnapshot(client)!.resources;
    client.dispatch('server', 'notify', { value: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // #dispatchInternal must release the operation scope and the outbound id it reserved
    // even when the synchronous #send() call throws before .finally() is ever attached.
    expect(readEndpointDebugSnapshot(client)).toMatchObject({ pending: 0, resources: before });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('converges a transport failure and releases pending resources', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint('server', serverTransport, {
    hang: async () => await new Promise<never>(() => undefined)
  });
  const client = new WebRpcEndpoint('client', clientTransport, undefined, {
    targetIds: ['server']
  });
  try {
    const pending = client.send('server', 'hang', null, { timeoutMs: 1_000 });
    serverTransport.close();
    // Memory close is a transport terminal that also closes the endpoint admission gate.
    await expect(pending).rejects.toMatchObject({ code: 'ENDPOINT_DISPOSED' });
    expect(readEndpointDebugSnapshot(client)).toMatchObject({ pending: 0 });
  } finally {
    await client.dispose().catch(() => undefined);
    await server.dispose().catch(() => undefined);
  }
});

it('converges dispatch-only delivery and releases its operation scope', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const received: unknown[] = [];
  const server = new WebRpcEndpoint('server', serverTransport, {
    notify: (context) => {
      received.push(context.data);
      return context.success(undefined);
    }
  });
  const client = new WebRpcEndpoint<'server' | 'missing'>('client', clientTransport, undefined, {
    targetIds: ['server', 'missing']
  });
  try {
    const before = readEndpointDebugSnapshot(client)!.resources;
    client.dispatch('server', 'notify', { value: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual([{ value: 1 }]);
    expect(readEndpointDebugSnapshot(client)).toMatchObject({ pending: 0, resources: before });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('converges dispatch operation when the endpoint is disposed before delivery', async () => {
  const [clientTransport] = createMemoryTransportPair();
  const client = new WebRpcEndpoint<'missing'>('client', clientTransport, undefined, {
    targetIds: ['missing'],
    timeout: { timeoutMs: false }
  });
  try {
    client.dispatch('missing', 'notify', { value: 1 });
    await client.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      resources: 0
    });
  } finally {
    await client.dispose();
  }
});

it('converges ping success, timeout, and caller abort without retaining resources', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint('server', serverTransport);
  const client = new WebRpcEndpoint<'server' | 'missing'>('client', clientTransport, undefined, {
    targetIds: ['server', 'missing']
  });
  try {
    const before = readEndpointDebugSnapshot(client)!.resources;
    await expect(client.ping('server')).resolves.toBe(true);
    await expect(client.ping('missing', undefined, { timeoutMs: 1 })).resolves.toBe(false);
    const afterTimeout = readEndpointDebugSnapshot(client)!.resources;
    const controller = new AbortController();
    const aborted = client.ping('server', undefined, { signal: controller.signal });
    controller.abort();
    await expect(aborted).resolves.toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      pending: 0,
      pingPending: 0,
      resources: afterTimeout
    });
    expect(afterTimeout).toBeGreaterThanOrEqual(before);
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('converges ping caller state when the endpoint is disposed', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint('server', serverTransport);
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server']
  });
  try {
    const pending = client.ping('server', undefined, { timeoutMs: 1_000 });
    await client.dispose();
    await expect(pending).resolves.toBe(false);
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'disposed',
      pingPending: 0,
      resources: 0
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('converges chunked dispatch and releases chunk assembly resources', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const received: unknown[] = [];
  const server = new WebRpcEndpoint('server', serverTransport, undefined, {
    chunk: { chunkSize: 4 }
  });
  server.on('notify', (context) => {
    received.push(context.data);
  });
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server'],
    chunk: { chunkSize: 4 }
  });
  try {
    const before = readEndpointDebugSnapshot(client)!;
    client.dispatch('server', 'notify', 'chunked-😀-dispatch');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toEqual(['chunked-😀-dispatch']);
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      pending: 0,
      chunks: 0,
      resources: before.resources
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('converges automatic discovery timeout without waiter or timer residue', async () => {
  const [clientTransport] = createMemoryTransportPair();
  const client = new WebRpcEndpoint<'missing'>('client', clientTransport, undefined, {
    timeout: { timeoutMs: false }
  });
  try {
    const before = readEndpointDebugSnapshot(client)!;
    await expect(client.send('missing', 'echo', null, { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED'
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      pending: 0,
      resources: before.resources,
      discovery: { waiters: 0, tasks: 0, timers: 0 }
    });
  } finally {
    await client.dispose();
  }
});

it('converges manual discovery caller abort and endpoint dispose', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    connect: { transport: clientTransport, discoveryMode: 'manual', verify: () => true }
  });
  const server = new WebRpcEndpoint<'client'>('server', serverTransport, undefined, {
    connect: { transport: serverTransport, discoveryMode: 'manual', verify: () => true }
  });
  try {
    const controller = new AbortController();
    const aborted = client.connect.query?.('server', {
      timeoutMs: 1_000,
      signal: controller.signal
    });
    controller.abort();
    await expect(aborted).rejects.toThrow('Discovery aborted');
    const pending = client.connect.query?.('server', { timeoutMs: 1_000 });
    await client.dispose();
    await expect(pending).rejects.toThrow(/endpoint disposed/i);
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      pending: 0,
      resources: 0,
      discovery: { waiters: 0, tasks: 0, timers: 0, manualWaiters: 0, inboundQueries: 0 }
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('releases provider controller immediately on caller abort', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint('server', serverTransport, {
    hang: (context) =>
      new Promise((resolve) =>
        context.signal.addEventListener(
          'abort',
          () => resolve(context.failed('aborted', 'CANCELLED')),
          { once: true }
        )
      )
  });
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server']
  });
  try {
    const before = readEndpointDebugSnapshot(server)!.resources;
    const controller = new AbortController();
    const pending = client.send('server', 'hang', null, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readEndpointDebugSnapshot(server)).toMatchObject({
      activeControllers: 0,
      resources: before
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('aborts the provider operation when the caller endpoint is disposed', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  let providerAborted = false;
  const server = new WebRpcEndpoint('server', serverTransport, {
    hang: (context) =>
      new Promise((resolve) =>
        context.signal.addEventListener(
          'abort',
          () => {
            providerAborted = true;
            resolve(context.failed('disposed', 'CANCELLED'));
          },
          { once: true }
        )
      )
  });
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server']
  });
  try {
    const pending = client.send('server', 'hang', null, { timeoutMs: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await server.dispose();
    await expect(pending).rejects.toThrow(/endpoint disposed|deadline exceeded/i);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(providerAborted).toBe(true);
    expect(readEndpointDebugSnapshot(server)).toMatchObject({
      phase: 'disposed',
      activeControllers: 0,
      resources: 0
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('releases provider operation scopes after remote error and timeout', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint(
    'server',
    serverTransport,
    {
      fail: (context) => context.failed('provider failure', 'REMOTE_FAILURE'),
      hang: (context) =>
        new Promise((resolve) =>
          context.signal.addEventListener(
            'abort',
            () => resolve(context.failed('provider aborted', 'CANCELLED')),
            { once: true }
          )
        )
    },
    { features: { abort: true } }
  );
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server']
  });
  try {
    const before = readEndpointDebugSnapshot(server)!;
    await expect(client.send('server', 'fail', null)).rejects.toMatchObject({
      code: 'REMOTE_FAILURE'
    });
    expect(readEndpointDebugSnapshot(server)).toMatchObject({
      activeControllers: 0,
      resources: before.resources
    });
    await expect(client.send('server', 'hang', null, { timeoutMs: 1 })).rejects.toBeInstanceOf(
      WebRpcTimeoutError
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readEndpointDebugSnapshot(server)).toMatchObject({
      activeControllers: 0,
      resources: before.resources
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('releases provider operation scope after inbound schema rejection', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint(
    'server',
    serverTransport,
    { schema: (context) => context.success(context.data) },
    {
      contract: {
        schemas: {
          schema: {
            params: {
              parse: () => {
                throw new Error('provider schema rejected');
              }
            },
            result: { parse: (value) => value }
          }
        }
      }
    }
  );
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server']
  });
  try {
    const before = readEndpointDebugSnapshot(server)!;
    await expect(client.send('server', 'schema', null)).rejects.toMatchObject({
      code: 'SCHEMA_INVALID'
    });
    expect(readEndpointDebugSnapshot(server)).toMatchObject({
      activeControllers: 0,
      resources: before.resources
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('converges chunked request success and releases assembly resources', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint(
    'server',
    serverTransport,
    {
      echo: (context) => context.success(context.data)
    },
    { chunk: { chunkSize: 4 } }
  );
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server'],
    chunk: { chunkSize: 4 }
  });
  try {
    const before = readEndpointDebugSnapshot(client)!;
    await expect(client.send('server', 'echo', 'chunked-request-😀')).resolves.toBe(
      'chunked-request-😀'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      pending: 0,
      chunks: 0,
      resources: before.resources
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('releases chunk resources when a chunked request returns remote error', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint(
    'server',
    serverTransport,
    {
      fail: (context) => context.failed('chunked failure', 'REMOTE_FAILURE')
    },
    { chunk: { chunkSize: 4 } }
  );
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server'],
    chunk: { chunkSize: 4 }
  });
  try {
    const before = readEndpointDebugSnapshot(client)!;
    await expect(client.send('server', 'fail', 'chunked-error-😀')).rejects.toMatchObject({
      code: 'REMOTE_FAILURE'
    });
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      pending: 0,
      chunks: 0,
      resources: before.resources
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('releases chunk resources when a chunked request times out', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint(
    'server',
    serverTransport,
    {
      hang: async () => await new Promise<never>(() => undefined)
    },
    { chunk: { chunkSize: 4 } }
  );
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server'],
    chunk: { chunkSize: 4 }
  });
  try {
    const before = readEndpointDebugSnapshot(client)!;
    await expect(
      client.send('server', 'hang', 'chunked-timeout-😀', { timeoutMs: 1 })
    ).rejects.toBeInstanceOf(WebRpcTimeoutError);
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      pending: 0,
      chunks: 0,
      resources: before.resources
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('releases chunk resources when a chunked request is caller-aborted', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint(
    'server',
    serverTransport,
    {
      hang: async () => await new Promise<never>(() => undefined)
    },
    { chunk: { chunkSize: 4 } }
  );
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server'],
    chunk: { chunkSize: 4 }
  });
  try {
    const before = readEndpointDebugSnapshot(client)!;
    const controller = new AbortController();
    const pending = client.send('server', 'hang', 'chunked-abort-😀', {
      timeoutMs: 1_000,
      signal: controller.signal
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    const after = readEndpointDebugSnapshot(client)!;
    expect(after).toMatchObject({
      pending: 0,
      chunks: 0
    });
    // Abort may retain one replay tombstone; active chunk resources must be gone.
    expect(after.resources).toBeLessThanOrEqual(before.resources + 1);
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('converges chunked request state when the endpoint is disposed', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint(
    'server',
    serverTransport,
    { hang: async () => await new Promise<never>(() => undefined) },
    { chunk: { chunkSize: 4 } }
  );
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server'],
    chunk: { chunkSize: 4 }
  });
  try {
    const pending = client.send('server', 'hang', 'chunked-dispose-😀', { timeoutMs: 1_000 });
    await client.dispose();
    await expect(pending).rejects.toThrow(/endpoint disposed/i);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      chunks: 0,
      resources: 0
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('does not retain chunk resources when chunked request encoding fails', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint('server', serverTransport);
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server'],
    chunk: { chunkSize: 4 },
    protocol: {
      encode: () => {
        throw new Error('chunk encode rejected');
      }
    }
  });
  try {
    const before = readEndpointDebugSnapshot(client)!;
    await expect(client.send('server', 'echo', 'chunked-encode-error-😀')).rejects.toThrow(
      'Protocol encode failed'
    );
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      pending: 0,
      chunks: 0,
      resources: before.resources
    });
  } finally {
    await client.dispose();
    await server.dispose();
  }
});

it('releases chunk resources when transport closes during a chunked request', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint(
    'server',
    serverTransport,
    {
      hang: async () => await new Promise<never>(() => undefined)
    },
    { chunk: { chunkSize: 4 } }
  );
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server'],
    chunk: { chunkSize: 4 }
  });
  try {
    const pending = client.send('server', 'hang', 'chunked-transport-error-😀', {
      timeoutMs: 1_000
    });
    serverTransport.close();
    await expect(pending).rejects.toMatchObject({ code: 'ENDPOINT_DISPOSED' });
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      pending: 0,
      chunks: 0,
      resources: 0
    });
  } finally {
    await client.dispose().catch(() => undefined);
    await server.dispose().catch(() => undefined);
  }
});

it('releases chunk resources when transport closes during chunked dispatch', async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const server = new WebRpcEndpoint(
    'server',
    serverTransport,
    {
      notify: (context) => context.success(undefined)
    },
    { chunk: { chunkSize: 4 } }
  );
  const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
    targetIds: ['server'],
    chunk: { chunkSize: 4 }
  });
  try {
    client.dispatch('server', 'notify', 'chunked-dispatch-transport-error-😀');
    serverTransport.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      pending: 0,
      chunks: 0,
      resources: 0
    });
  } finally {
    await client.dispose().catch(() => undefined);
    await server.dispose().catch(() => undefined);
  }
});

it('converges chunked dispatch state when the endpoint is disposed', async () => {
  const [clientTransport] = createMemoryTransportPair();
  const client = new WebRpcEndpoint<'missing'>('client', clientTransport, undefined, {
    targetIds: ['missing'],
    chunk: { chunkSize: 4 },
    timeout: { timeoutMs: false }
  });
  try {
    client.dispatch('missing', 'notify', 'chunked-dispose-dispatch-😀');
    await client.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      chunks: 0,
      resources: 0
    });
  } finally {
    await client.dispose();
  }
});

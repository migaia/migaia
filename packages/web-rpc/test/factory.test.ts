import { describe, expect, it } from 'vitest';
import { createEndpoint } from '../src/factory';
import { connect } from '../src/middleware/connect';
import { createMemoryTransportPair } from '../src/adapters/memory';
import type { IWebRpcTransport } from '../src/transport';
import type { IWebRpcMiddlewareContext } from '../src/typing';

const transport = (): IWebRpcTransport => ({
  platform: 'Memory',
  send() {},
  subscribe() {
    return () => undefined;
  }
});

describe('factory', () => {
  it('rejects duplicate middleware with the dedicated error code', async () => {
    const middleware = connect({ transport: transport() });
    await expect(
      createEndpoint({ id: 'duplicate', middlewares: [middleware, middleware] })
    ).rejects.toMatchObject({ code: 'MIDDLEWARE_DUPLICATED' });
  });

  it('rejects an invalid transport topology during assembly', async () => {
    const invalid = { ...transport(), topology: 'shared' as never };
    await expect(
      createEndpoint({
        id: 'invalid-topology',
        transport: invalid,
        middlewares: [connect({ transport: invalid })]
      })
    ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' });
  });

  it('cancels construction while middleware installation is pending', async () => {
    const controller = new AbortController();
    const pendingTransport = transport();
    const construction = createEndpoint({
      id: 'pending',
      transport: pendingTransport,
      middlewares: [
        connect({
          transport: pendingTransport,
          uniqueTargetId: () => new Promise<string>(() => undefined)
        })
      ],
      construction: { signal: controller.signal }
    });
    controller.abort();
    await expect(construction).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('rejects construction when unique-target initialization exceeds its deadline', async () => {
    const pendingTransport = transport();
    await expect(
      createEndpoint({
        id: 'deadline',
        transport: pendingTransport,
        middlewares: [
          connect({
            transport: pendingTransport,
            useBaseIdVerifyOnly: false,
            identifier: () => true,
            uniqueTargetId: () => new Promise<string>(() => undefined)
          })
        ],
        construction: { timeoutMs: 1 }
      })
    ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
  });

  it('removes the caller construction-signal listener after success', async () => {
    let added: (() => void) | undefined;
    let removed: (() => void) | undefined;
    const endpointTransport = transport();
    const signal = {
      aborted: false,
      addEventListener(_type: 'abort', listener: () => void) {
        added = listener;
      },
      removeEventListener(_type: 'abort', listener: () => void) {
        removed = listener;
      }
    };
    const endpoint = await createEndpoint({
      id: 'signal-cleanup',
      transport: endpointTransport,
      middlewares: [connect({ transport: endpointTransport })],
      construction: { signal: signal as never }
    });
    expect(removed).toBe(added);
    await endpoint.dispose();
  });

  it('removes the caller construction-signal listener after installation failure', async () => {
    let added: (() => void) | undefined;
    let removed: (() => void) | undefined;
    const endpointTransport = transport();
    const signal = {
      aborted: false,
      addEventListener(_type: 'abort', listener: () => void) {
        added = listener;
      },
      removeEventListener(_type: 'abort', listener: () => void) {
        removed = listener;
      }
    };
    await expect(
      createEndpoint({
        id: 'signal-failure-cleanup',
        transport: endpointTransport,
        middlewares: [
          {
            name: 'fails',
            install: () => {
              throw new Error('install failed');
            }
          },
          connect({ transport: endpointTransport })
        ],
        construction: { signal: signal as never }
      })
    ).rejects.toThrow('install failed');
    expect(removed).toBe(added);
  });

  it('lets middleware observe construction abort and finish its cleanup', async () => {
    const controller = new AbortController();
    let aborted = false;
    const pendingTransport = transport();
    const middleware = {
      name: 'abort-aware',
      install: ({ signal }: IWebRpcMiddlewareContext) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve();
            },
            { once: true }
          );
        })
    };
    const construction = createEndpoint({
      id: 'abort-aware',
      transport: pendingTransport,
      middlewares: [middleware, connect({ transport: pendingTransport })],
      construction: { signal: controller.signal }
    });
    controller.abort();
    await expect(construction).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(aborted).toBe(true);
  });

  it('bounds cleanup when middleware ignores construction cancellation', async () => {
    const controller = new AbortController();
    const pendingTransport = transport();
    const construction = createEndpoint({
      id: 'non-cooperative',
      middlewares: [
        {
          name: 'non-cooperative',
          install: () => new Promise<void>(() => undefined)
        },
        connect({ transport: pendingTransport })
      ],
      transport: pendingTransport,
      construction: { signal: controller.signal }
    });
    controller.abort();
    try {
      await construction;
      throw new Error('construction unexpectedly succeeded');
    } catch (error) {
      expect(error).toMatchObject({ code: 'CANCELLED' });
      const cleanupErrors = await (error as { cleanupPromise?: Promise<readonly unknown[]> })
        .cleanupPromise;
      expect(cleanupErrors).toEqual([expect.objectContaining({ resource: 'middleware' })]);
    }
  });

  it('bootstraps the default connect policy on an exclusive memory transport', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const server = await createEndpoint({
      id: 'server',
      transport: serverTransport,
      provider: { echo: (context) => context.success(context.data) },
      middlewares: [connect({ transport: serverTransport })]
    });
    const client = await createEndpoint({
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    });
    await expect(client.send('server', 'echo', 'factory')).resolves.toBe('factory');
    await client.dispose();
    await server.dispose();
  });

  it('uses factory transport when connect transport is omitted', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const server = await createEndpoint({
      id: 'server',
      transport: serverTransport,
      provider: { echo: (context) => context.success(context.data) },
      middlewares: [connect()]
    });
    const client = await createEndpoint({
      id: 'client',
      transport: clientTransport,
      middlewares: [connect()]
    });
    await expect(client.send('server', 'echo', 'factory-transport')).resolves.toBe(
      'factory-transport'
    );
    await client.dispose();
    await server.dispose();
  });

  it('preserves receiverSelector through the public factory', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    let calls = 0;
    const server = await createEndpoint({
      id: 'server',
      transport: serverTransport,
      provider: { echo: (context) => context.success(context.data) },
      middlewares: [connect({ transport: serverTransport })]
    });
    const client = await createEndpoint({
      id: 'client',
      transport: clientTransport,
      middlewares: [
        connect({
          transport: clientTransport,
          receiverSelector: (serverList, context) => {
            calls += 1;
            expect(context).toMatchObject({
              endpointId: 'client',
              targetId: 'server',
              operation: 'send'
            });
            return serverList[0]?.receiverId;
          }
        })
      ]
    });
    await expect(client.send('server', 'echo', 'factory-selected')).resolves.toBe(
      'factory-selected'
    );
    expect(calls).toBe(1);
    await client.dispose();
    await server.dispose();
  });

  it('keeps a shared discovery session alive when one caller times out', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const server = await createEndpoint({
      id: 'server',
      transport: serverTransport,
      provider: {
        echo: async (context) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return context.success(context.data);
        }
      },
      middlewares: [connect({ transport: serverTransport })]
    });
    const client = await createEndpoint({
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    });
    const timedOut = client.send('server', 'echo', 'first', { timeoutMs: 1 });
    const survivor = client.send('server', 'echo', 'second', { timeoutMs: false });
    await expect(timedOut).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
    await expect(survivor).resolves.toBe('second');
    await client.dispose();
    await server.dispose();
  });

  it('keeps a shared discovery session alive when one caller aborts', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const server = await createEndpoint({
      id: 'server',
      transport: serverTransport,
      provider: {
        echo: async (context) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return context.success(context.data);
        }
      },
      middlewares: [connect({ transport: serverTransport })]
    });
    const client = await createEndpoint({
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    });
    const controller = new AbortController();
    const aborted = client.send('server', 'echo', 'first', { signal: controller.signal });
    const survivor = client.send('server', 'echo', 'second', { timeoutMs: false });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(survivor).resolves.toBe('second');
    await client.dispose();
    await server.dispose();
  });

  it('awaits and snapshots an async uniqueTargetId factory before exposing the endpoint', async () => {
    let calls = 0;
    const endpoint = await createEndpoint({
      id: 'x',
      middlewares: [
        connect({
          transport: transport(),
          useBaseIdVerifyOnly: false,
          identifier: () => true,
          uniqueTargetId: async ({ endpointId, platform }) => {
            calls += 1;
            return `${endpointId}-${platform}`;
          }
        })
      ]
    });
    expect(calls).toBe(1);
    await endpoint.dispose();
  });

  it('requires explicit id, connect and transport', async () => {
    await expect(createEndpoint({ id: 'x', middlewares: [] })).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
    await expect(
      createEndpoint({ id: 'x', transport: transport(), middlewares: [] })
    ).rejects.toMatchObject({ code: 'MIDDLEWARE_MISSING' });
    const endpoint = await createEndpoint({
      id: 'x',
      middlewares: [connect({ transport: transport() })]
    });
    await endpoint.dispose();
  });
  it('normalizes hostile middleware configuration before installation', async () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('middleware getter');
        }
      }
    );
    await expect(
      createEndpoint({
        id: 'x',
        middlewares: [hostile as never]
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it('rejects an unreadable factory descriptor with INVALID_CONFIG', async () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('factory getter');
        }
      }
    );
    await expect(createEndpoint(hostile as never)).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
  });
  it('rejects revoked factory collections with INVALID_CONFIG', async () => {
    const middlewares = Proxy.revocable([], {});
    middlewares.revoke();
    await expect(
      createEndpoint({ id: 'x', middlewares: middlewares.proxy as never })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it('rejects unreadable middleware snapshot collections with INVALID_CONFIG', async () => {
    const middlewares = new Proxy([], {
      get(_target, property) {
        if (property === 'map') throw new Error('middleware map getter');
        return Reflect.get(_target, property);
      }
    });
    await expect(
      createEndpoint({ id: 'x', middlewares: middlewares as never })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it('rejects a hostile replay getter before any middleware installs (WR-R3-2)', async () => {
    let installed = false;
    const spy = {
      name: 'spy',
      install: () => {
        installed = true;
        return {};
      }
    };
    const config = {
      id: 'x',
      middlewares: [connect({ transport: transport() }), spy],
      get replay(): never {
        throw new Error('replay getter');
      }
    };
    await expect(createEndpoint(config as never)).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(installed).toBe(false); // the hostile field must be read before any install() runs
  });
  it('rejects an incomplete canonical transport before middleware install', async () => {
    await expect(
      createEndpoint({
        id: 'x',
        transport: { send() {} } as never,
        middlewares: []
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it('rejects invalid target ids before middleware installation', async () => {
    let installCount = 0;
    const middleware = {
      name: 'probe',
      install() {
        installCount += 1;
      }
    };
    await expect(
      createEndpoint({
        id: 'x',
        targetIds: [''] as never,
        middlewares: [middleware as never]
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(installCount).toBe(0);
  });
  it('rejects target ids over the installed contract limit before endpoint construction', async () => {
    await expect(
      createEndpoint({
        id: 'x',
        targetIds: ['long-target'],
        middlewares: [
          connect({ transport: transport() }),
          {
            name: 'contract',
            install({ capabilities }) {
              capabilities.set('contractCapability', { maxIdentifierLength: 3 });
            }
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it('installs middleware serially and rejects duplicates', async () => {
    const order: string[] = [];
    const middleware = (name: string) => ({
      name,
      install: async () => {
        order.push(name);
      }
    });
    const endpoint = await createEndpoint({
      id: 'x',
      middlewares: [connect({ transport: transport() }), middleware('a'), middleware('b')]
    });
    expect(order).toEqual(['a', 'b']);
    await endpoint.dispose();
    await expect(
      createEndpoint({
        id: 'x',
        middlewares: [connect({ transport: transport() }), middleware('a'), middleware('a')]
      })
    ).rejects.toMatchObject({ code: 'MIDDLEWARE_DUPLICATED' });
  });
  it('owns middleware disposers through endpoint disposal', async () => {
    let disposed = false;
    const endpoint = await createEndpoint({
      id: 'x',
      middlewares: [
        connect({ transport: transport() }),
        {
          name: 'owned',
          install: () => () => {
            disposed = true;
          }
        }
      ]
    });
    await endpoint.dispose();
    expect(disposed).toBe(true);
  });
  it('rejects incompatible encoded transport types during assembly', async () => {
    const channel = {
      platform: 'Memory' as const,
      encodedType: 'string' as const,
      send() {},
      subscribe() {
        return () => undefined;
      }
    };
    await expect(
      createEndpoint({
        id: 'x',
        middlewares: [
          connect({ transport: channel }),
          {
            name: 'protocol',
            install: ({ capabilities }) =>
              capabilities.set('protocolCapability', {
                encode: (value: unknown) => value,
                decode: (value: unknown) => value,
                encodedType: 'uint8array'
              })
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it('requires a concrete protocol type for typed transports', async () => {
    const channel = {
      platform: 'Memory' as const,
      encodedType: 'string' as const,
      send() {},
      subscribe() {
        return () => undefined;
      }
    };
    await expect(
      createEndpoint({
        id: 'x',
        middlewares: [
          connect({ transport: channel }),
          {
            name: 'protocol',
            install: ({ capabilities }) =>
              capabilities.set('protocolCapability', {
                encode: (value: unknown) => value,
                decode: (value: unknown) => value,
                encodedType: 'any'
              })
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it('rejects chunking with Uint8Array protocol output before endpoint creation', async () => {
    const channel = {
      platform: 'WebTransport' as const,
      encodedType: 'uint8array' as const,
      send() {},
      subscribe() {
        return () => undefined;
      }
    };
    await expect(
      createEndpoint({
        id: 'chunked-uint8array',
        middlewares: [
          connect({ transport: channel }),
          {
            name: 'protocol',
            install: ({ capabilities }) =>
              capabilities.set('protocolCapability', {
                encode: (value: unknown) => new Uint8Array([Number(value) || 0]),
                decode: (value: unknown) => value,
                encodedType: 'uint8array'
              })
          },
          {
            name: 'chunk',
            install: ({ capabilities }) => capabilities.set('chunkCapability', { chunkSize: 4 })
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it('rejects capability publication conflicts', async () => {
    const publish = (name: string, value: unknown) => ({
      name,
      install: ({ capabilities }: { capabilities: { set(key: string, value: unknown): void } }) =>
        capabilities.set('protocolCapability', value)
    });
    await expect(
      createEndpoint({
        id: 'x',
        middlewares: [
          connect({ transport: transport() }),
          publish('one', { value: 1 }),
          publish('two', { value: 2 })
        ]
      })
    ).rejects.toMatchObject({ code: 'CAPABILITY_CONFLICT' });
  });
  it('closes an owned transport when endpoint registration fails', async () => {
    let closeCount = 0;
    const failing = {
      platform: 'Memory' as const,
      ownership: 'owned' as const,
      send() {},
      subscribe() {
        return () => undefined;
      },
      onListenerError() {
        throw new Error('listener registration failed');
      },
      close() {
        closeCount += 1;
      }
    };
    await expect(
      createEndpoint({
        id: 'x',
        middlewares: [connect({ transport: failing })]
      })
    ).rejects.toThrow('listener registration failed');
    expect(closeCount).toBe(1);
  });
  it('preserves construction failure and rollback errors together', async () => {
    const failing = {
      platform: 'Memory' as const,
      ownership: 'owned' as const,
      send() {},
      subscribe() {
        return () => {
          throw new Error('unsubscribe failed');
        };
      },
      onListenerError() {
        throw new Error('listener registration failed');
      },
      close() {
        throw new Error('close failed');
      }
    };
    await expect(
      createEndpoint({
        id: 'x',
        middlewares: [connect({ transport: failing })]
      })
    ).rejects.toMatchObject({
      name: 'WebRpcConstructionError',
      code: 'INVALID_CONFIG',
      cleanupErrors: expect.arrayContaining([
        expect.objectContaining({ resource: 'transport subscription' }),
        expect.objectContaining({ resource: 'transport close' })
      ])
    });
  });
});

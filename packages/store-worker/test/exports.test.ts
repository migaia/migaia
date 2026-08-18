import { describe, expect, it } from 'vitest';
import type { IWebRpcEndpoint } from '@migaia/web-rpc';
import { WorkerAdapter, createWorkerHandler, workerComputed, workerParser } from '../src/index';
import { toManagedRpcHandler } from '../src/managed-rpc-handler';
import { createSerializeWorkerHandler, mergeWorkerChunks } from '../src/serialize/worker';

function fakePort() {
  return {
    postMessage: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  };
}

/** Minimal endpoint double — `toManagedRpcHandler` only ever calls `.dispose()`. */
const mockEndpoint = (
  dispose: () => Promise<void>
): IWebRpcEndpoint<'worker', 'automatic', false> =>
  ({ dispose }) as unknown as IWebRpcEndpoint<'worker', 'automatic', false>;

describe('store-worker exports', () => {
  it('rejects an invalid serialize worker handler before endpoint creation', () => {
    expect(() => createSerializeWorkerHandler(null as never, (() => undefined) as never)).toThrow(
      '[store] serialize worker handler requires encode/decode parser functions'
    );
  });
  it('rejects null options at worker entry points with a tagged configuration error', () => {
    expect(() => new WorkerAdapter(fakePort(), null as never)).toThrow(
      '[store] worker options must be an object'
    );
    expect(() =>
      createWorkerHandler(
        () => 1,
        () => undefined,
        null as never
      )
    ).toThrow('[store] worker options must be an object');
    expect(() => workerComputed(null as never, () => 1, null as never)).toThrow(
      '[store] worker options must be an object'
    );
  });

  it('contains revoked worker options proxies as tagged errors', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    try {
      new WorkerAdapter(fakePort(), proxy as never);
      throw new Error('expected worker options to fail');
    } catch (error) {
      expect(error).toMatchObject({
        source: '@migaia/store-worker',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      });
    }
  });

  it('snapshots WorkerAdapter accessor options exactly once', () => {
    let reads = 0;
    const options = {} as { readonly clientId?: string };
    Object.defineProperty(options, 'clientId', {
      get: () => {
        reads++;
        if (reads > 1) throw new Error('clientId reread');
        return 'client';
      }
    });
    new WorkerAdapter(fakePort(), options);
    expect(reads).toBe(1);
  });

  it('contains revoked serialize worker options proxies as tagged errors', () => {
    const { proxy, revoke } = Proxy.revocable({ worker: fakePort() }, {});
    revoke();
    expect(() => workerParser(proxy as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-worker',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    );
  });

  it('snapshots serialize worker accessor options exactly once', () => {
    let reads = 0;
    const options = { worker: fakePort() } as {
      worker: ReturnType<typeof fakePort>;
      ownership?: string;
    };
    Object.defineProperty(options, 'ownership', {
      get: () => {
        reads++;
        if (reads > 1) throw new Error('ownership reread');
        return 'copy';
      }
    });
    const parser = workerParser(options as never);
    expect(reads).toBe(1);
    void parser.dispose?.();
  });
  it('creates a managed worker handler without disposeAsync', () => {
    const handler = createWorkerHandler<number, number>(
      (value) => value + 1,
      () => {}
    );
    expect(handler.disposed).toBe(false);
    expect((handler as unknown as { disposeAsync?: unknown }).disposeAsync).toBeUndefined();
    handler.close();
    expect(handler.disposed).toBe(true);
  });

  it('rejects invalid worker handler callbacks before endpoint construction', () => {
    expect(() => createWorkerHandler(null as never, () => undefined)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-worker',
        code: 'INVALID_OPTION',
        message: '[store] createWorkerHandler compute must be a function'
      })
    );
    expect(() => createWorkerHandler(() => 1, null as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-worker',
        code: 'INVALID_OPTION',
        message: '[store] createWorkerHandler postMessage must be a function'
      })
    );
  });

  it('close() marks disposed and blocks new messages without disposing the endpoint', async () => {
    let disposeCalls = 0;
    const delivered: unknown[] = [];
    const handler = toManagedRpcHandler<'worker'>(
      Promise.resolve(
        mockEndpoint(async () => {
          disposeCalls += 1;
        })
      ),
      (message) => delivered.push(message)
    );
    handler.close();
    await handler({ kind: 'ignored' });
    expect(handler.disposed).toBe(true);
    expect(delivered).toEqual([]);
    expect(disposeCalls).toBe(0);
  });

  it('dispose() closes first, awaits endpoint.dispose(), and reuses the same Promise', async () => {
    let disposeCalls = 0;
    const handler = toManagedRpcHandler<'worker'>(
      Promise.resolve(
        mockEndpoint(async () => {
          disposeCalls += 1;
        })
      ),
      () => undefined
    );
    const first = handler.dispose();
    expect(handler.disposed).toBe(true);
    const second = handler.dispose();
    expect(second).toBe(first);
    await first;
    expect(disposeCalls).toBe(1);
  });

  it('dispose() propagates endpoint cleanup errors instead of swallowing them', async () => {
    const cleanupError = new Error('endpoint dispose failed');
    const handler = toManagedRpcHandler<'worker'>(
      Promise.resolve(
        mockEndpoint(async () => {
          throw cleanupError;
        })
      ),
      () => undefined
    );
    await expect(handler.dispose()).rejects.toBe(cleanupError);
    await expect(handler.dispose()).rejects.toBe(cleanupError);
  });

  it('close rejects late messages while an already-admitted dispatch drains', async () => {
    let resolveEndpoint!: (endpoint: IWebRpcEndpoint<'worker', 'automatic', false>) => void;
    const endpoint = new Promise<IWebRpcEndpoint<'worker', 'automatic', false>>((resolve) => {
      resolveEndpoint = resolve;
    });
    const delivered: unknown[] = [];
    const handler = toManagedRpcHandler<'worker'>(endpoint, (message) => delivered.push(message));
    const admitted = handler('admitted');
    expect(handler.pendingCount).toBe(1);

    handler.close();
    await handler('late');
    expect(handler.pendingCount).toBe(1);
    resolveEndpoint(mockEndpoint(async () => undefined));
    await admitted;

    expect(delivered).toEqual(['admitted']);
    expect(handler.pendingCount).toBe(0);
  });

  it('dispose races an admitted dispatch without duplicate cleanup or leaked pending count', async () => {
    let resolveEndpoint!: (endpoint: IWebRpcEndpoint<'worker', 'automatic', false>) => void;
    const endpoint = new Promise<IWebRpcEndpoint<'worker', 'automatic', false>>((resolve) => {
      resolveEndpoint = resolve;
    });
    let disposeCalls = 0;
    const delivered: unknown[] = [];
    const handler = toManagedRpcHandler<'worker'>(endpoint, (message) => delivered.push(message));
    const admitted = handler('admitted');
    const firstDispose = handler.dispose();
    expect(handler.dispose()).toBe(firstDispose);
    resolveEndpoint(
      mockEndpoint(async () => {
        disposeCalls++;
      })
    );

    await Promise.all([admitted, firstDispose]);
    expect(delivered).toEqual(['admitted']);
    expect(disposeCalls).toBe(1);
    expect(handler.pendingCount).toBe(0);
  });

  it('rejects request immediately after adapter disposal', async () => {
    const adapter = new WorkerAdapter(fakePort());
    adapter.dispose();
    await expect(adapter.request({}, {})).rejects.toThrow('worker adapter is disposed');
  });

  it('snapshots request accessors before returning the admitted Promise', () => {
    const adapter = new WorkerAdapter(fakePort());
    let signalReads = 0;
    let transferReads = 0;
    const options = {} as { signal?: AbortSignal; transfer?: readonly Transferable[] };
    Object.defineProperties(options, {
      signal: {
        get: () => {
          signalReads++;
          return undefined;
        }
      },
      transfer: {
        get: () => {
          transferReads++;
          return [];
        }
      }
    });

    void adapter.request({}, options);

    expect(signalReads).toBe(1);
    expect(transferReads).toBe(1);
    adapter.close();
  });

  it('rejects hostile request options with a tagged error and original cause', async () => {
    const adapter = new WorkerAdapter(fakePort());
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    await expect(adapter.request({}, proxy as never)).rejects.toMatchObject({
      source: '@migaia/store-worker',
      code: 'INVALID_OPTION',
      cause: expect.any(Error)
    });
    await expect(adapter.request({}, null as never)).rejects.toMatchObject({
      source: '@migaia/store-worker',
      code: 'INVALID_OPTION'
    });
    adapter.close();
  });

  it('rejects invalid workerComputed callbacks before Resource construction', () => {
    const adapter = new WorkerAdapter(fakePort());
    expect(() => workerComputed(adapter, null as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-worker',
        code: 'INVALID_OPTION',
        message: '[store] workerComputed selectInput must be a function'
      })
    );
    expect(() => workerComputed(adapter, () => 1, { transfer: 1 as never })).toThrow(
      expect.objectContaining({
        source: '@migaia/store-worker',
        code: 'INVALID_OPTION',
        message: '[store] workerComputed transfer must be a function'
      })
    );
    adapter.close();
  });

  it('snapshots workerComputed options once without enumerating unknown properties', () => {
    const adapter = new WorkerAdapter(fakePort());
    let runtimeReads = 0;
    let transferReads = 0;
    let unknownReads = 0;
    const options = {} as Record<string, unknown>;
    Object.defineProperties(options, {
      runtime: {
        enumerable: true,
        get: () => {
          runtimeReads++;
          return undefined;
        }
      },
      transfer: {
        enumerable: true,
        get: () => {
          transferReads++;
          return undefined;
        }
      },
      unknown: {
        enumerable: true,
        get: () => {
          unknownReads++;
          throw new Error('unknown option must not be read');
        }
      },
      autoStart: {
        enumerable: true,
        value: false
      }
    });

    const resource = workerComputed(adapter, () => 1, options as never);

    expect(runtimeReads).toBe(1);
    expect(transferReads).toBe(1);
    expect(unknownReads).toBe(0);
    resource.dispose();
    adapter.close();
  });

  it('contains a throwing workerComputed option getter with its original cause', () => {
    const adapter = new WorkerAdapter(fakePort());
    const failure = new Error('workerComputed transfer getter failed');
    const options = {} as { transfer?: never };
    Object.defineProperty(options, 'transfer', {
      get: () => {
        throw failure;
      }
    });

    expect(() => workerComputed(adapter, () => 1, options)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-worker',
        code: 'INVALID_OPTION',
        message: '[store] worker options must be an object',
        cause: failure
      })
    );
    adapter.close();
  });

  it('rejects materialized value chunks instead of stringifying them', () => {
    expect(() =>
      mergeWorkerChunks([
        ['text', 'a'],
        ['value', { object: true }]
      ])
    ).toThrow('cannot merge value chunks into bytes');
  });
});

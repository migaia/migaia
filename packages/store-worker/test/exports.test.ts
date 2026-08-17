import { describe, expect, it } from 'vitest';
import type { IWebRpcEndpoint } from '@migaia/web-rpc';
import { WorkerAdapter, createWorkerHandler } from '../src/index';
import { toManagedRpcHandler } from '../src/managed-rpc-handler';
import { mergeWorkerChunks } from '../src/serialize/worker';

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

  it('rejects request immediately after adapter disposal', async () => {
    const adapter = new WorkerAdapter(fakePort());
    adapter.dispose();
    await expect(adapter.request({}, {})).rejects.toThrow('worker adapter is disposed');
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

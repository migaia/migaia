import { describe, expect, it } from 'vitest';
import { StoreWorkerErrorCode } from '../src/error-code.js';
import { workerParser } from '../src/serialize/worker.js';
import { transferablesOf } from '../src/serialize/transferables.js';
import { WorkerByteOwnership } from '../src/worker-constants.js';

describe('workerParser lifecycle', () => {
  it('rejects null options with a tagged configuration error', () => {
    expect(() => workerParser(null as never)).toThrow('[store] worker options must be an object');
  });

  it('rejects hostile option values instead of silently changing transfer/lifecycle semantics', () => {
    const worker = {} as never;
    expect(() => workerParser({ worker: null as never })).toThrow(
      '[store] worker options.worker must be an object'
    );
    expect(() => workerParser({ worker, ownership: 'move' as never })).toThrow(
      '[store] worker options.ownership must be copy or transfer'
    );
    expect(() => workerParser({ worker, terminateOnDispose: 'yes' as never })).toThrow(
      '[store] worker options.terminateOnDispose must be boolean'
    );
  });

  it('rejects non-string type and clientId before endpoint creation', () => {
    const worker = {} as never;
    expect(() => workerParser({ worker, type: Symbol('type') as never })).toThrow(
      expect.objectContaining({ source: '@migaia/store-worker', code: 'INVALID_OPTION' })
    );
    expect(() => workerParser({ worker, clientId: Symbol('client') as never })).toThrow(
      expect.objectContaining({ source: '@migaia/store-worker', code: 'INVALID_OPTION' })
    );
  });

  it('does not transfer SharedArrayBuffer-backed bytes', () => {
    const shared = new SharedArrayBuffer(4);
    const bytes = new Uint8Array(shared);
    expect(transferablesOf(['bytes', bytes], WorkerByteOwnership.transfer)).toEqual([]);
  });

  it('shares one dispose promise and terminates an owned worker exactly once', async () => {
    let terminateCalls = 0;
    const listeners = new Map<string, Set<(event: MessageEvent<unknown> | Event) => void>>();
    const worker = {
      postMessage(): void {},
      addEventListener(
        type: 'message' | 'error' | 'messageerror',
        listener: (event: MessageEvent<unknown> | Event) => void
      ): void {
        const bucket = listeners.get(type) ?? new Set();
        bucket.add(listener);
        listeners.set(type, bucket);
      },
      removeEventListener(
        type: 'message' | 'error' | 'messageerror',
        listener: (event: MessageEvent<unknown> | Event) => void
      ): void {
        listeners.get(type)?.delete(listener);
      },
      terminate(): void {
        terminateCalls++;
      }
    };
    const parser = workerParser({ worker, terminateOnDispose: true });
    const dispose = parser.dispose!;

    const first = dispose() as Promise<void>;
    const second = dispose() as Promise<void>;
    expect(second).toBe(first);
    await Promise.all([first, second]);
    await dispose();
    expect(terminateCalls).toBe(1);
  });

  it('collects endpoint and terminate cleanup failures under cleanupFailed', async () => {
    const endpointCleanupError = new Error('endpoint cleanup failed');
    const terminateError = new Error('worker terminate failed');
    const worker = {
      postMessage(): void {},
      addEventListener(): void {},
      removeEventListener(): void {
        throw endpointCleanupError;
      },
      terminate(): void {
        throw terminateError;
      }
    };
    const parser = workerParser({ worker, terminateOnDispose: true });
    const dispose = parser.dispose!;

    const first = dispose() as Promise<void>;
    const second = dispose() as Promise<void>;
    expect(second).toBe(first);

    const error = await first.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toMatchObject({ code: StoreWorkerErrorCode.cleanupFailed });
    const cleanupErrors = (error as AggregateError).errors;
    expect(cleanupErrors).toHaveLength(2);
    expect(cleanupErrors[1]).toBe(terminateError);
    expect(cleanupErrors[0]).toMatchObject({
      cleanupErrors: expect.arrayContaining([
        expect.objectContaining({ resource: 'transport subscription' })
      ])
    });
    expect(dispose()).toBe(first);
  });

  it('terminates an owned worker when endpoint disposal fails', async () => {
    let terminateCalls = 0;
    const worker = {
      postMessage(): void {},
      addEventListener(): void {},
      removeEventListener(): void {
        throw new Error('endpoint disposal failed');
      },
      terminate(): void {
        terminateCalls++;
      }
    };
    const parser = workerParser({ worker, terminateOnDispose: true });

    await expect(parser.dispose?.()).rejects.toThrow(
      'Endpoint disposal completed with cleanup errors'
    );
    expect(terminateCalls).toBe(1);
  });

  it('retains an AbortError cause when request cancellation crosses the parser boundary', async () => {
    const worker = {
      postMessage(): void {},
      addEventListener(): void {},
      removeEventListener(): void {}
    };
    const parser = workerParser({ worker });
    const controller = new AbortController();
    const reason = new DOMException('cancelled by test', 'AbortError');
    controller.abort(reason);

    const thrown = await Promise.resolve(
      parser.encode(new Uint8Array([1]), {
        signal: controller.signal,
        context: 'worker-abort-test'
      })
    ).catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      name: 'SerializeCodecError',
      source: '@migaia/store-worker',
      code: StoreWorkerErrorCode.requestAborted,
      cause: expect.objectContaining({ name: 'AbortError' })
    });
    expect((thrown as { cause?: unknown }).cause).toBe(reason);
    await parser.dispose?.();
  });
});

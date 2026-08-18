import { describe, expect, it } from 'vitest';
import {
  StoreWorkerErrorCode,
  STORE_WORKER_SOURCE,
  createStoreWorkerAggregateError,
  createStoreWorkerError
} from '../src/errors';

describe('store-worker error-code contract (E-T9)', () => {
  it('declares 7 unique codes under the package source', () => {
    const codes = Object.values(StoreWorkerErrorCode);
    expect(codes).toHaveLength(7);
    expect(new Set(codes).size).toBe(7);
    expect(STORE_WORKER_SOURCE).toBe('@migaia/store-worker');
  });

  it('shared attachment preserves native Error/AggregateError identity, cause, and stack', () => {
    const cause = new Error('cause');
    const error = createStoreWorkerError(StoreWorkerErrorCode.invalidOption, 'message', { cause });
    const aggregate = createStoreWorkerAggregateError(
      StoreWorkerErrorCode.cleanupFailed,
      [cause],
      'cleanup'
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.cause).toBe(cause);
    expect(error.stack).toBeTruthy();
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect(aggregate.errors).toEqual([cause]);
    expect(aggregate.stack).toBeTruthy();
    expect((error as Error & { readonly source: string }).source).toBe(STORE_WORKER_SOURCE);
    expect((aggregate as AggregateError & { readonly source: string }).source).toBe(
      STORE_WORKER_SOURCE
    );
  });
});

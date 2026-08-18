import { describe, expect, it } from 'vitest';
import { StoreWorkerErrorCode, STORE_WORKER_SOURCE } from '../src/errors';

describe('store-worker error-code contract (E-T9)', () => {
  it('declares 7 unique codes under the package source', () => {
    const codes = Object.values(StoreWorkerErrorCode);
    expect(codes).toHaveLength(7);
    expect(new Set(codes).size).toBe(7);
    expect(STORE_WORKER_SOURCE).toBe('@migaia/store-worker');
  });
});

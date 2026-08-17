import { describe, expect, it } from 'vitest';
import { StoreIndexedErrorCode, STORE_INDEXED_SOURCE } from '../src/errors';

describe('store-indexed error-code contract (E-T9)', () => {
  it('declares 4 unique codes under the package source', () => {
    const codes = Object.values(StoreIndexedErrorCode);
    expect(codes).toHaveLength(4);
    expect(new Set(codes).size).toBe(4);
    expect(STORE_INDEXED_SOURCE).toBe('@migaia/store-indexed');
  });
});

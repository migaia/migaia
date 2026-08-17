import { describe, expect, it } from 'vitest';
import { StoreSharedErrorCode, STORE_SHARED_SOURCE } from '../src/errors';

describe('store-shared error-code contract (E-T9)', () => {
  it('declares 7 unique codes under the package source', () => {
    const codes = Object.values(StoreSharedErrorCode);
    expect(codes).toHaveLength(7);
    expect(new Set(codes).size).toBe(7);
    expect(STORE_SHARED_SOURCE).toBe('@migaia/store-shared');
  });
});

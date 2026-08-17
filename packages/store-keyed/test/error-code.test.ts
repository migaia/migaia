import { describe, expect, it } from 'vitest';
import { StoreKeyedErrorCode, STORE_KEYED_SOURCE } from '../src/errors';

describe('store-keyed error-code contract (E-T9)', () => {
  it('declares 11 unique codes under the package source', () => {
    const codes = Object.values(StoreKeyedErrorCode);
    expect(codes).toHaveLength(11);
    expect(new Set(codes).size).toBe(11);
    expect(STORE_KEYED_SOURCE).toBe('@migaia/store-keyed');
  });
});

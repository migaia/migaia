import { describe, expect, it } from 'vitest';
import { StoreReactErrorCode, STORE_REACT_SOURCE } from '../src/errors';

describe('store-react error-code contract (E-T9)', () => {
  it('declares 8 unique codes under the package source', () => {
    const codes = Object.values(StoreReactErrorCode);
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(STORE_REACT_SOURCE).toBe('@migaia/store-react');
  });
});

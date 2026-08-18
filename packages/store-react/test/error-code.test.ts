import { describe, expect, it } from 'vitest';
import { StoreReactErrorCode, STORE_REACT_SOURCE } from '../src/errors';

describe('store-react error-code contract (E-T9)', () => {
  it('declares 9 unique codes under the package source', () => {
    const codes = Object.values(StoreReactErrorCode);
    expect(codes).toHaveLength(9);
    expect(new Set(codes).size).toBe(9);
    expect(STORE_REACT_SOURCE).toBe('@migaia/store-react');
  });
});

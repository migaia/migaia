import { describe, expect, it } from 'vitest';
import { StoreDevtoolsErrorCode, STORE_DEVTOOLS_SOURCE } from '../src/errors';

describe('store-devtools error-code contract (E-T9)', () => {
  it('declares 2 unique codes under the package source', () => {
    const codes = Object.values(StoreDevtoolsErrorCode);
    expect(codes).toHaveLength(2);
    expect(new Set(codes).size).toBe(2);
    expect(STORE_DEVTOOLS_SOURCE).toBe('@migaia/store-devtools');
  });
});

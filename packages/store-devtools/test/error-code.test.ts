import { describe, expect, it } from 'vitest';
import { StoreDevtoolsErrorCode, STORE_DEVTOOLS_SOURCE } from '../src/errors';

describe('store-devtools error-code contract (E-T9)', () => {
  it('declares 4 unique codes under the package source', () => {
    const codes = Object.values(StoreDevtoolsErrorCode);
    expect(codes).toHaveLength(4);
    expect(new Set(codes).size).toBe(4);
    expect(STORE_DEVTOOLS_SOURCE).toBe('@migaia/store-devtools');
  });
});

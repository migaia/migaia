import { describe, expect, it } from 'vitest';
import { StoreSsrErrorCode, STORE_SSR_SOURCE } from '../src/errors';

describe('store-ssr error-code contract (E-T9)', () => {
  it('declares 11 unique codes under the package source', () => {
    const codes = Object.values(StoreSsrErrorCode);
    expect(codes).toHaveLength(11);
    expect(new Set(codes).size).toBe(11);
    expect(STORE_SSR_SOURCE).toBe('@migaia/store-ssr');
  });
});

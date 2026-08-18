import { describe, expect, it } from 'vitest';
import { StoreSsrErrorCode, STORE_SSR_SOURCE } from '../src/errors';

describe('store-ssr error-code contract (E-T9)', () => {
  it('declares 12 unique codes under the package source', () => {
    const codes = Object.values(StoreSsrErrorCode);
    expect(codes).toHaveLength(12);
    expect(new Set(codes).size).toBe(12);
    expect(STORE_SSR_SOURCE).toBe('@migaia/store-ssr');
  });
});

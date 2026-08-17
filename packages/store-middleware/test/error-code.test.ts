import { describe, expect, it } from 'vitest';
import { StoreMiddlewareErrorCode, STORE_MIDDLEWARE_SOURCE } from '../src/errors';

describe('store-middleware error-code contract (E-T9)', () => {
  it('declares 5 unique codes under the package source', () => {
    const codes = Object.values(StoreMiddlewareErrorCode);
    expect(codes).toHaveLength(5);
    expect(new Set(codes).size).toBe(5);
    expect(STORE_MIDDLEWARE_SOURCE).toBe('@migaia/store-middleware');
  });
});

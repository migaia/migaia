import { describe, expect, it } from 'vitest';
import {
  createStoreReactAggregateError,
  StoreReactErrorCode,
  STORE_REACT_SOURCE
} from '../src/errors';

describe('store-react error-code contract (E-T9)', () => {
  it('declares 9 unique codes under the package source', () => {
    const codes = Object.values(StoreReactErrorCode);
    expect(codes).toHaveLength(9);
    expect(new Set(codes).size).toBe(9);
    expect(STORE_REACT_SOURCE).toBe('@migaia/store-react');
  });

  it('preserves AggregateError errors and shared identity metadata', () => {
    const primary = new Error('primary');
    const cleanup = new Error('cleanup');
    const error = createStoreReactAggregateError(
      StoreReactErrorCode.registryDisposalFailed,
      [primary, cleanup],
      'disposal failed'
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([primary, cleanup]);
    expect(error).toMatchObject({ source: STORE_REACT_SOURCE, code: 'REGISTRY_DISPOSAL_FAILED' });
    expect(error.stack).toContain('disposal failed');
  });
});

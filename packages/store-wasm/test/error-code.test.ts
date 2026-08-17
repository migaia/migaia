import { describe, expect, it } from 'vitest';
import { StoreWasmErrorCode, STORE_WASM_SOURCE } from '../src/errors';

describe('store-wasm error-code contract (E-T9)', () => {
  it('declares 6 unique codes under the package source', () => {
    const codes = Object.values(StoreWasmErrorCode);
    expect(codes).toHaveLength(6);
    expect(new Set(codes).size).toBe(6);
    expect(STORE_WASM_SOURCE).toBe('@migaia/store-wasm');
  });
});

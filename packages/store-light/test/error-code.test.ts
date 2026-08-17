import { describe, expect, it } from 'vitest';
import { createRuntime } from '@migaia/reactive';
import type { IDisposable } from '@migaia/reactive';
import { createLegacyStore, storeReady, FIELD_BUILDER, type IFieldBuilder } from '../src';
import { StoreLightErrorCode, STORE_LIGHT_SOURCE } from '../src/errors';

describe('store-light error-code contract (E-T9)', () => {
  it('declares 12 unique codes under the package source', () => {
    const codes = Object.values(StoreLightErrorCode);
    expect(codes).toHaveLength(12);
    expect(new Set(codes).size).toBe(12);
    expect(STORE_LIGHT_SOURCE).toBe('@migaia/store-light');
  });
});

describe('store-light double-failure cause reachability (E-T13)', () => {
  it('INIT_AND_CLEANUP_FAILED keeps both the init cause and the cleanup error reachable', async () => {
    const runtime = createRuntime();
    // Resolves first (one microtask) so its field is adopted before the failing sibling rejects;
    // its dispose() then throws, so scope.dispose() during init-failure cleanup also fails.
    const dirty: IFieldBuilder<IDisposable & { value: number }> = {
      [FIELD_BUILDER]: true,
      mode: 'async',
      async create() {
        return {
          value: 1,
          disposed: false,
          dispose: () => {
            throw new Error('cleanup failed');
          }
        };
      }
    };
    // Rejects after two microtasks with a cause, so the error already carries `cause` when
    // cleanup fails — the exact path that produces the AggregateError.
    const failing: IFieldBuilder<IDisposable & { value: number }> = {
      [FIELD_BUILDER]: true,
      mode: 'async',
      async create() {
        await Promise.resolve();
        throw new Error('init failed', { cause: 'root-cause' });
      }
    };
    const store = createLegacyStore({ dirty, failing }, { runtime });
    const error = await storeReady(store).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(AggregateError);
    const aggregate = cause as AggregateError & { readonly source: string; readonly code: string };
    expect(aggregate.source).toBe(STORE_LIGHT_SOURCE);
    expect(aggregate.code).toBe(StoreLightErrorCode.initAndCleanupFailed);
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors[0]).toBe('root-cause');
    expect(aggregate.errors[1]).toBeInstanceOf(Error);
    expect((aggregate.errors[1] as Error).message).toBe('cleanup failed');
  });
});

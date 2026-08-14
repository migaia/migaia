import { describe, expect, it } from 'vitest';
import { createSSRRequestScope, deserializeSSRState, serializeSSRState } from '../src';

describe('store-ssr', () => {
  it('serializes request-scoped JSON-safe state', () => {
    const scope = createSSRRequestScope();
    const state = {
      version: 1 as const,
      stores: { app: { count: 2 } }
    };
    expect(deserializeSSRState(serializeSSRState(state))).toEqual(state);
    scope.dispose();
  });
});

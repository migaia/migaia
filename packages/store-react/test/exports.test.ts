import { describe, expect, it } from 'vitest';
import { createRuntime } from '@migaia/reactive';
import { createStoreRegistry, createStoreToken } from '../src/index';

describe('store-react exports', () => {
  it('creates a runtime-bound provider registry', () => {
    const runtime = createRuntime();
    const registry = createStoreRegistry(runtime);
    const token = createStoreToken<number>('count');
    registry.register(token, 1);

    expect(registry.require(token)).toBe(1);
    registry.dispose();
  });
});

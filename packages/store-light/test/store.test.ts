import { describe, expect, it } from 'vitest';
import { createStore } from '../src';

describe('store-light', () => {
  it('creates an object facade without collection or keyed dependencies', () => {
    const store = createStore({ count: 1 });
    expect(store.count).toBe(1);
    store.count = 2;
    expect(store.count).toBe(2);
    store.$dispose();
  });
});

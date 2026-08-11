import { describe, expect, it } from 'vitest';
import { PendingRegistry } from '../../src/internal/pending';

describe('PendingRegistry', () => {
  it('does not commit after the admission predicate closes', () => {
    const registry = new PendingRegistry<number>();
    expect(registry.commit('late', 1, () => false)).toBe(false);
    expect(registry.has('late')).toBe(false);
    expect(registry.commit('live', 2, () => true)).toBe(true);
    expect(registry.get('live')).toBe(2);
  });
});

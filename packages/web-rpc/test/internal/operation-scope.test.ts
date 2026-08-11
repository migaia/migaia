import { describe, expect, it } from 'vitest';
import { OperationScope } from '../../src/internal/operation-scope';

describe('OperationScope', () => {
  it('cancels from the shared closing signal and rejects stale generations', () => {
    const closing = new AbortController();
    const scope = new OperationScope(3, false, closing.signal);
    expect(() => scope.assertActive(3)).not.toThrow();
    closing.abort();
    expect(() => scope.assertActive(3)).toThrow('Endpoint disposed');
    expect(() => scope.assertActive(4)).toThrow('Endpoint disposed');
  });
});

import { describe, expect, it } from 'vitest';
import { isStorageKeyInRange } from '../../src/core/query';

describe('shared query range owner', () => {
  it('uses the shared key comparator for inclusive and exclusive bounds', () => {
    expect(isStorageKeyInRange(2, { lower: 2, upper: 10 })).toBe(true);
    expect(isStorageKeyInRange(2, { lower: 2, lowerOpen: true, upper: 10 })).toBe(false);
    expect(isStorageKeyInRange(10, { lower: 2, upper: 10, upperOpen: true })).toBe(false);
    expect(isStorageKeyInRange(['users', 'u1'], { lower: ['users'] })).toBe(true);
  });
});

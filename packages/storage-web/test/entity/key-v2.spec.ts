import { describe, expect, it } from 'vitest';
import {
  composeRepositoryKey,
  decodeRepositoryKey,
  repositoryEntityRange
} from '../../src/entity/key';

describe('repository v2 physical key space', () => {
  it('round trips scalar and nested ids without colliding with raw keys', () => {
    const scalar = composeRepositoryKey('users', 'u1');
    const nested = composeRepositoryKey('users', ['u1', 1]);
    expect(scalar).not.toEqual(['users', 'u1']);
    expect(nested).not.toEqual(scalar);
    expect(decodeRepositoryKey('users', scalar)).toBe('u1');
    expect(decodeRepositoryKey('users', nested)).toEqual(['u1', 1]);
  });

  it('rejects unrelated, malformed, or differently named physical keys', () => {
    expect(decodeRepositoryKey('users', ['users', 'u1'])).toBeUndefined();
    expect(
      decodeRepositoryKey('users', ['__storage_web_entity_v2__', 'posts', 'sw1:x'])
    ).toBeUndefined();
    expect(decodeRepositoryKey('users', ['__storage_web_entity_v2__', 'users', 1])).toBeUndefined();
  });

  it('builds a stable entity-only range; ID bounds are filtered by the shared comparator', () => {
    expect(repositoryEntityRange('users')).toEqual({
      lower: ['__storage_web_entity_v2__', 'users', ''],
      lowerOpen: false,
      upper: ['__storage_web_entity_v2__', 'users', '\uffff'],
      upperOpen: false
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  createSafeRecord,
  isSafeIntegerValue,
  safeRead,
  safeString,
  tupleKey
} from '../../src/internal/safe-value';

describe('safe-value utilities', () => {
  it('contains hostile property getters', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('getter');
        }
      }
    );
    expect(safeRead(hostile, 'value')).toBeUndefined();
  });

  it('accepts only safe integer values', () => {
    expect(isSafeIntegerValue(0)).toBe(true);
    expect(isSafeIntegerValue(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isSafeIntegerValue(Number.NaN)).toBe(false);
    expect(isSafeIntegerValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isSafeIntegerValue(1.5)).toBe(false);
  });

  it('contains hostile string conversion and preserves tuple boundaries', () => {
    const hostile = {
      toString: () => {
        throw new Error('stringify');
      }
    };
    expect(safeString(hostile, 'fallback')).toBe('fallback');
    expect(tupleKey('a|b', 'c')).not.toBe(tupleKey('a', 'b|c'));
  });

  it('returns a null-prototype dictionary for attacker-controlled keys', () => {
    const record = createSafeRecord<number>();
    record['__proto__'] = 1;
    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(Object.hasOwn(record, '__proto__')).toBe(true);
  });
});

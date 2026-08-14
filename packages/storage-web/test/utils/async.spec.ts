import { describe, expect, it } from 'vitest';
import { toPromise } from '../../src/utils/async';

describe('toPromise', () => {
  it('返回值被包装成 resolved promise', async () => {
    await expect(toPromise(() => 42)).resolves.toBe(42);
  });
  it('同步抛出被转换成 rejected promise，而不是同步抛出', async () => {
    let synchronousThrow = false;
    let result: Promise<unknown>;
    try {
      result = toPromise(() => {
        throw new Error('sync boom');
      });
    } catch {
      synchronousThrow = true;
      result = Promise.resolve();
    }
    expect(synchronousThrow).toBe(false);
    await expect(result).rejects.toThrow('sync boom');
  });
});

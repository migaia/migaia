import { describe, expect, it } from 'vitest';
import { compareStorageKeys } from '../../src/core/key-domain';

const sign = (n: number): number => Math.sign(n);

describe('compareStorageKeys', () => {
  it('类型排序：Number < Date < String < Binary < Array', () => {
    expect(sign(compareStorageKeys(1, new Date()))).toBe(-1);
    expect(sign(compareStorageKeys(new Date(), 'a'))).toBe(-1);
    expect(sign(compareStorageKeys('a', new ArrayBuffer(1)))).toBe(-1);
    expect(sign(compareStorageKeys(new ArrayBuffer(1), []))).toBe(-1);
    expect(sign(compareStorageKeys([], 1))).toBe(1);
  });
  it('同类型数字按数值比较', () => {
    expect(sign(compareStorageKeys(1, 2))).toBe(-1);
    expect(sign(compareStorageKeys(2, 1))).toBe(1);
    expect(compareStorageKeys(1, 1)).toBe(0);
  });
  it('同类型 Date 按时间戳比较', () => {
    const early = new Date('2020-01-01');
    const late = new Date('2021-01-01');
    expect(sign(compareStorageKeys(early, late))).toBe(-1);
    expect(sign(compareStorageKeys(late, early))).toBe(1);
    expect(compareStorageKeys(early, new Date('2020-01-01'))).toBe(0);
  });
  it('同类型字符串按字典序比较', () => {
    expect(sign(compareStorageKeys('a', 'b'))).toBe(-1);
    expect(sign(compareStorageKeys('b', 'a'))).toBe(1);
    expect(compareStorageKeys('a', 'a')).toBe(0);
  });
  it('同类型 ArrayBuffer 按字节序比较', () => {
    const a = new Uint8Array([1, 2, 3]).buffer;
    const b = new Uint8Array([1, 2, 4]).buffer;
    expect(sign(compareStorageKeys(a, b))).toBe(-1);
    expect(sign(compareStorageKeys(b, a))).toBe(1);
    expect(compareStorageKeys(a, new Uint8Array([1, 2, 3]).buffer)).toBe(0);
  });
  it('ArrayBuffer 前缀较短者更小', () => {
    expect(
      sign(compareStorageKeys(new Uint8Array([1, 2]).buffer, new Uint8Array([1, 2, 3]).buffer))
    ).toBe(-1);
  });
  it('数组前缀较短者更小', () => {
    expect(sign(compareStorageKeys(['users'], ['users', 'u1']))).toBe(-1);
    expect(sign(compareStorageKeys(['users', 'u1'], ['users']))).toBe(1);
  });
  it('数组逐元素比较，首个不相等的元素决定结果', () => {
    expect(sign(compareStorageKeys(['a', 1], ['a', 2]))).toBe(-1);
    expect(sign(compareStorageKeys(['b', 1], ['a', 999]))).toBe(1);
  });
  it('数组内混合类型元素按元素类型排序比较', () => {
    expect(sign(compareStorageKeys(['users', 'u1'], ['users', []]))).toBe(-1);
  });
  it('完全相等的数组返回 0', () => {
    expect(compareStorageKeys(['a', 1], ['a', 1])).toBe(0);
  });
});

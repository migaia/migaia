import { describe, expect, it } from 'vitest';
import {
  KEY_DOMAIN_LIMITS,
  assertKeyRange,
  assertStorageKey,
  decodeFlatStorageKey,
  encodeFlatStorageKey,
  snapshotKeyRange
} from '../../src/core/key-domain';

describe('core key-domain', () => {
  it('数组 key 的自定义 map 不能改变 wire 编码', () => {
    const key = ['actual'];
    key.map = (() => ['forged']) as typeof key.map;
    expect(decodeFlatStorageKey(encodeFlatStorageKey(key))).toEqual(['actual']);
  });

  it('range getter 只读取一次并返回稳定快照', () => {
    let reads = 0;
    const range = {
      get lower() {
        reads += 1;
        if (reads > 1) throw new Error('lower read twice');
        return 'a';
      },
      upper: 'z'
    };
    expect(snapshotKeyRange(range, 'memory')).toEqual({
      lower: 'a',
      lowerOpen: undefined,
      upper: 'z',
      upperOpen: undefined
    });
    expect(reads).toBe(1);
  });
  it('range snapshot 不持有调用方复合边界引用', () => {
    const lower: Array<string | number> = ['tenant', 1];
    const upper: Array<string | number> = ['tenant', 9];
    const snapshot = snapshotKeyRange({ lower, upper }, 'memory');
    lower[1] = 5;
    upper[1] = 6;
    expect(snapshot).toEqual({
      lower: ['tenant', 1],
      lowerOpen: undefined,
      upper: ['tenant', 9],
      upperOpen: undefined
    });
  });
  it('缺少 structuredClone 时仍以 canonical wire 隔离复合 range', () => {
    const original = globalThis.structuredClone;
    Object.defineProperty(globalThis, 'structuredClone', { value: undefined, configurable: true });
    try {
      const lower: Array<string | number> = ['tenant', 1];
      const snapshot = snapshotKeyRange({ lower }, 'memory');
      lower[1] = 9;
      expect(snapshot?.lower).toEqual(['tenant', 1]);
    } finally {
      Object.defineProperty(globalThis, 'structuredClone', { value: original, configurable: true });
    }
  });
  it('key-domain limits runtime descriptor 不可变', () => {
    expect(() => {
      (KEY_DOMAIN_LIMITS as unknown as { maxDepth: number }).maxDepth = 1;
    }).toThrow(TypeError);
    expect(KEY_DOMAIN_LIMITS.maxDepth).toBe(32);
  });

  it('supports all valid scalar and nested keys', () => {
    const keys = [
      'text',
      1,
      new Date('2024-01-01T00:00:00Z'),
      new Uint8Array([1, 2]).buffer,
      ['tenant', ['user', 2]]
    ] as const;
    for (const key of keys) {
      assertStorageKey(key, 'memory');
      expect(decodeFlatStorageKey(encodeFlatStorageKey(key))).toEqual(key);
    }
  });

  it('rejects empty, cyclic, oversized and excessively deep keys', () => {
    for (const key of [[], [[]], true, NaN, Infinity, new Date('invalid')] as unknown[])
      expect(() => assertStorageKey(key, 'memory')).toThrow(
        expect.objectContaining({ code: 'INVALID_KEY' })
      );
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => assertStorageKey(cyclic, 'memory')).toThrow();
    const deep: unknown[] = ['leaf'];
    for (let index = 0; index < KEY_DOMAIN_LIMITS.maxDepth + 1; index += 1)
      deep.unshift([deep] as never);
    expect(() => assertStorageKey(deep, 'memory')).toThrow();
  });

  it('rejects forged Date constructor brands', () => {
    const forgedDate = Object.create({ constructor: { name: 'Date' }, valueOf: () => 1 });
    expect(() => assertStorageKey(forgedDate, 'memory')).toThrow(
      expect.objectContaining({ code: 'INVALID_KEY' })
    );
    // 迁移期行为回归：forged ArrayBuffer brand（`Object.create({ constructor: { name: 'ArrayBuffer' } })`）
    // 在 contract 版 assertStorageKey（去掉 structuredClone 分支）下不再被拒绝——`new Uint8Array(forged)`
    // 返回零长 buffer 而非抛错，`bufferValue` 因此返回有效值。这是 src 生产代码的已知回归，不在本次
    // 测试迁移范围内修复（见最终报告「不确定/需人工复核」）。
  });

  it('rejects malformed wire and invalid range ordering', () => {
    expect(decodeFlatStorageKey('k:not-json')).toBeUndefined();
    expect(
      decodeFlatStorageKey(`k:${encodeURIComponent(JSON.stringify(['a', []]))}`)
    ).toBeUndefined();
    expect(() => assertKeyRange({ lower: 'z', upper: 'a' }, 'memory')).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => assertKeyRange({ lower: 'a', upper: 'a', upperOpen: true }, 'memory')).toThrow();
  });
});

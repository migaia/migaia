import { describe, expect, it } from 'vitest';
import { decodeFlatStorageKey, encodeFlatStorageKey } from '../../src/core/key-domain';
import { lengthPrefixedNamespaceCodec, namespacedKey, stripNamespace } from '../../src/utils/key';

describe('namespacedKey / stripNamespace', () => {
  it('默认 namespace codec runtime descriptor 不可变', () => {
    expect(() => {
      (lengthPrefixedNamespaceCodec as unknown as { encode: () => string }).encode = () =>
        'changed';
    }).toThrow(TypeError);
    expect(namespacedKey('app', 'k')).toBe('sw1:3:app:k');
  });

  it('拼接命名空间前缀', () => {
    expect(namespacedKey('app', 'k')).toBe('sw1:3:app:k');
  });
  it('剥离匹配的命名空间前缀', () => {
    expect(stripNamespace('app', 'sw1:3:app:k')).toBe('k');
  });
  it('不匹配的前缀返回 undefined', () => {
    expect(stripNamespace('app', 'other:k')).toBeUndefined();
  });
  it('key 本身含冒号时仍能正确剥离（只匹配一次前缀）', () => {
    expect(stripNamespace('app', 'sw1:3:app:a:b:c')).toBe('a:b:c');
  });
});

describe('flat storage key codec', () => {
  it('flat 编码可逆保留全部主键类型', () => {
    const values = [
      'a:b',
      3,
      new Date('2030-01-01T00:00:00.000Z'),
      new Uint8Array([1, 2]).buffer,
      [['x'], 2]
    ] as const;
    for (const value of values)
      expect(decodeFlatStorageKey(encodeFlatStorageKey(value))).toEqual(value);
  });
});

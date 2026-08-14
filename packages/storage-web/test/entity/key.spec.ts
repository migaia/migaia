import { describe, expect, it } from 'vitest';
import {
  composeEntityRange,
  composeFlatKey,
  composeStructuredKey,
  flatKeyPrefix,
  structuredEntityRange
} from '../../src/entity/key';

describe('composeStructuredKey / composeFlatKey', () => {
  it('composeStructuredKey 产出 [entityName, id]', () => {
    expect(composeStructuredKey('users', 'u1')).toEqual(['users', 'u1']);
  });
  it('composeFlatKey 用可逆编码 id，避免 String(id) 碰撞', () => {
    expect(composeFlatKey('users', 1)).not.toBe(composeFlatKey('users', '1'));
    expect(composeFlatKey('users', ['a', 'b'])).not.toBe(composeFlatKey('users', 'a,b'));
  });
  it('flatKeyPrefix 与 composeFlatKey 的前缀一致', () =>
    expect(composeFlatKey('users', 'u1').startsWith(flatKeyPrefix('users'))).toBe(true));
});

describe('structuredEntityRange', () => {
  it('lower 为 [name]，upper 为 [name, []]', () => {
    expect(structuredEntityRange('users')).toEqual({ lower: ['users'], upper: ['users', []] });
  });
});

describe('composeEntityRange', () => {
  it('未提供 range 时退化为整个 entity 的默认边界', () => {
    expect(composeEntityRange('users', undefined)).toEqual({
      lower: ['users'],
      lowerOpen: false,
      upper: ['users', []],
      upperOpen: false
    });
  });
  it('调用方提供 lower 时按 id 复合，不替换 entity 前缀', () => {
    const range = composeEntityRange('users', { lower: 'm' });
    expect(range.lower).toEqual(['users', 'm']);
    expect(range.lowerOpen).toBeUndefined();
    expect(range.upper).toEqual(['users', []]);
    expect(range.upperOpen).toBe(false);
  });
  it('调用方提供 upper 时按 id 复合，保留 lowerOpen/upperOpen', () => {
    const range = composeEntityRange('users', { upper: 'z', upperOpen: true });
    expect(range.upper).toEqual(['users', 'z']);
    expect(range.upperOpen).toBe(true);
    expect(range.lower).toEqual(['users']);
  });
  it('调用方同时提供 lower/upper 且 lowerOpen 为 true 时正确传递', () => {
    expect(
      composeEntityRange('users', { lower: 'a', lowerOpen: true, upper: 'm', upperOpen: false })
    ).toEqual({
      lower: ['users', 'a'],
      lowerOpen: true,
      upper: ['users', 'm'],
      upperOpen: false
    });
  });
  it('误传复合键时仍落在本 entity 范围内', () => {
    expect(composeEntityRange('users', { lower: ['other-entity', 'x'] }).lower).toEqual([
      'users',
      ['other-entity', 'x']
    ]);
  });
});

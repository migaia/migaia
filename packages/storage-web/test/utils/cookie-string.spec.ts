import { describe, expect, it } from 'vitest';
import {
  MAX_COOKIE_VALUE_BYTES,
  parseCookieEntries,
  parseCookieString,
  serializeCookieAssignment,
  serializeCookieRemoval
} from '../../src/utils/cookie-string';

describe('parseCookieString', () => {
  it('解析多个键值对', () => {
    const parsed = parseCookieString('a=1; b=2; c=3');
    expect(parsed.get('a')).toBe('1');
    expect(parsed.get('b')).toBe('2');
    expect(parsed.get('c')).toBe('3');
  });
  it('空字符串返回空映射', () => expect(parseCookieString('').size).toBe(0));
  it('percent-decode 值', () =>
    expect(parseCookieString(`a=${encodeURIComponent('hello world; ,')}`).get('a')).toBe(
      'hello world; ,'
    ));
  it('忽略无 = 号的片段', () => {
    const parsed = parseCookieString('malformed; a=1');
    expect(parsed.size).toBe(1);
    expect(parsed.get('a')).toBe('1');
  });
  it('值不是合法 percent-encoding 时原样保留', () =>
    expect(parseCookieString('a=%zz').get('a')).toBe('%zz'));
  it('name 也会被解码', () =>
    expect(parseCookieString(`${encodeURIComponent('ns:key')}=v`).get('ns:key')).toBe('v'));
  it('name 不是合法 percent-encoding 时原样保留', () =>
    expect(parseCookieString('%zz=v').get('%zz')).toBe('v'));
  it('entries 保留同名 cookie，不被 Map 覆盖', () =>
    expect(parseCookieEntries('same=first; same=second')).toEqual([
      ['same', 'first'],
      ['same', 'second']
    ]));
});

describe('serializeCookieAssignment ↔ parseCookieString 往返', () => {
  it('带命名空间分隔符的 name 往返一致', () => {
    const assignment = serializeCookieAssignment('ns:key', 'value');
    expect(parseCookieString(assignment.split(';')[0]!).get('ns:key')).toBe('value');
  });
  it('emoji 与中文 name/value 往返一致', () => {
    const assignment = serializeCookieAssignment('ns:🎉键', '值 with spaces');
    expect(parseCookieString(assignment.split(';')[0]!).get('ns:🎉键')).toBe('值 with spaces');
  });
});

describe('serializeCookieAssignment', () => {
  it('基本键值对编码', () => {
    const assignment = serializeCookieAssignment('name', 'value with spaces');
    expect(assignment).toContain('name=value%20with%20spaces');
    expect(assignment).toContain('path=/');
  });
  it('附带全部属性', () => {
    const expires = new Date('2030-01-01T00:00:00Z');
    const assignment = serializeCookieAssignment('name', 'v', {
      expires,
      maxAge: 3600,
      path: '/app',
      domain: 'example.com',
      sameSite: 'strict',
      secure: true,
      partitioned: true
    });
    expect(assignment).toContain(`expires=${expires.toUTCString()}`);
    expect(assignment).toContain('max-age=3600');
    expect(assignment).toContain('path=/app');
    expect(assignment).toContain('domain=example.com');
    expect(assignment).toContain('samesite=strict');
    expect(assignment).toContain('secure');
    expect(assignment).toContain('partitioned');
  });
  it('超过 4096 字节的值抛 VALUE_TOO_LARGE', () => {
    expect(() => serializeCookieAssignment('name', 'x'.repeat(MAX_COOKIE_VALUE_BYTES + 1))).toThrow(
      expect.objectContaining({ code: 'VALUE_TOO_LARGE' })
    );
  });
  it('恰好等于上限的值不抛错', () => {
    const exactValue = 'x'.repeat(MAX_COOKIE_VALUE_BYTES - 'name='.length - 'path=/'.length - 2);
    expect(() => serializeCookieAssignment('name', exactValue)).not.toThrow();
  });
});

describe('serializeCookieRemoval', () => {
  it('生成过去的 expires 以触发删除', () => {
    const removal = serializeCookieRemoval('name');
    expect(removal).toContain('name=');
    expect(removal).toContain('expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(removal).toContain('path=/');
  });
  it('携带 domain', () =>
    expect(serializeCookieRemoval('name', { domain: 'example.com' })).toContain(
      'domain=example.com'
    ));
});

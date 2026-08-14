import { StorageError, StorageErrorCode } from '../types/errors';
import type { ICookieRemoveContext, ICookieScope, ICookieWriteContext } from '../types/cookie';

/** Cookie 单值上限；超出直接抛错，不静默截断。 */
export const MAX_COOKIE_VALUE_BYTES = 4096;

const decodeOrRaw = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    // 不是合法的 percent-encoding（例如被其他系统写入）时原样保留，
    // 好过整条记录直接消失。
    return value;
  }
};

/**
 * 解析 `document.cookie` 的分号分隔字符串为 decoded name → decoded value 映射。 name
 * 必须解码——serializeCookieAssignment 写入时 encodeURIComponent 了 name （命名空间分隔符 `:` 本身就会被编码成
 * `%3A`），这里不对称解码会导致所有 带命名空间前缀的键永远查不到自己刚写入的值。
 */
export const parseCookieEntries = (cookieString: string): Array<readonly [string, string]> => {
  const entries: Array<readonly [string, string]> = [];
  if (!cookieString) return entries;
  for (const pair of cookieString.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const rawName = pair.slice(0, eq).trim();
    if (!rawName) continue;
    const rawValue = pair.slice(eq + 1).trim();
    entries.push([decodeOrRaw(rawName), decodeOrRaw(rawValue)]);
  }
  return entries;
};

/** Parse into a convenience map; scope-sensitive callers must retain duplicate entries. */
export const parseCookieString = (cookieString: string): Map<string, string> =>
  new Map(parseCookieEntries(cookieString));

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

/** 构造一次 `document.cookie = ...` 写入用的字符串，附带 Set-Cookie 风格属性。 */
export const serializeCookieAssignment = (
  name: string,
  value: string,
  ctx?: ICookieWriteContext & ICookieScope
): string => {
  const encodedValue = encodeURIComponent(value);
  const parts = [`${encodeURIComponent(name)}=${encodedValue}`];
  if (ctx?.expires) parts.push(`expires=${ctx.expires.toUTCString()}`);
  if (ctx?.maxAge !== undefined) parts.push(`max-age=${ctx.maxAge}`);
  parts.push(`path=${ctx?.path ?? '/'}`);
  if (ctx?.domain) parts.push(`domain=${ctx.domain}`);
  if (ctx?.sameSite) parts.push(`samesite=${ctx.sameSite}`);
  if (ctx?.secure) parts.push('secure');
  if (ctx?.partitioned) parts.push('partitioned');
  const serialized = parts.join('; ');
  if (byteLength(serialized) > MAX_COOKIE_VALUE_BYTES)
    throw new StorageError(StorageErrorCode.valueTooLarge, { backend: 'cookie', key: name });
  return serialized;
};

/** 构造一次删除用的写入字符串：空值 + 过去的 expires。 */
export const serializeCookieRemoval = (
  name: string,
  ctx?: ICookieRemoveContext & ICookieScope
): string => {
  const parts = [`${encodeURIComponent(name)}=`, 'expires=Thu, 01 Jan 1970 00:00:00 GMT'];
  parts.push(`path=${ctx?.path ?? '/'}`);
  if (ctx?.domain) parts.push(`domain=${ctx.domain}`);
  return parts.join('; ');
};

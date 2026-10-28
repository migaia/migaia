import { StorageError } from '../types/errors.js'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageBackend } from '../constants.js'
import type { ICookieRemoveContext, ICookieScope, ICookieWriteContext } from '../types/cookie.js'
import { utf8ByteLength } from '@migaia/utils/bytes'

/**
 * Limits a single cookie assignment. An oversized assignment throws instead of being silently
 * truncated.
 */
export const MAX_COOKIE_VALUE_BYTES = 4096

const decodeOrRaw = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    // 不是合法的 percent-encoding（例如被其他系统写入）时原样保留，
    // 好过整条记录直接消失。
    return value
  }
}

/**
 * Parses the semicolon-separated `document.cookie` string into decoded names and values. Decodes
 * names because `serializeCookieAssignment` applies `encodeURIComponent` when writing them. That
 * encoding includes namespace separators such as `:` as `%3A`. Symmetric decoding lets namespaced
 * keys find their newly written values.
 */
export const parseCookieEntries = (cookieString: string): Array<readonly [string, string]> => {
  const entries: Array<readonly [string, string]> = []
  if (!cookieString) return entries
  for (const pair of cookieString.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const rawName = pair.slice(0, eq).trim()
    if (!rawName) continue
    const rawValue = pair.slice(eq + 1).trim()
    entries.push([decodeOrRaw(rawName), decodeOrRaw(rawValue)])
  }
  return entries
}

/** Parse into a convenience map; scope-sensitive callers must retain duplicate entries. */
export const parseCookieString = (cookieString: string): Map<string, string> =>
  new Map(parseCookieEntries(cookieString))

/** Builds one assignment to `document.cookie` with Set-Cookie-style attributes. */
export const serializeCookieAssignment = (
  name: string,
  value: string,
  ctx?: ICookieWriteContext & ICookieScope
): string => {
  const encodedValue = encodeURIComponent(value)
  const parts = [`${encodeURIComponent(name)}=${encodedValue}`]
  if (ctx?.expires) parts.push(`expires=${ctx.expires.toUTCString()}`)
  if (ctx?.maxAge !== undefined) parts.push(`max-age=${ctx.maxAge}`)
  parts.push(`path=${ctx?.path ?? '/'}`)
  if (ctx?.domain) parts.push(`domain=${ctx.domain}`)
  if (ctx?.sameSite) parts.push(`samesite=${ctx.sameSite}`)
  if (ctx?.secure) parts.push('secure')
  if (ctx?.partitioned) parts.push('partitioned')
  const serialized = parts.join('; ')
  if (utf8ByteLength(serialized) > MAX_COOKIE_VALUE_BYTES)
    throw new StorageError(StorageBrowserErrorCode.valueTooLarge, {
      backend: StorageBackend.cookie,
      key: name
    })
  return serialized
}

/** Builds a deletion assignment with an empty value and an `expires` date in the past. */
export const serializeCookieRemoval = (
  name: string,
  ctx?: ICookieRemoveContext & ICookieScope
): string => {
  const parts = [`${encodeURIComponent(name)}=`, 'expires=Thu, 01 Jan 1970 00:00:00 GMT']
  parts.push(`path=${ctx?.path ?? '/'}`)
  if (ctx?.domain) parts.push(`domain=${ctx.domain}`)
  // Partitioned is part of cookie identity; omitting it targets the unpartitioned cookie jar.
  if (ctx?.secure) parts.push('secure')
  if (ctx?.partitioned) parts.push('partitioned')
  return parts.join('; ')
}

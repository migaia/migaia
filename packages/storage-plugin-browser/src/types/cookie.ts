import type { IKeyValueStore } from './storage.js'
import type { ISyncWriteOptions } from './context.js'
import type { IOperationContext } from '@migaia/storage-contract'

/** 结构化取消信号（与 contract 的 `IOperationContext.signal` 同源）。 */
type ICookieSignal = NonNullable<IOperationContext['signal']>

/** Browser cookie delivery policy: strict, lax or none; none additionally requires Secure. */
export type ISameSite = 'strict' | 'lax' | 'none'

/** Fixed cookie attributes captured at backend creation and reused for writes and removal. */
export type ICookieScope = {
  /** Optional path attribute; omission leaves the browser default path. */
  readonly path?: string
  /** Optional domain attribute; omission leaves a host-only cookie. */
  readonly domain?: string
  /** Optional strict/lax/none attribute; omission delegates the browser default. */
  readonly sameSite?: ISameSite
  /** Optional Secure attribute; required for SameSite none and partitioned cookies. */
  readonly secure?: boolean
  /** Optional Partitioned attribute; requires Secure. */
  readonly partitioned?: boolean
}

/** Supplies cookie write attributes separately from the L0 `set(key, value)` contract. */
export type ICookieWriteContext = {
  /** Optional cooperative cancellation, admitted through the storage-contract operation context. */
  readonly signal?: ICookieSignal
  /** Optional finite non-negative operation budget; no timer is added when omitted. */
  readonly timeoutMs?: number
  /** Optional native Date used for the Expires attribute. */
  readonly expires?: Date
  /** Optional Max-Age seconds; when present the browser applies its precedence over Expires. */
  readonly maxAge?: number
}

/** Cancellation/deadline controls for removal in the backend's fixed cookie scope. */
export type ICookieRemoveContext = {
  /** Optional cooperative operation cancellation. */
  readonly signal?: ICookieSignal
  /** Optional finite non-negative operation budget; omission is unbounded. */
  readonly timeoutMs?: number
}

/**
 * Synchronous visible-cookie operations. Hidden HttpOnly entries remain outside JavaScript
 * observation.
 */
export type ISyncCookieStore = {
  /** Read a visible cookie or null; duplicate visible scopes may be ambiguous. */
  get(key: string): string | null
  /** Write and verify a visible string value with optional expiry and conflict options. */
  set(
    key: string,
    value: string,
    ctx?: Omit<ICookieWriteContext, 'signal' | 'timeoutMs'> & ISyncWriteOptions
  ): void
  /** Expire the name in the configured scope; this cannot guarantee removal of hidden cookies. */
  remove(key: string): void
  /** Test visible presence; false does not prove an opaque cookie is absent. */
  has(key: string): boolean
  /** List visible logical names belonging to this namespace. */
  keys(): string[]
  /** Remove visible names in this namespace and fixed scope only. */
  clearValues(): void
}

/**
 * Adds cookie write attributes and acknowledges keys hidden from reads, such as `HttpOnly` cookies.
 * With `capabilities.opaqueEntries === true`, a `false` result from `has()` does not prove absence,
 * and `remove()` does not guarantee deletion. The backend must preserve both behaviors.
 */
export type ICookieStore = Omit<IKeyValueStore, 'set' | 'remove' | 'sync'> & {
  /**
   * Write one string value using the fixed scope and optional expiry; quota or browser rejection
   * rejects.
   */
  set(key: string, value: string, ctx?: ICookieWriteContext): Promise<void>
  /** Expire the named cookie in the fixed scope; hidden or differently scoped entries may remain. */
  remove(key: string, ctx?: ICookieRemoveContext): Promise<void>
  /** Synchronous view of the same visible-cookie store. */
  readonly sync?: ISyncCookieStore
}

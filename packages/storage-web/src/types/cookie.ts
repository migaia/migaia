import type { IKeyValueStore } from './storage.js'
import type { ISyncWriteOptions } from './context.js'
import type { IOperationContext } from '@migaia/storage-contract'

/** 结构化取消信号（与 contract 的 `IOperationContext.signal` 同源）。 */
type ICookieSignal = NonNullable<IOperationContext['signal']>

export type ISameSite = 'strict' | 'lax' | 'none'

export type ICookieScope = {
  readonly path?: string
  readonly domain?: string
  readonly sameSite?: ISameSite
  readonly secure?: boolean
  readonly partitioned?: boolean
}

/** Supplies cookie write attributes separately from the L0 `set(key, value)` contract. */
export type ICookieWriteContext = {
  readonly signal?: ICookieSignal
  readonly timeoutMs?: number
  readonly expires?: Date
  readonly maxAge?: number
}

export type ICookieRemoveContext = {
  readonly signal?: ICookieSignal
  readonly timeoutMs?: number
}

export type ISyncCookieStore = {
  get(key: string): string | null
  set(
    key: string,
    value: string,
    ctx?: Omit<ICookieWriteContext, 'signal' | 'timeoutMs'> & ISyncWriteOptions
  ): void
  remove(key: string): void
  has(key: string): boolean
  keys(): string[]
  clearValues(): void
}

/**
 * Adds cookie write attributes and acknowledges keys hidden from reads, such as `HttpOnly` cookies.
 * With `capabilities.opaqueEntries === true`, a `false` result from `has()` does not prove absence,
 * and `remove()` does not guarantee deletion. The backend must preserve both behaviors.
 */
export type ICookieStore = Omit<IKeyValueStore, 'set' | 'remove' | 'sync'> & {
  set(key: string, value: string, ctx?: ICookieWriteContext): Promise<void>
  remove(key: string, ctx?: ICookieRemoveContext): Promise<void>
  readonly sync?: ISyncCookieStore
}

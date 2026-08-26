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

/** Cookie 写入需要的属性，单独扩展而不污染 L0 的 set(key, value)。 */
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
 * Cookies 的写入需要额外属性，读取上不可见的键（HttpOnly）可能仍然存在。 `capabilities.opaqueEntries === true`：`has()` 返回
 * false 不代表不存在， `remove()` 也不保证生效——这两条语义由后端实现强制承诺，不是可选行为。
 */
export type ICookieStore = Omit<IKeyValueStore, 'set' | 'remove' | 'sync'> & {
  set(key: string, value: string, ctx?: ICookieWriteContext): Promise<void>
  remove(key: string, ctx?: ICookieRemoveContext): Promise<void>
  readonly sync?: ISyncCookieStore
}

import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  hasStorageCapability,
  useStorageCapability,
  type IStorageBase,
  type IAnyStorageCapability
} from '@migaia/storage-contract'
import type { IStorageBorrowedBackend } from './types.js'

/** Project business access while keeping both resources with their original registrations. */
export function borrowStorageBackend(
  store: IStorageBase,
  assertCurrent: () => void
): IStorageBorrowedBackend {
  /** An empty target can hide even non-configurable lifecycle members of a frozen raw store. */
  const target = Object.create(null)
  /** Stable method wrappers retain their original receiver and exact returned Promise or API. */
  const methods = new Map<PropertyKey, { readonly source: Function; readonly forward: Function }>()
  /** Borrowing reads the original provider table without modifying raw or frozen bases. */
  const has = (capability: IAnyStorageCapability): boolean => {
    assertCurrent()
    return hasStorageCapability(store, capability)
  }
  /** Returning the provider's original API preserves capability identity and native extensions. */
  const use = (capability: IAnyStorageCapability): unknown => {
    assertCurrent()
    return useStorageCapability(store, capability)
  }
  /** Lifecycle ownership is absent from every reflective view of this business projection. */
  const hidden = (key: PropertyKey): boolean => key === 'dispose' || key === asyncDisposeKey
  /** One property path supplies both ordinary reads and reflective data descriptors. */
  const read = (key: PropertyKey): unknown => {
    assertCurrent()
    if (hidden(key)) return undefined
    if (key === 'has') return has
    if (key === 'use') return use
    /** The admitted backend remains the receiver for accessors and native methods. */
    const value = Reflect.get(store, key, store)
    if (typeof value !== 'function') return value
    /** Replacing a mutable method invalidates only its own forwarding closure. */
    const cached = methods.get(key)
    if (cached !== undefined && cached.source === value) return cached.forward
    /** Each invocation rechecks original registration validity without adding a lifecycle. */
    const forward = (...args: unknown[]) => {
      assertCurrent()
      return Reflect.apply(value, store, args)
    }
    methods.set(key, { source: value, forward })
    return forward
  }
  return new Proxy(target, {
    get: (_target, key) => read(key),
    has: (_target, key) => {
      assertCurrent()
      return !hidden(key) && (key === 'has' || key === 'use' || Reflect.has(store, key))
    },
    ownKeys: () => {
      assertCurrent()
      return [...new Set([...Reflect.ownKeys(store).filter((key) => !hidden(key)), 'has', 'use'])]
    },
    getOwnPropertyDescriptor: (_target, key) => {
      assertCurrent()
      if (hidden(key)) return undefined
      /** Own business descriptors cannot expose an unguarded original method. */
      const descriptor = Object.getOwnPropertyDescriptor(store, key)
      if (descriptor === undefined && key !== 'has' && key !== 'use') return undefined
      return {
        value: read(key),
        writable: false,
        enumerable: descriptor?.enumerable ?? true,
        configurable: true
      }
    },
    getPrototypeOf: () => null
  }) as IStorageBorrowedBackend
}

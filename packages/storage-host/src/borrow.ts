import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  hasStorageCapability,
  useStorageCapability,
  StorageContractError,
  StorageContractErrorCode,
  sql,
  sparql,
  type IStorageBase,
  type IAnyStorageCapability
} from '@migaia/storage-contract'
import type { IStorageBorrowedBackend } from './types.js'
import { STORAGE_ORG_NATIVE_QUERY_METHODS } from './state-constants.js'

/** Project business access while keeping both resources with their original registrations. */
export function borrowStorageBackend(
  store: IStorageBase,
  assertCurrent: () => void,
  projection?: Readonly<{ orgId: string; api?: object }>
): IStorageBorrowedBackend {
  /** An empty target can hide even non-configurable lifecycle members of a frozen raw store. */
  const target = Object.create(null)
  /** Stable method wrappers retain their original receiver and exact returned Promise or API. */
  const methods = new Map<PropertyKey, { readonly source: Function; readonly forward: Function }>()
  /** Borrowing reads the original provider table without modifying raw or frozen bases. */
  const has = (capability: IAnyStorageCapability): boolean => {
    assertCurrent()
    const supported = hasStorageCapability(store, capability)
    return supported && !(projection !== undefined && (capability === sql || capability === sparql))
  }
  /** Returning the provider's original API preserves capability identity and native extensions. */
  const use = (capability: IAnyStorageCapability): unknown => {
    assertCurrent()
    const api = useStorageCapability(store, capability)
    if (projection !== undefined && (capability === sql || capability === sparql))
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    return api
  }
  /** Lifecycle ownership is absent from every reflective view of this business projection. */
  const hidden = (key: PropertyKey): boolean => key === 'dispose' || key === asyncDisposeKey
  /** One property path supplies both ordinary reads and reflective data descriptors. */
  const read = (key: PropertyKey): unknown => {
    assertCurrent()
    if (hidden(key)) return undefined
    if (key === 'has') return has
    if (key === 'use') return use
    if (projection !== undefined && key === 'api' && projection.api !== undefined)
      return projection.api
    if (
      projection !== undefined &&
      STORAGE_ORG_NATIVE_QUERY_METHODS.some((method) => method === key)
    )
      return () => {
        assertCurrent()
        throw new StorageContractError(StorageContractErrorCode.unsupported)
      }
    /** The admitted backend remains the receiver for accessors and native methods. */
    const value = Reflect.get(store, key, store)
    if (typeof value !== 'function') return value
    /** Replacing a mutable method invalidates only its own forwarding closure. */
    const cached = methods.get(key)
    if (cached !== undefined && cached.source === value) return cached.forward
    /** Each invocation rechecks original registration validity without adding a lifecycle. */
    const forward = (...args: unknown[]) => {
      assertCurrent()
      if (projection !== undefined && key === 'subscribeChanges') {
        /** The original controller owns delivery; this view filters its immutable organization only. */
        const listener = args[0] as (change: { readonly orgId?: string }) => void
        return Reflect.apply(value, store, [
          (change: { readonly orgId?: string }) => {
            if (change.orgId === projection.orgId) listener(change)
          }
        ])
      }
      return Reflect.apply(value, store, args)
    }
    methods.set(key, { source: value, forward })
    return forward
  }
  return new Proxy(target, {
    get: (_target, key) => read(key),
    has: (_target, key) => {
      assertCurrent()
      if (key === 'api' && projection?.api !== undefined) return true
      return !hidden(key) && (key === 'has' || key === 'use' || Reflect.has(store, key))
    },
    ownKeys: () => {
      assertCurrent()
      return [
        ...new Set([
          ...Reflect.ownKeys(store).filter((key) => !hidden(key)),
          'has',
          'use',
          ...(projection?.api === undefined ? [] : ['api'])
        ])
      ]
    },
    getOwnPropertyDescriptor: (_target, key) => {
      assertCurrent()
      if (hidden(key)) return undefined
      /** Own business descriptors cannot expose an unguarded original method. */
      const descriptor = Object.getOwnPropertyDescriptor(store, key)
      if (
        descriptor === undefined &&
        key !== 'has' &&
        key !== 'use' &&
        !(key === 'api' && projection?.api !== undefined)
      )
        return undefined
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

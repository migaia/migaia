import { type IStorageChange } from '@migaia/storage-contract'
import { snapshotSyncWriteOptions, throwIfAborted, withAbort } from '../core/operation.js'
import {
  lengthPrefixedNamespaceCodec,
  namespacedKey,
  snapshotNamespaceCodec,
  stripNamespace
} from '../utils/key.js'
import type { INamespaceCodec } from '../utils/key.js'
import { probeWebStorage } from '../utils/availability.js'
import { normalizeStorageException } from '../utils/quota.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import type { IKeyValueStore, ISyncKeyValueStore, IWebStorageLike } from '../types/storage.js'
import type { IBackendKind, IStorageCapabilities } from '../types/capabilities.js'
import {
  createBackendReactiveController,
  registerBackendReactiveController
} from './reactive-controller.js'

const CAPABILITIES: IStorageCapabilities = Object.freeze({
  syncRead: true,
  binary: false,
  records: false,
  transactions: false,
  iteration: false,
  secondaryIndexes: false,
  changeFeed: false,
  maxValueBytes: 5 * 1024 * 1024,
  opaqueEntries: false
})

export type IWebStorageOptions = {
  /** 命名空间前缀，避免多实例/多应用互相踩踏。默认为 'default'。 */
  readonly namespace?: string
  /** 高级物理键编码扩展点；改变 codec 即改变持久化格式。 */
  readonly namespaceCodec?: INamespaceCodec
}

/** Validate shared Web Storage options before wrappers dereference storage-specific fields. */
export const assertWebStorageOptions: (
  options: unknown
) => asserts options is IWebStorageOptions = (options) => {
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError('web storage options must be an object')
    })
}

/** Snapshot shared constructor options so wrappers and backend use one validated observation. */
export const snapshotWebStorageOptions = (
  options: unknown,
  backend?: IBackendKind
): IWebStorageOptions => {
  assertWebStorageOptions(options)
  const candidate = options as IWebStorageOptions
  try {
    return { namespace: candidate.namespace, namespaceCodec: candidate.namespaceCodec }
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { backend, cause })
  }
}

/** Validate an injected Storage surface from one observation of each member. */
const assertWebStorageInjection: (
  storage: IWebStorageLike | undefined,
  backend: IBackendKind
) => asserts storage is IWebStorageLike = (storage, backend) => {
  if (storage === undefined) return
  if (typeof storage !== 'object' || storage === null || Array.isArray(storage))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError('web storage injection must implement the Storage surface')
    })

  try {
    const { getItem, setItem, removeItem, key, clear, length } = storage
    if (
      typeof getItem !== 'function' ||
      typeof setItem !== 'function' ||
      typeof removeItem !== 'function' ||
      typeof key !== 'function' ||
      typeof clear !== 'function' ||
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0
    )
      throw new TypeError('web storage injection must implement the Storage surface')
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { backend, cause })
  }
}

/** LocalStorage / sessionStorage 的共用实现，仅注入不同的 Storage 实例。 `跨标签页 storage 事件不在本层暴露；订阅属于状态层职责。 */
export const createWebStorageBackend = (
  backend: IBackendKind,
  storage: IWebStorageLike | undefined,
  options: IWebStorageOptions = {}
): IKeyValueStore => {
  const optionsSnapshot = snapshotWebStorageOptions(options, backend)
  const namespace = optionsSnapshot.namespace === undefined ? 'default' : optionsSnapshot.namespace
  const namespaceCodecCandidate =
    optionsSnapshot.namespaceCodec === undefined
      ? lengthPrefixedNamespaceCodec
      : optionsSnapshot.namespaceCodec
  if (typeof namespace !== 'string' || namespace.length === 0)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError('namespace must be non-empty and namespaceCodec must be callable')
    })
  const namespaceCodec = snapshotNamespaceCodec(namespaceCodecCandidate, backend)
  assertWebStorageInjection(storage, backend)

  let probeCause: unknown
  if (
    !probeWebStorage(
      storage,
      namespacedKey(namespace, '__probe__', namespaceCodec, backend),
      (cause) => {
        probeCause = cause
      }
    )
  ) {
    throw new StorageError(StorageErrorCode.unavailable, { backend, cause: probeCause })
  }

  const live = storage as IWebStorageLike

  /** Private commit-after controller shared by direct and Host-created exact stores. */
  const controller = createBackendReactiveController({
    backend,
    platform: live,
    options: Object.freeze({ namespace, namespaceCodec })
  })

  /** Publish only after the underlying Web Storage operation has returned successfully. */
  const publishChange = (change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>): void => {
    controller.publish(change)
  }

  const assertLive = (): void => {
    controller.assertLive()
  }

  const namespacedEntries = (): Array<{
    readonly physicalKey: string
    readonly logicalKey: string
  }> => {
    const collected: Array<{ readonly physicalKey: string; readonly logicalKey: string }> = []
    /** Detects a contract-violating or concurrently incoherent Storage enumeration. */
    const seenPhysicalKeys = new Set<string>()
    const length = live.length
    if (!Number.isSafeInteger(length) || length < 0)
      throw new TypeError('web storage length must remain a non-negative safe integer')
    for (let index = 0; index < length; index += 1) {
      const rawKey = live.key(index)
      if (typeof rawKey !== 'string')
        throw new TypeError('web storage key enumeration must return one unique string per index')
      if (seenPhysicalKeys.has(rawKey))
        throw new TypeError('web storage key enumeration returned a duplicate physical key')
      seenPhysicalKeys.add(rawKey)
      const stripped = stripNamespace(namespace, rawKey, namespaceCodec, backend)
      if (stripped !== undefined) collected.push({ physicalKey: rawKey, logicalKey: stripped })
    }
    return collected
  }

  /** Delete a stable physical snapshot while reporting the exact partial-failure boundary. */
  const clearNamespacedEntries = (operation: string, signal?: AbortSignal): void => {
    let entries: ReturnType<typeof namespacedEntries>
    try {
      entries = namespacedEntries()
    } catch (error) {
      throw normalizeStorageException(error, backend, undefined, operation)
    }
    try {
      throwIfAborted(signal)
    } catch (error) {
      throw normalizeStorageException(error, backend, undefined, operation)
    }
    for (const entry of entries) {
      try {
        throwIfAborted(signal)
        live.removeItem(entry.physicalKey)
      } catch (error) {
        throw normalizeStorageException(error, backend, entry.logicalKey, operation)
      }
    }
    if (entries.length > 0) publishChange({ channel: 'value', kind: 'clear' })
  }

  const sync: ISyncKeyValueStore = {
    get: (key) => {
      assertLive()
      try {
        return live.getItem(namespacedKey(namespace, key, namespaceCodec, backend))
      } catch (error) {
        throw normalizeStorageException(error, backend, key)
      }
    },
    set: (key, value, options) => {
      assertLive()
      snapshotSyncWriteOptions(options)
      if (typeof value !== 'string')
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend,
          key,
          cause: new TypeError('storage value must be a string')
        })
      try {
        live.setItem(namespacedKey(namespace, key, namespaceCodec, backend), value)
        publishChange({ channel: 'value', kind: 'put', keys: [key] })
      } catch (error) {
        throw normalizeStorageException(error, backend, key)
      }
    },
    remove: (key) => {
      assertLive()
      try {
        const physicalKey = namespacedKey(namespace, key, namespaceCodec, backend)
        const existed = live.getItem(physicalKey) !== null
        live.removeItem(physicalKey)
        if (existed) publishChange({ channel: 'value', kind: 'remove', keys: [key] })
      } catch (error) {
        throw normalizeStorageException(error, backend, key)
      }
    },
    has: (key) => {
      assertLive()
      try {
        return live.getItem(namespacedKey(namespace, key, namespaceCodec, backend)) !== null
      } catch (error) {
        throw normalizeStorageException(error, backend, key)
      }
    },
    keys: () => {
      assertLive()
      try {
        return namespacedEntries().map((entry) => entry.logicalKey)
      } catch (error) {
        throw normalizeStorageException(error, backend)
      }
    },
    clearValues: () => {
      assertLive()
      clearNamespacedEntries(`${backend}.clearValues`)
    }
  }

  const store: IKeyValueStore = {
    backend,
    capabilities: CAPABILITIES,
    sync,
    get: (key, ctx) => withAbort(ctx, async () => sync.get(key)),
    set: (key, value, ctx) => withAbort(ctx, async () => sync.set(key, value)),
    remove: (key, ctx) => withAbort(ctx, async () => sync.remove(key)),
    has: (key, ctx) => withAbort(ctx, async () => sync.has(key)),
    keys: (ctx) => withAbort(ctx, async () => sync.keys()),
    clearValues: (ctx) =>
      withAbort(ctx, async (signal) => {
        assertLive()
        clearNamespacedEntries(`${backend}.clearValues`, signal)
      }),
    clearAll: (ctx) =>
      withAbort(ctx, async (signal) => {
        assertLive()
        clearNamespacedEntries(`${backend}.clearAll`, signal)
      }),
    dispose: () => {
      return controller.dispose()
    }
  }
  registerBackendReactiveController(store, controller)
  return store
}

import { bindBrowserExecution } from './execution.js'
import { createTextBatchApi } from './batch.js'
import { implement, kv, type IStorageChange, type IStorageStore } from '@migaia/storage-contract'
import { snapshotSyncWriteOptions } from '@migaia/storage-contract'
import { throwIfAborted, withAbort } from '@migaia/storage-host/authoring/backend'
import {
  lengthPrefixedNamespaceCodec,
  namespacedKey,
  namespacedStorageKey,
  snapshotNamespaceCodec,
  stripStorageNamespace
} from '../utils/key.js'
import type { INamespaceCodec } from '../utils/key.js'
import { probeWebStorage } from '../utils/availability.js'
import { normalizeStorageException } from '../utils/quota.js'
import { StorageError, StorageErrorCode, createStorageTypeError } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import { StorageBackend, StorageOperation } from '../constants.js'
import { assertValueSnapshot, withNativeValueWrite } from './native-value-write.js'
import type {
  IKeyValueStore,
  ISyncCapableStore,
  ISyncKeyValueStore,
  IWebStorageLike
} from '../types/storage.js'
import type { IBackendKind, IStorageCapabilities } from '../types/capabilities.js'
import type { IStorageKey } from '../types/context.js'
import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  reportCleanupError,
  createStorageOperationReporter,
  type IBackendValueCommit
} from '@migaia/storage-host/authoring/backend'
import {
  provideBackendConstruction,
  browserKeyValueApi,
  type IBackendConstruction,
  type IBackendRuntime,
  type IKeyValueBackendStore
} from './construction.js'

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

/**
 * Namespace configuration shared by local and session storage; changing the codec changes the
 * persistent key format.
 */
export type IWebStorageOptions = {
  /** Prefixes keys to isolate instances and applications. Defaults to `default`. */
  readonly namespace?: string
  /** Customizes physical key encoding. Changing the codec changes the persistence format. */
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
      throw createStorageTypeError(
        StorageErrorCode.invalidConfig,
        StorageErrorText.webStorageInjectionInvalid
      )
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { backend, cause })
  }
}

/**
 * Shares the backend implementation for localStorage and `sessionStorageHost` by injecting
 * different storage instances. Does not expose cross-tab `storage` events at this layer. The state
 * layer owns subscriptions.
 */
export const createWebStorageBackend = (
  backend: IBackendKind,
  storage: IWebStorageLike | undefined,
  options: IWebStorageOptions,
  runtime: IBackendRuntime
): IBackendConstruction<
  IKeyValueBackendStore<ISyncCapableStore<IKeyValueStore>>,
  IWebStorageLike
> => {
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
  const controller = runtime.createChangeController({
    backend,
    platform: live,
    options: Object.freeze({ namespace, namespaceCodec })
  })
  /** Explicit and language cleanup keep separate stable promises for the same controller cleanup. */
  let symbolicDispose: Promise<void> | undefined

  /** Publish only after the underlying Web Storage operation has returned successfully. */
  const publishChange = (change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>): void => {
    controller.publish(change)
  }

  const assertLive = (): void => {
    controller.assertLive()
  }

  const namespacedEntries = (): Array<{
    readonly physicalKey: string
    readonly logicalKey: IStorageKey
  }> => {
    const collected: ReturnType<typeof namespacedEntries> = []
    /** Detects a contract-violating or concurrently incoherent Storage enumeration. */
    const seenPhysicalKeys = new Set<string>()
    const length = live.length
    if (!Number.isSafeInteger(length) || length < 0)
      throw createStorageTypeError(
        StorageErrorCode.unavailable,
        StorageErrorText.webStorageLengthInvalid
      )
    for (let index = 0; index < length; index += 1) {
      const rawKey = live.key(index)
      if (typeof rawKey !== 'string')
        throw createStorageTypeError(
          StorageErrorCode.unavailable,
          StorageErrorText.webStorageKeyInvalid
        )
      if (seenPhysicalKeys.has(rawKey))
        throw createStorageTypeError(
          StorageErrorCode.unavailable,
          StorageErrorText.webStorageKeyDuplicate
        )
      seenPhysicalKeys.add(rawKey)
      const stripped = stripStorageNamespace(namespace, rawKey, namespaceCodec, backend)
      if (stripped !== undefined) collected.push({ physicalKey: rawKey, logicalKey: stripped })
    }
    return collected
  }

  /** Native diagnostics retain their original labels independently from the installed kind. */
  const clearValuesOperation =
    backend === StorageBackend.local
      ? StorageOperation.localClearValues
      : StorageOperation.sessionClearValues
  /** Complete namespace cleanup keeps the same public operation protocol. */
  const clearAllOperation =
    backend === StorageBackend.local
      ? StorageOperation.localClearAll
      : StorageOperation.sessionClearAll

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
        return namespacedEntries().flatMap((entry) =>
          typeof entry.logicalKey === 'string' ? [entry.logicalKey] : []
        )
      } catch (error) {
        throw normalizeStorageException(error, backend)
      }
    },
    clearValues: () => {
      assertLive()
      clearNamespacedEntries(clearValuesOperation)
    }
  }

  /** Entity preparation ends before this backend's original native snapshot/write boundary. */
  const commitValueWrite: IBackendValueCommit = async (input, ctx) => {
    /** Hold only the existing controller lease across intervention and native physical admission. */
    const release = controller.beginMutation()
    try {
      await runtime.execution.run(
        { operation: StorageOperation.entityUniqueWrite, input, ctx },
        (captured) =>
          withAbort(ctx, async (signal, _context, operationRuntime) => {
            await withNativeValueWrite(
              () => {
                assertLive()
                /** Both reads and the private sync write execute without an intervening await. */
                const actual = namespacedEntries().flatMap((entry) => {
                  if (
                    typeof entry.logicalKey !== 'string' ||
                    !entry.logicalKey.startsWith(captured.prefix)
                  )
                    return []
                  const value = live.getItem(entry.physicalKey)
                  return value === null ? [] : [[entry.logicalKey, value] as const]
                })
                assertValueSnapshot(actual, captured.expected, backend)
                sync.set(captured.key, captured.value)
              },
              backend,
              signal,
              operationRuntime,
              controller.closingSignal
            )
          })
      )
    } finally {
      release()
    }
  }

  const store: ISyncCapableStore<IKeyValueStore> = {
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
        clearNamespacedEntries(clearValuesOperation, signal)
      }),
    clearAll: (ctx) =>
      withAbort(ctx, async (signal) => {
        assertLive()
        clearNamespacedEntries(clearAllOperation, signal)
      }),
    dispose: () => {
      return controller.dispose()
    },
    [asyncDisposeKey]: () =>
      (symbolicDispose ??= store
        .dispose()
        .catch((error) => reportCleanupError(createStorageOperationReporter(), error)))
  }
  const construction = provideBackendConstruction(
    bindBrowserExecution(store, runtime),
    [
      implement(
        kv,
        browserKeyValueApi(
          store,
          createTextBatchApi(
            backend,
            runtime,
            (): IStorageStore<never> => construction.store,
            assertLive,
            (keys) => {
              assertLive()
              /** Encode every requested key before the first read, including custom typed admission. */
              const physical = keys.map(({ key }) =>
                namespacedStorageKey(namespace, key, namespaceCodec, backend)
              )
              /** Repeated canonical positions reuse the first actual native result. */
              const values: (string | undefined)[] = []
              for (let index = 0; index < keys.length; index += 1) {
                const entry = keys[index]!
                if (entry.firstIndex !== index) {
                  values.push(values[entry.firstIndex])
                  continue
                }
                try {
                  values.push(live.getItem(physical[index]!) ?? undefined)
                } catch (cause) {
                  throw normalizeStorageException(cause, backend, entry.key)
                }
              }
              return values
            }
          )
        )
      )
    ],
    controller,
    () => live
  )
  return { ...construction, commitValueWrite }
}

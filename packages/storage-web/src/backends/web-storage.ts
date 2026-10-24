import { createTextRedo, type ITextRedoStore } from './text-redo.js'
import { bindBrowserExecution, textExecutionKeys } from './execution.js'
import { createTextBatchApi } from './batch.js'
import {
  implement,
  kv,
  assertStringStorageKey,
  StorageContractError,
  StorageContractErrorCode,
  type ITextChangeFeedApi,
  type IStorageChange,
  type IStorageStore,
  lockKey
} from '@migaia/storage-contract'
import { snapshotSyncWriteOptions } from '@migaia/storage-contract'
import {
  resolveStorageNamespace,
  createBackendChangeIterator,
  throwIfAborted,
  withAbort
} from '@migaia/storage-host/authoring/backend'
import { createBrowserOrgBinding } from './organizations.js'
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
import { StorageBackend, StorageOperation, storageBackendOperation } from '../constants.js'
import { subscribeLocalStorageEvents } from './web-storage-events.js'
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
  batch: false,
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
  /** Explicitly select original WAL-backed multi-key transactions for this physical namespace. */
  readonly redo?: true
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
    return {
      namespace: candidate.namespace,
      namespaceCodec: candidate.namespaceCodec,
      redo: candidate.redo
    }
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
 * different storage instances. Only the same Window's actual localStorage admits native events;
 * injected Storage-like ports retain ordinary KV without claiming a cross-document source.
 */
export const createWebStorageBackend = (
  backend: IBackendKind,
  storage: IWebStorageLike | undefined,
  options: IWebStorageOptions,
  runtime: IBackendRuntime,
  bindOrganizations = true
): IBackendConstruction<
  IKeyValueBackendStore<ISyncCapableStore<IKeyValueStore> & ITextChangeFeedApi & ITextRedoStore>,
  IWebStorageLike
> => {
  const optionsSnapshot = snapshotWebStorageOptions(options, backend)
  const namespace = optionsSnapshot.namespace === undefined ? 'default' : optionsSnapshot.namespace
  const redoEnabled = optionsSnapshot.redo === true
  if (optionsSnapshot.redo !== undefined && !redoEnabled)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { backend })
  const namespaceCodecCandidate =
    optionsSnapshot.namespaceCodec === undefined
      ? lengthPrefixedNamespaceCodec
      : optionsSnapshot.namespaceCodec
  if (typeof namespace !== 'string' || namespace.length === 0)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError('namespace must be non-empty and namespaceCodec must be callable')
    })
  if (bindOrganizations)
    resolveStorageNamespace(namespace, runtime.defaultOrgId, runtime.defaultOrgId)
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

  /** The original controller finalizer owns the one admitted native listener. */
  let releaseNativeEvents: (() => void) | undefined
  /** Private commit-after controller shared by direct and Host-created exact stores. */
  const controller = runtime.createChangeController({
    backend,
    platform: live,
    options: Object.freeze({ namespace, namespaceCodec }),
    finalize: () => releaseNativeEvents?.()
  })
  /** Explicit and language cleanup keep separate stable promises for the same controller cleanup. */
  let symbolicDispose: Promise<void> | undefined

  /** Publish only after the underlying Web Storage operation has returned successfully. */
  const publishChange = (change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>): void => {
    controller.publish({ ...change, orgId: runtime.defaultOrgId })
  }

  if (backend === StorageBackend.local)
    releaseNativeEvents = subscribeLocalStorageEvents(live, (event) => {
      if (controller.closingSignal.aborted) return
      try {
        if (event.storageArea !== live) return
        /** Native origin-wide clear invalidates every namespace; ordinary keys decode exactly. */
        const key = event.key
        if (key === null) publishChange({ channel: 'value', kind: 'clear' })
        else {
          const logical = stripStorageNamespace(namespace, key, namespaceCodec, backend)
          if (logical !== undefined)
            publishChange({
              channel: 'value',
              kind: event.newValue === null ? 'remove' : 'put',
              keys: [logical]
            })
        }
      } catch (cause) {
        reportCleanupError(
          createStorageOperationReporter(),
          normalizeStorageException(cause, backend)
        )
      }
    })
  /** A native source must actually register before the immutable capability can become true. */
  const capabilities = Object.freeze({
    ...CAPABILITIES,
    changeFeed: releaseNativeEvents !== undefined,
    transactions: redoEnabled,
    batch: redoEnabled
  })

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

  /** The exact native namespace supplies all draft inputs and prepared synchronous assignments. */
  const redo = createTextRedo({
    enabled: redoEnabled,
    backend,
    namespace,
    runtime,
    controller,
    read: (key) => live.getItem(namespacedStorageKey(namespace, key, namespaceCodec, backend)),
    keys: () => namespacedEntries().map(({ logicalKey }) => logicalKey),
    prepare: (key, value) => {
      const physical = namespacedStorageKey(namespace, key, namespaceCodec, backend)
      return {
        value,
        image: value,
        apply: () => {
          try {
            if (value === null) live.removeItem(physical)
            else live.setItem(physical, value)
          } catch (cause) {
            throw normalizeStorageException(cause, backend, key)
          }
        }
      }
    },
    replay: (key, value, present) => {
      const physical = namespacedStorageKey(namespace, key, namespaceCodec, backend)
      if (present && typeof value !== 'string')
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, { backend })
      return () => {
        try {
          if (!present) live.removeItem(physical)
          else live.setItem(physical, value as string)
        } catch (cause) {
          throw normalizeStorageException(cause, backend, key)
        }
      }
    },
    publish: (changes) => {
      if (changes.length)
        publishChange({
          channel: 'value',
          kind: 'batch',
          keys: changes.flatMap(({ target }) => (target.channel === 'text' ? [target.key] : []))
        })
    }
  })

  /** Entity preparation ends before this backend's original native snapshot/write boundary. */
  const commitValueWrite: IBackendValueCommit = async (input, ctx) => {
    /** Hold only the existing controller lease across intervention and native physical admission. */
    const release = controller.beginMutation()
    try {
      await runtime.execution.run(
        { operation: StorageOperation.entityUniqueWrite, input, ctx },
        (captured) =>
          redoEnabled
            ? redo.write([lockKey.text(captured.key)], ctx, async (scope) => {
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
                await scope.set(captured.key, captured.value)
              })
            : withAbort(ctx, async (signal, _context, operationRuntime) => {
                if (runtime.journal !== undefined) await runtime.journal.prepare()
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

  /** A fresh org prepares its selected observation inside the original native-read budget. */
  const plain = <R>(
    context: import('@migaia/storage-contract').IOperationContext | undefined,
    read: () => R
  ) =>
    withAbort(context, async () => {
      if (runtime.journal !== undefined) await runtime.journal.prepare()
      return read()
    })

  const store: ISyncCapableStore<IKeyValueStore> & ITextChangeFeedApi & ITextRedoStore = {
    backend,
    capabilities,
    sync,
    transaction: redo.transaction,
    tx: redo.tx,
    get: (key, ctx) =>
      redoEnabled ? redo.read(ctx, () => sync.get(key)) : plain(ctx, () => sync.get(key)),
    set: (key, value, ctx) =>
      redoEnabled
        ? redo.write([lockKey.text(key)], ctx, (scope) => scope.set(key, value))
        : plain(ctx, () => sync.set(key, value)),
    remove: (key, ctx) =>
      redoEnabled
        ? redo.write([lockKey.text(key)], ctx, (scope) => scope.remove(key))
        : plain(ctx, () => sync.remove(key)),
    has: (key, ctx) =>
      redoEnabled ? redo.read(ctx, () => sync.has(key)) : plain(ctx, () => sync.has(key)),
    keys: (ctx) =>
      redoEnabled ? redo.read(ctx, () => sync.keys()) : plain(ctx, () => sync.keys()),
    clearValues: (ctx) =>
      redoEnabled
        ? redo.clear(ctx)
        : withAbort(ctx, async (signal) => {
            if (runtime.journal !== undefined) await runtime.journal.prepare()
            assertLive()
            clearNamespacedEntries(clearValuesOperation, signal)
          }),
    clearAll: (ctx) =>
      redoEnabled
        ? redo.clear(ctx)
        : withAbort(ctx, async (signal) => {
            if (runtime.journal !== undefined) await runtime.journal.prepare()
            assertLive()
            clearNamespacedEntries(clearAllOperation, signal)
          }),
    watch: (key, ctx) => {
      assertLive()
      if (!capabilities.changeFeed)
        throw new StorageContractError(StorageContractErrorCode.unsupported, { backend })
      assertStringStorageKey(key, backend)
      return createBackendChangeIterator(controller, {
        orgId: runtime.defaultOrgId,
        channel: 'value',
        key,
        ctx,
        execute: (advance, context) =>
          runtime.execution.run(
            { operation: storageBackendOperation(backend, 'watch'), input: key, ctx: context },
            advance
          )
      })
    },
    subscribeChanges: (listener) => {
      assertLive()
      return controller.subscribe(listener)
    },
    dispose: () => {
      return controller.dispose()
    },
    [asyncDisposeKey]: () =>
      (symbolicDispose ??= store
        .dispose()
        .catch((error) => reportCleanupError(createStorageOperationReporter(), error)))
  }
  const construction = provideBackendConstruction(
    bindBrowserExecution(store, runtime, [], textExecutionKeys),
    [
      implement(
        kv,
        browserKeyValueApi(
          store,
          redoEnabled
            ? redo.batch
            : createTextBatchApi(
                backend,
                runtime,
                (): IStorageStore<never> => construction.store,
                assertLive,
                (keys) => {
                  assertLive()
                  /**
                   * Encode every requested key before the first read, including custom typed
                   * admission.
                   */
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
        ),
        redoEnabled ? { forTransaction: (scope) => scope } : undefined
      )
    ],
    controller,
    () => {
      if (redoEnabled)
        throw new StorageContractError(StorageContractErrorCode.unsupported, { backend })
      return live
    }
  )
  /** Keep native value commits attached to the same physical construction when borrowed by org. */
  redo.initialize(construction.store)
  const physical = { ...construction, commitValueWrite }
  const binding = redo.binding((orgId) => {
    const target = orgBinding?.resolve(orgId) ?? physical
    if (target === physical) return binding
    if (target.journalBinding === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    return target.journalBinding
  })
  const orgBinding = bindOrganizations
    ? createBrowserOrgBinding(
        runtime,
        namespace,
        { ...physical, journalBinding: binding },
        (target, ports) =>
          createWebStorageBackend(
            backend,
            live,
            { namespace: target, namespaceCodec, ...(redoEnabled ? { redo: true } : {}) },
            ports,
            false
          )
      )
    : undefined
  return {
    ...physical,
    journalBinding: binding,
    ...(orgBinding === undefined ? {} : { orgBinding })
  }
}

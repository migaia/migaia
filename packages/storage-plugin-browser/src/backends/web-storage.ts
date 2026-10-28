import {
  createBackendChangeIterator,
  createBackendChangeController,
  lockKey,
  snapshotSyncWriteOptions,
  resolveStorageNamespace,
  throwIfAborted,
  withAbort,
  reportCleanupError,
  createStorageOperationReporter,
  type IBackendValueCommit
} from '@migaia/storage-host/sdk'
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
  type IStorageStore
} from '@migaia/storage-contract'
import { createBrowserOrgBinding } from './organizations.js'
import {
  lengthPrefixedNamespaceCodec,
  namespacedKey,
  namespacedStorageKey,
  admitNamespaceCodec,
  stripStorageNamespace
} from '../utils/key.js'
import type { INamespaceCodec } from '../utils/key.js'
import { probeWebStorage } from '../utils/availability.js'
import { normalizeStorageException } from '../utils/quota.js'
import { StorageError, createStorageTypeError } from '../types/errors.js'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
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
  provideBackendConstruction,
  browserKeyValueApi,
  type IBackendConstruction,
  type IBackendRuntime,
  type IKeyValueBackendStore
} from './construction.js'

const CAPABILITIES: IStorageCapabilities = {
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
}

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
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      cause: new TypeError('web storage options must be an object')
    })
}

/** Validate an injected Storage surface from one observation of each member. */
const assertWebStorageInjection: (
  storage: IWebStorageLike | undefined,
  backend: IBackendKind
) => asserts storage is IWebStorageLike = (storage, backend) => {
  if (storage === undefined) return
  if (typeof storage !== 'object' || storage === null || Array.isArray(storage))
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend,
      cause: new TypeError('web storage injection must implement the Storage surface')
    })

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
      StorageBrowserErrorCode.invalidConfig,
      StorageErrorText.webStorageInjectionInvalid
    )
}

/**
 * Shares the backend implementation for localStorage and `sessionStorageHost` by injecting
 * different storage instances. Only the same Window's actual localStorage admits native events;
 * injected Storage-like ports retain ordinary KV without claiming a cross-document source.
 */
/** The physical namespace keeps its existing browser construction and client ports. */
type IWebStorageConstruction = IBackendConstruction<
  IKeyValueBackendStore<ISyncCapableStore<IKeyValueStore> & ITextChangeFeedApi & ITextRedoStore>,
  IWebStorageLike
>
/** One physical browser namespace owns its native port, change controller and redo assembly. */
type IWebStorageContext = {
  /** Original backend is captured before native construction begins. */
  readonly backend: IBackendKind
  /** Original storage is captured before native construction begins. */
  readonly storage: IWebStorageLike | undefined
  /** Original options is captured before native construction begins. */
  readonly options: IWebStorageOptions
  /** Original runtime is captured before native construction begins. */
  readonly runtime: IBackendRuntime
  /** Original bindOrganizations is captured before native construction begins. */
  readonly bindOrganizations: boolean

  /** Resolved physical namespace used by every key and organization projection. */
  namespace: string

  /** Whether this namespace selected the existing WAL-backed transaction path. */
  redoEnabled: boolean

  /** Configured codec before canonical admission selects its supported key domain. */
  namespaceCodecCandidate: INamespaceCodec

  /** Canonical key codec shared by synchronous, redo and organization operations. */
  namespaceCodec: INamespaceCodec

  /** Native availability failure retained for the original construction error. */
  probeCause: unknown

  /** Admitted native Storage receiver retained across all operations and cleanup. */
  live: IWebStorageLike

  /** The original controller finalizer owns the one admitted native listener. */
  releaseNativeEvents: (() => void) | undefined

  /** Private commit-after controller shared by direct and Host-created exact stores. */
  controller: ReturnType<IBackendRuntime['createChangeController']>

  /** Explicit and language cleanup keep separate stable promises for the same controller cleanup. */
  symbolicDispose: Promise<void> | undefined

  /** A native source must actually register before the immutable capability can become true. */
  capabilities: IStorageCapabilities

  /** Native diagnostics retain their original labels independently from the installed kind. */
  clearValuesOperation: string

  /** Complete namespace cleanup keeps the same public operation protocol. */
  clearAllOperation: string

  /** Native synchronous primitives reused by async operations without pipeline re-entry. */
  sync: ISyncKeyValueStore

  /** The exact native namespace supplies all draft inputs and prepared synchronous assignments. */
  redo: ReturnType<typeof createTextRedo>

  /** Exact private backend assembled before execution and provider publication. */
  store: ISyncCapableStore<IKeyValueStore> & ITextChangeFeedApi & ITextRedoStore

  /** One provided backend construction authenticating this physical namespace. */
  construction: IWebStorageConstruction

  /** Same physical construction plus the native entity commit port. */
  physical: IWebStorageConstruction & { readonly commitValueWrite: IBackendValueCommit }

  /** Journal binding resolving every organization through its original native owner. */
  binding: ReturnType<ReturnType<typeof createTextRedo>['binding']>

  /** Organization registry created only after the physical binding is available. */
  orgBinding: ReturnType<typeof createBrowserOrgBinding> | undefined
}
/** Construct one physical browser namespace with its original native and lifecycle ownership. */
export function createWebStorageBackend(
  backend: IBackendKind,
  storage: IWebStorageLike | undefined,
  options: IWebStorageOptions,
  runtime: IBackendRuntime,
  bindOrganizations = true
): IBackendConstruction<
  IKeyValueBackendStore<ISyncCapableStore<IKeyValueStore> & ITextChangeFeedApi & ITextRedoStore>,
  IWebStorageLike
> {
  /** Initialize native facts in original construction order before publishing any port. */
  const webStorageContext = {
    backend,
    storage,
    options,
    runtime,
    bindOrganizations
  } as IWebStorageContext

  configureWebStorageNamespace(webStorageContext)
  attachWebStorageSource(webStorageContext)
  return assembleWebStorageConstruction(webStorageContext)
}

/** Validate the physical key domain and admit the native Storage port before resource creation. */
function configureWebStorageNamespace(webStorageContext: IWebStorageContext): void {
  assertWebStorageOptions(webStorageContext.options)

  webStorageContext.namespace =
    webStorageContext.options.namespace === undefined
      ? 'default'
      : webStorageContext.options.namespace

  webStorageContext.redoEnabled = webStorageContext.options.redo === true

  if (webStorageContext.options.redo !== undefined && !webStorageContext.redoEnabled)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: webStorageContext.backend
    })

  webStorageContext.namespaceCodecCandidate =
    webStorageContext.options.namespaceCodec === undefined
      ? lengthPrefixedNamespaceCodec
      : webStorageContext.options.namespaceCodec

  if (typeof webStorageContext.namespace !== 'string' || webStorageContext.namespace.length === 0)
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: webStorageContext.backend,
      cause: new TypeError('namespace must be non-empty and namespaceCodec must be callable')
    })

  if (webStorageContext.bindOrganizations)
    resolveStorageNamespace(
      webStorageContext.namespace,
      webStorageContext.runtime.defaultOrgId,
      webStorageContext.runtime.defaultOrgId
    )

  webStorageContext.namespaceCodec = admitNamespaceCodec(
    webStorageContext.namespaceCodecCandidate,
    webStorageContext.backend
  )

  assertWebStorageInjection(webStorageContext.storage, webStorageContext.backend)

  if (
    !probeWebStorage(
      webStorageContext.storage,
      namespacedKey(
        webStorageContext.namespace,
        '__probe__',
        webStorageContext.namespaceCodec,
        webStorageContext.backend
      ),
      (cause) => {
        webStorageContext.probeCause = cause
      }
    )
  ) {
    throw new StorageError(StorageBrowserErrorCode.unavailable, {
      backend: webStorageContext.backend,
      cause: webStorageContext.probeCause
    })
  }

  webStorageContext.live = webStorageContext.storage as IWebStorageLike
}

/** Bind the existing change controller to its one native source and derive truthful capabilities. */
function attachWebStorageSource(webStorageContext: IWebStorageContext): void {
  /** Private commit-after controller shared by direct and Host-created exact stores. */
  webStorageContext.controller = webStorageContext.runtime.createChangeController(
    {
      backend: webStorageContext.backend,
      platform: webStorageContext.live,
      options: {
        namespace: webStorageContext.namespace,
        namespaceCodec: webStorageContext.namespaceCodec
      },
      finalize: () => webStorageContext.releaseNativeEvents?.()
    },
    createBackendChangeController
  )

  if (webStorageContext.backend === StorageBackend.local)
    webStorageContext.releaseNativeEvents = subscribeLocalStorageEvents(
      webStorageContext.live,
      (event) => {
        if (webStorageContext.controller.closingSignal.aborted) return
        try {
          if (event.storageArea !== webStorageContext.live) return
          /** Native origin-wide clear invalidates every namespace; ordinary keys decode exactly. */
          const key = event.key
          if (key === null) publishChange(webStorageContext, { channel: 'value', kind: 'clear' })
          else {
            const logical = stripStorageNamespace(
              webStorageContext.namespace,
              key,
              webStorageContext.namespaceCodec,
              webStorageContext.backend
            )
            if (logical !== undefined)
              publishChange(webStorageContext, {
                channel: 'value',
                kind: event.newValue === null ? 'remove' : 'put',
                keys: [logical]
              })
          }
        } catch (cause) {
          reportCleanupError(
            createStorageOperationReporter(),
            normalizeStorageException(cause, webStorageContext.backend)
          )
        }
      }
    )

  /** A native source must actually register before the immutable capability can become true. */
  webStorageContext.capabilities = {
    ...CAPABILITIES,
    changeFeed: webStorageContext.releaseNativeEvents !== undefined,
    transactions: webStorageContext.redoEnabled,
    batch: webStorageContext.redoEnabled
  }

  /** Native diagnostics retain their original labels independently from the installed kind. */
  webStorageContext.clearValuesOperation =
    webStorageContext.backend === StorageBackend.local
      ? StorageOperation.localClearValues
      : StorageOperation.sessionClearValues

  /** Complete namespace cleanup keeps the same public operation protocol. */
  webStorageContext.clearAllOperation =
    webStorageContext.backend === StorageBackend.local
      ? StorageOperation.localClearAll
      : StorageOperation.sessionClearAll
}

/** Publish native methods, redo and organization bindings after their original ports exist. */
function assembleWebStorageConstruction(
  webStorageContext: IWebStorageContext
): IWebStorageConstruction {
  webStorageContext.sync = createWebStorageSync(webStorageContext)
  webStorageContext.redo = createWebStorageRedo(webStorageContext)
  webStorageContext.store = createWebStorageStore(webStorageContext)
  webStorageContext.construction = createWebStorageConstruction(webStorageContext)

  /** Keep native value commits attached to the same physical construction when borrowed by org. */
  webStorageContext.redo.initialize(webStorageContext.construction.store)

  webStorageContext.physical = {
    ...webStorageContext.construction,
    commitValueWrite: (input, ctx) => commitValueWrite(webStorageContext, input, ctx)
  }

  webStorageContext.binding = webStorageContext.redo.binding((orgId) => {
    const target = webStorageContext.orgBinding?.resolve(orgId) ?? webStorageContext.physical
    if (target === webStorageContext.physical) return webStorageContext.binding
    if (target.journalBinding === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    return target.journalBinding
  })

  webStorageContext.orgBinding = webStorageContext.bindOrganizations
    ? createBrowserOrgBinding(
        webStorageContext.runtime,
        webStorageContext.namespace,
        { ...webStorageContext.physical, journalBinding: webStorageContext.binding },
        (target, ports) =>
          createWebStorageBackend(
            webStorageContext.backend,
            webStorageContext.live,
            {
              namespace: target,
              namespaceCodec: webStorageContext.namespaceCodec,
              ...(webStorageContext.redoEnabled ? { redo: true } : {})
            },
            ports,
            false
          )
      )
    : undefined
  return {
    ...webStorageContext.physical,
    journalBinding: webStorageContext.binding,
    ...(webStorageContext.orgBinding === undefined
      ? {}
      : { orgBinding: webStorageContext.orgBinding })
  }
}

/** Publish only after the underlying Web Storage operation has returned successfully. */
function publishChange(
  webStorageContext: IWebStorageContext,
  change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>
): void {
  webStorageContext.controller.publish({ ...change, orgId: webStorageContext.runtime.defaultOrgId })
}

function assertLive(webStorageContext: IWebStorageContext): void {
  webStorageContext.controller.assertLive()
}

function namespacedEntries(webStorageContext: IWebStorageContext): Array<{
  readonly physicalKey: string
  readonly logicalKey: IStorageKey
}> {
  const collected: ReturnType<typeof namespacedEntries> = []
  /** Detects a contract-violating or concurrently incoherent Storage enumeration. */
  const seenPhysicalKeys = new Set<string>()
  const length = webStorageContext.live.length
  if (!Number.isSafeInteger(length) || length < 0)
    throw createStorageTypeError(
      StorageBrowserErrorCode.unavailable,
      StorageErrorText.webStorageLengthInvalid
    )
  for (let index = 0; index < length; index += 1) {
    const rawKey = webStorageContext.live.key(index)
    if (typeof rawKey !== 'string')
      throw createStorageTypeError(
        StorageBrowserErrorCode.unavailable,
        StorageErrorText.webStorageKeyInvalid
      )
    if (seenPhysicalKeys.has(rawKey))
      throw createStorageTypeError(
        StorageBrowserErrorCode.unavailable,
        StorageErrorText.webStorageKeyDuplicate
      )
    seenPhysicalKeys.add(rawKey)
    const stripped = stripStorageNamespace(
      webStorageContext.namespace,
      rawKey,
      webStorageContext.namespaceCodec,
      webStorageContext.backend
    )
    if (stripped !== undefined) collected.push({ physicalKey: rawKey, logicalKey: stripped })
  }
  return collected
}

/** Delete a stable physical snapshot while reporting the exact partial-failure boundary. */
function clearNamespacedEntries(
  webStorageContext: IWebStorageContext,
  operation: string,
  signal?: AbortSignal
): void {
  let entries: ReturnType<typeof namespacedEntries>
  try {
    entries = namespacedEntries(webStorageContext)
  } catch (error) {
    throw normalizeStorageException(error, webStorageContext.backend, undefined, operation)
  }
  try {
    throwIfAborted(signal)
  } catch (error) {
    throw normalizeStorageException(error, webStorageContext.backend, undefined, operation)
  }
  for (const entry of entries) {
    try {
      throwIfAborted(signal)
      webStorageContext.live.removeItem(entry.physicalKey)
    } catch (error) {
      throw normalizeStorageException(error, webStorageContext.backend, entry.logicalKey, operation)
    }
  }
  if (entries.length > 0) publishChange(webStorageContext, { channel: 'value', kind: 'clear' })
}

/** Build synchronous text primitives against the admitted native Storage receiver. */
function createWebStorageSync(webStorageContext: IWebStorageContext): IWebStorageContext['sync'] {
  return {
    get: (key) => {
      assertLive(webStorageContext)
      try {
        return webStorageContext.live.getItem(
          namespacedKey(
            webStorageContext.namespace,
            key,
            webStorageContext.namespaceCodec,
            webStorageContext.backend
          )
        )
      } catch (error) {
        throw normalizeStorageException(error, webStorageContext.backend, key)
      }
    },
    set: (key, value, options) => {
      assertLive(webStorageContext)
      snapshotSyncWriteOptions(options)
      if (typeof value !== 'string')
        throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
          backend: webStorageContext.backend,
          key,
          cause: new TypeError('storage value must be a string')
        })
      try {
        webStorageContext.live.setItem(
          namespacedKey(
            webStorageContext.namespace,
            key,
            webStorageContext.namespaceCodec,
            webStorageContext.backend
          ),
          value
        )
        publishChange(webStorageContext, { channel: 'value', kind: 'put', keys: [key] })
      } catch (error) {
        throw normalizeStorageException(error, webStorageContext.backend, key)
      }
    },
    remove: (key) => {
      assertLive(webStorageContext)
      try {
        const physicalKey = namespacedKey(
          webStorageContext.namespace,
          key,
          webStorageContext.namespaceCodec,
          webStorageContext.backend
        )
        const existed = webStorageContext.live.getItem(physicalKey) !== null
        webStorageContext.live.removeItem(physicalKey)
        if (existed)
          publishChange(webStorageContext, { channel: 'value', kind: 'remove', keys: [key] })
      } catch (error) {
        throw normalizeStorageException(error, webStorageContext.backend, key)
      }
    },
    has: (key) => {
      assertLive(webStorageContext)
      try {
        return (
          webStorageContext.live.getItem(
            namespacedKey(
              webStorageContext.namespace,
              key,
              webStorageContext.namespaceCodec,
              webStorageContext.backend
            )
          ) !== null
        )
      } catch (error) {
        throw normalizeStorageException(error, webStorageContext.backend, key)
      }
    },
    keys: () => {
      assertLive(webStorageContext)
      try {
        return namespacedEntries(webStorageContext).flatMap((entry) =>
          typeof entry.logicalKey === 'string' ? [entry.logicalKey] : []
        )
      } catch (error) {
        throw normalizeStorageException(error, webStorageContext.backend)
      }
    },
    clearValues: () => {
      assertLive(webStorageContext)
      clearNamespacedEntries(webStorageContext, webStorageContext.clearValuesOperation)
    }
  }
}

/** The exact native namespace supplies all draft inputs and prepared synchronous assignments. */
/** Give the existing redo engine this namespace's native draft and replay operations. */
function createWebStorageRedo(webStorageContext: IWebStorageContext): IWebStorageContext['redo'] {
  return createTextRedo({
    enabled: webStorageContext.redoEnabled,
    backend: webStorageContext.backend,
    namespace: webStorageContext.namespace,
    runtime: webStorageContext.runtime,
    controller: webStorageContext.controller,
    read: (key) =>
      webStorageContext.live.getItem(
        namespacedStorageKey(
          webStorageContext.namespace,
          key,
          webStorageContext.namespaceCodec,
          webStorageContext.backend
        )
      ),
    keys: () => namespacedEntries(webStorageContext).map(({ logicalKey }) => logicalKey),
    prepare: (key, value) => {
      const physical = namespacedStorageKey(
        webStorageContext.namespace,
        key,
        webStorageContext.namespaceCodec,
        webStorageContext.backend
      )
      return {
        value,
        image: value,
        apply: () => {
          try {
            if (value === null) webStorageContext.live.removeItem(physical)
            else webStorageContext.live.setItem(physical, value)
          } catch (cause) {
            throw normalizeStorageException(cause, webStorageContext.backend, key)
          }
        }
      }
    },
    replay: (key, value, present) => {
      const physical = namespacedStorageKey(
        webStorageContext.namespace,
        key,
        webStorageContext.namespaceCodec,
        webStorageContext.backend
      )
      if (present && typeof value !== 'string')
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
          backend: webStorageContext.backend
        })
      return () => {
        try {
          if (!present) webStorageContext.live.removeItem(physical)
          else webStorageContext.live.setItem(physical, value as string)
        } catch (cause) {
          throw normalizeStorageException(cause, webStorageContext.backend, key)
        }
      }
    },
    publish: (changes) => {
      if (changes.length)
        publishChange(webStorageContext, {
          channel: 'value',
          kind: 'batch',
          keys: changes.flatMap(({ target }) => (target.channel === 'text' ? [target.key] : []))
        })
    }
  })
}

/** Entity preparation ends before this backend's original native snapshot/write boundary. */
async function commitValueWrite(
  webStorageContext: IWebStorageContext,
  input: Parameters<IBackendValueCommit>[0],
  ctx: Parameters<IBackendValueCommit>[1]
): Promise<void> {
  /** Hold only the existing controller lease across intervention and native physical admission. */
  const release = webStorageContext.controller.beginMutation()
  try {
    await webStorageContext.runtime.execution.run(
      { operation: StorageOperation.entityUniqueWrite, input, ctx },
      (captured) =>
        webStorageContext.redoEnabled
          ? webStorageContext.redo.write([lockKey.text(captured.key)], ctx, async (scope) => {
              const actual = namespacedEntries(webStorageContext).flatMap((entry) => {
                if (
                  typeof entry.logicalKey !== 'string' ||
                  !entry.logicalKey.startsWith(captured.prefix)
                )
                  return []
                const value = webStorageContext.live.getItem(entry.physicalKey)
                return value === null ? [] : [[entry.logicalKey, value] as const]
              })
              assertValueSnapshot(actual, captured.expected, webStorageContext.backend)
              await scope.set(captured.key, captured.value)
            })
          : withAbort(ctx, async (signal, _context, operationRuntime) => {
              if (webStorageContext.runtime.journal !== undefined)
                await webStorageContext.runtime.journal.prepare()
              await withNativeValueWrite(
                () => {
                  assertLive(webStorageContext)
                  /** Both reads and the private sync write execute without an intervening await. */
                  const actual = namespacedEntries(webStorageContext).flatMap((entry) => {
                    if (
                      typeof entry.logicalKey !== 'string' ||
                      !entry.logicalKey.startsWith(captured.prefix)
                    )
                      return []
                    const value = webStorageContext.live.getItem(entry.physicalKey)
                    return value === null ? [] : [[entry.logicalKey, value] as const]
                  })
                  assertValueSnapshot(actual, captured.expected, webStorageContext.backend)
                  webStorageContext.sync.set(captured.key, captured.value)
                },
                webStorageContext.backend,
                signal,
                operationRuntime,
                webStorageContext.controller.closingSignal
              )
            })
    )
  } finally {
    release()
  }
}

/** A fresh org prepares its selected observation inside the original native-read budget. */
function plain<R>(
  webStorageContext: IWebStorageContext,
  context: import('@migaia/storage-contract').IOperationContext | undefined,
  read: () => R
) {
  return withAbort(context, async () => {
    if (webStorageContext.runtime.journal !== undefined)
      await webStorageContext.runtime.journal.prepare()
    return read()
  })
}

/** Expose asynchronous text, change and disposal operations on the existing namespace. */
function createWebStorageStore(webStorageContext: IWebStorageContext): IWebStorageContext['store'] {
  return {
    backend: webStorageContext.backend,
    capabilities: webStorageContext.capabilities,
    sync: webStorageContext.sync,
    transaction: webStorageContext.redo.transaction,
    tx: webStorageContext.redo.tx,
    get: (key, ctx) =>
      webStorageContext.redoEnabled
        ? webStorageContext.redo.read(ctx, () => webStorageContext.sync.get(key))
        : plain(webStorageContext, ctx, () => webStorageContext.sync.get(key)),
    set: (key, value, ctx) =>
      webStorageContext.redoEnabled
        ? webStorageContext.redo.write([lockKey.text(key)], ctx, (scope) => scope.set(key, value))
        : plain(webStorageContext, ctx, () => webStorageContext.sync.set(key, value)),
    remove: (key, ctx) =>
      webStorageContext.redoEnabled
        ? webStorageContext.redo.write([lockKey.text(key)], ctx, (scope) => scope.remove(key))
        : plain(webStorageContext, ctx, () => webStorageContext.sync.remove(key)),
    has: (key, ctx) =>
      webStorageContext.redoEnabled
        ? webStorageContext.redo.read(ctx, () => webStorageContext.sync.has(key))
        : plain(webStorageContext, ctx, () => webStorageContext.sync.has(key)),
    keys: (ctx) =>
      webStorageContext.redoEnabled
        ? webStorageContext.redo.read(ctx, () => webStorageContext.sync.keys())
        : plain(webStorageContext, ctx, () => webStorageContext.sync.keys()),
    clearValues: (ctx) =>
      webStorageContext.redoEnabled
        ? webStorageContext.redo.clear(ctx)
        : withAbort(ctx, async (signal) => {
            if (webStorageContext.runtime.journal !== undefined)
              await webStorageContext.runtime.journal.prepare()
            assertLive(webStorageContext)
            clearNamespacedEntries(
              webStorageContext,
              webStorageContext.clearValuesOperation,
              signal
            )
          }),
    clearAll: (ctx) =>
      webStorageContext.redoEnabled
        ? webStorageContext.redo.clear(ctx)
        : withAbort(ctx, async (signal) => {
            if (webStorageContext.runtime.journal !== undefined)
              await webStorageContext.runtime.journal.prepare()
            assertLive(webStorageContext)
            clearNamespacedEntries(webStorageContext, webStorageContext.clearAllOperation, signal)
          }),
    watch: (key, ctx) => {
      assertLive(webStorageContext)
      if (!webStorageContext.capabilities.changeFeed)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: webStorageContext.backend
        })
      assertStringStorageKey(key, webStorageContext.backend)
      return createBackendChangeIterator(webStorageContext.controller, {
        orgId: webStorageContext.runtime.defaultOrgId,
        channel: 'value',
        key,
        ctx,
        execute: (advance, context) =>
          webStorageContext.runtime.execution.run(
            {
              operation: storageBackendOperation(webStorageContext.backend, 'watch'),
              input: key,
              ctx: context
            },
            advance
          )
      })
    },
    subscribeChanges: (listener) => {
      assertLive(webStorageContext)
      return webStorageContext.controller.subscribe(listener)
    },
    dispose: () => {
      return webStorageContext.controller.dispose()
    },
    [asyncDisposeKey]: () =>
      (webStorageContext.symbolicDispose ??= webStorageContext.store
        .dispose()
        .catch((error) => reportCleanupError(createStorageOperationReporter(), error)))
  }
}

/** Install execution and KV capability ports on this same private native backend. */
function createWebStorageConstruction(
  webStorageContext: IWebStorageContext
): IWebStorageContext['construction'] {
  webStorageContext.store = bindBrowserExecution(
    webStorageContext.store,
    webStorageContext.runtime,
    [],
    textExecutionKeys
  )
  return provideBackendConstruction(
    webStorageContext.store,
    [
      implement(
        kv,
        browserKeyValueApi(
          webStorageContext.store,
          webStorageContext.redoEnabled
            ? webStorageContext.redo.batch
            : createTextBatchApi(
                webStorageContext.backend,
                webStorageContext.runtime,
                (): IStorageStore<never> => webStorageContext.construction.store,
                () => assertLive(webStorageContext),
                (keys) => {
                  assertLive(webStorageContext)
                  /**
                   * Encode every requested key before the first read, including custom typed
                   * admission.
                   */
                  const physical = keys.map(({ key }) =>
                    namespacedStorageKey(
                      webStorageContext.namespace,
                      key,
                      webStorageContext.namespaceCodec,
                      webStorageContext.backend
                    )
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
                      values.push(webStorageContext.live.getItem(physical[index]!) ?? undefined)
                    } catch (cause) {
                      throw normalizeStorageException(cause, webStorageContext.backend, entry.key)
                    }
                  }
                  return values
                }
              )
        ),
        webStorageContext.redoEnabled ? { forTransaction: (scope) => scope } : undefined
      )
    ],
    webStorageContext.controller,
    () => {
      if (webStorageContext.redoEnabled)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: webStorageContext.backend
        })
      return webStorageContext.live
    }
  )
}

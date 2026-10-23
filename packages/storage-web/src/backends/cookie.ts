import { bindBrowserExecution } from './execution.js'
import { createBrowserOrgBinding } from './organizations.js'
import { resolveStorageNamespace } from '@migaia/storage-host/authoring/backend'
import { createTextBatchApi } from './batch.js'
import { implement, kv, type IStorageChange, type IStorageStore } from '@migaia/storage-contract'
import { snapshotOperationContext, snapshotSyncWriteOptions } from '@migaia/storage-contract'
import { throwIfAborted, withAbort } from '@migaia/storage-host/authoring/backend'
import {
  lengthPrefixedNamespaceCodec,
  namespacedKey,
  namespacedStorageKey,
  snapshotNamespaceCodec,
  stripStorageNamespace
} from '../utils/key.js'
import type { INamespaceCodec } from '../utils/key.js'
import {
  parseCookieEntries,
  serializeCookieAssignment,
  serializeCookieRemoval
} from '../utils/cookie-string.js'
import { StorageError, StorageErrorCode, createStorageTypeError } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import { normalizeStorageException } from '../utils/quota.js'
import { StorageBackend, StorageOperation } from '../constants.js'
import { assertValueSnapshot, withNativeValueWrite } from './native-value-write.js'
import type {
  ICookieRemoveContext,
  ICookieScope,
  ICookieStore,
  ICookieWriteContext,
  ISyncCookieStore
} from '../types/cookie.js'
import type { IStorageCapabilities } from '../types/capabilities.js'
import type { IOperationContext, IStorageKey } from '../types/context.js'
import type { ISyncCapableStore } from '../types/storage.js'
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
  maxValueBytes: 4096,
  // HttpOnly cookie 对 JS 不可见：has() 返回 false 不代表不存在，remove() 也不保证生效。
  opaqueEntries: true
})

/**
 * Minimal document surface borrowed by cookiesHost; reads and assignments must keep native cookie
 * semantics.
 */
export type ICookieDocument = {
  /** Native visible-cookie getter/assignment surface; the document remains borrowed. */ cookie: string
}

/**
 * Cookie namespace, fixed scope and borrowed document input; invalid attributes reject
 * construction.
 */
export type ICookiesOptions = {
  /** Prefixes keys to isolate instances and applications. Defaults to `default`. */
  readonly namespace?: string
  /** Customizes physical key encoding. Changing the codec changes the cookie persistence format. */
  readonly namespaceCodec?: INamespaceCodec
  /**
   * Optional fixed scope; omission emits no scope attributes. Writes and deletions reuse the
   * captured scope.
   */
  readonly scope?: ICookieScope
  /** Injects a document for testing. Defaults to `globalThis.document`. */
  readonly document?: ICookieDocument
}

type ICookieWriteContextSnapshot = ICookieWriteContext & {
  readonly pageSize?: number
  readonly conflictPolicy?: 'conflict' | 'replace'
  readonly lifecycle: ReturnType<typeof snapshotOperationContext>
}

/**
 * Run a Cookie async operation under the shared operation signal; invalid context 穿透为 contract
 * INVALID_ARGUMENT。
 */
const withCookieAbort = async <T>(
  context: IOperationContext | undefined,
  run: (signal: AbortSignal | undefined) => Promise<T>
): Promise<T> => {
  const lifecycle = snapshotOperationContext(context)
  return await withAbort(lifecycle, async (signal) => run(signal))
}

/** Snapshot lifecycle and cookie-specific write fields before cancellation or serialization. */
const snapshotCookieWriteContext = (
  context: ICookieWriteContext | undefined,
  key: string
): ICookieWriteContextSnapshot | undefined => {
  const lifecycle = snapshotOperationContext(context)
  if (context === undefined) return undefined
  let expires: unknown
  let maxAge: unknown
  try {
    expires = context.expires
    maxAge = context.maxAge
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      key,
      operation: StorageOperation.cookieSet,
      cause
    })
  }
  return {
    ...lifecycle,
    expires: expires as Date | undefined,
    maxAge: maxAge as number | undefined,
    lifecycle
  }
}

/** Snapshot and validate fixed cookie scope so later writes cannot observe getter changes. */
function snapshotCookieScope(scope: unknown): ICookieScope {
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie scope must be an object')
    })
  }
  const candidate = scope as Record<string, unknown>
  let path: unknown
  let domain: unknown
  let sameSite: unknown
  let secure: unknown
  let partitioned: unknown
  try {
    path = candidate.path
    domain = candidate.domain
    sameSite = candidate.sameSite
    secure = candidate.secure
    partitioned = candidate.partitioned
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause
    })
  }
  if (
    (path !== undefined &&
      (typeof path !== 'string' || !path.startsWith('/') || path.includes(';'))) ||
    (domain !== undefined && (typeof domain !== 'string' || !domain || /[;\s]/.test(domain))) ||
    (sameSite !== undefined && !['strict', 'lax', 'none'].includes(sameSite as string)) ||
    (secure !== undefined && typeof secure !== 'boolean') ||
    (partitioned !== undefined && typeof partitioned !== 'boolean')
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie scope contains an invalid attribute')
    })
  if (sameSite === 'none' && !secure)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('SameSite=None requires Secure')
    })
  if (partitioned && !secure)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('Partitioned requires Secure')
    })
  return {
    path: path as string | undefined,
    domain: domain as string | undefined,
    sameSite: sameSite as ICookieScope['sameSite'],
    secure: secure as boolean | undefined,
    partitioned: partitioned as boolean | undefined
  }
}

/**
 * Create a visible-cookie Store over the borrowed document.cookie surface. Namespace defaults to
 * default and the fixed scope applies to writes and removal; there is no server cookie integration.
 * Values are strings and the complete assignment is bounded to 4096 bytes. Browser rejection can
 * fail a write, while hidden HttpOnly or differently scoped cookies remain outside read/removal
 * guarantees. Dispose retires this Store without clearing the caller-owned document.
 */
export const cookiesHost = (
  options: ICookiesOptions,
  runtime: IBackendRuntime,
  bindOrganizations = true
): IBackendConstruction<
  IKeyValueBackendStore<ISyncCapableStore<ICookieStore>>,
  ICookieDocument
> => {
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie options must be an object')
    })
  let configuredNamespace: unknown
  let configuredNamespaceCodec: unknown
  let configuredScope: unknown
  let configuredDocument: unknown
  try {
    configuredNamespace = options.namespace
    configuredNamespaceCodec = options.namespaceCodec
    configuredScope = options.scope
    configuredDocument = options.document
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause
    })
  }
  const namespace = configuredNamespace === undefined ? 'default' : configuredNamespace
  const namespaceCodecCandidate =
    configuredNamespaceCodec === undefined ? lengthPrefixedNamespaceCodec : configuredNamespaceCodec
  if (typeof namespace !== 'string' || namespace.length === 0)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('namespace must be non-empty and namespaceCodec must be callable')
    })
  if (bindOrganizations)
    resolveStorageNamespace(namespace, runtime.defaultOrgId, runtime.defaultOrgId)
  const scope = snapshotCookieScope(configuredScope === undefined ? { path: '/' } : configuredScope)
  const documentCandidate =
    configuredDocument === undefined
      ? (globalThis as { document?: ICookieDocument }).document
      : configuredDocument
  if (documentCandidate === undefined)
    throw new StorageError(StorageErrorCode.unavailable, { backend: StorageBackend.cookie })
  if (
    typeof documentCandidate !== 'object' ||
    documentCandidate === null ||
    Array.isArray(documentCandidate)
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie document must expose a string cookie property')
    })
  let initialCookie: unknown
  try {
    initialCookie = (documentCandidate as ICookieDocument).cookie
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause
    })
  }
  if (typeof initialCookie !== 'string')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie document must expose a string cookie property')
    })
  const namespaceCodec = snapshotNamespaceCodec(namespaceCodecCandidate, StorageBackend.cookie)
  const doc = documentCandidate as ICookieDocument

  /** Private commit-after controller shared by direct and Host-created exact stores. */
  const controller = runtime.createChangeController({
    backend: StorageBackend.cookie,
    platform: doc,
    options: Object.freeze({ namespace, namespaceCodec, scope })
  })
  /** Symbol cleanup reports failure while explicit disposal retains the primary rejection. */
  let symbolicDispose: Promise<void> | undefined

  /** Publish only after a visible cookie mutation has completed successfully. */
  const publishChange = (change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>): void => {
    controller.publish({ ...change, orgId: runtime.defaultOrgId })
  }

  /** Read the live cookie jar while preserving host failures in the storage error protocol. */
  const readCookie = (operation: string, key?: IStorageKey): string => {
    try {
      const value: unknown = doc.cookie
      if (typeof value !== 'string')
        throw createStorageTypeError(
          StorageErrorCode.unavailable,
          StorageErrorText.cookieDocumentBecameInvalid
        )
      return value
    } catch (cause) {
      throw new StorageError(StorageErrorCode.unavailable, {
        backend: StorageBackend.cookie,
        key,
        operation,
        cause
      })
    }
  }

  /** Write the live cookie jar while preserving host failures in the storage error protocol. */
  const writeCookie = (value: string, operation: string, key?: IStorageKey): void => {
    try {
      doc.cookie = value
    } catch (cause) {
      throw new StorageError(StorageErrorCode.writeFailed, {
        backend: StorageBackend.cookie,
        key,
        operation,
        cause
      })
    }
  }

  const assertLive = (): void => {
    controller.assertLive()
  }

  const namespacedEntries = (
    operation = 'cookie.keys'
  ): Array<{
    readonly physicalKey: string
    readonly logicalKey: IStorageKey
  }> => {
    const collected: ReturnType<typeof namespacedEntries> = []
    /** Repeated visible names prove that document.cookie cannot identify their scopes. */
    const seenPhysicalKeys = new Set<string>()
    for (const [rawKey] of parseCookieEntries(readCookie(operation))) {
      const stripped = stripStorageNamespace(
        namespace,
        rawKey,
        namespaceCodec,
        StorageBackend.cookie
      )
      if (stripped === undefined) continue
      if (seenPhysicalKeys.has(rawKey))
        throw new StorageError(StorageErrorCode.cookieScopeAmbiguous, {
          backend: StorageBackend.cookie,
          key: stripped,
          operation,
          cause: new Error('multiple visible cookiesHost share one physical name')
        })
      seenPhysicalKeys.add(rawKey)
      collected.push({ physicalKey: rawKey, logicalKey: stripped })
    }
    return collected
  }

  /** Read one physical cookie only when its visible scope is unambiguous. */
  const readVisibleCookie = (
    physicalKey: string,
    operation: string,
    logicalKey: IStorageKey
  ): string | undefined => {
    let visible: string | undefined
    let matches = 0
    for (const [name, value] of parseCookieEntries(readCookie(operation, logicalKey))) {
      if (name !== physicalKey) continue
      matches += 1
      visible = value
    }
    if (matches > 1)
      throw new StorageError(StorageErrorCode.cookieScopeAmbiguous, {
        backend: StorageBackend.cookie,
        key: logicalKey,
        operation,
        cause: new Error('multiple visible cookiesHost share one physical name')
      })
    return visible
  }

  /** Delete a stable cookie-name snapshot while exposing the exact partial-failure boundary. */
  const clearNamespacedEntries = (operation: string, signal?: AbortSignal): void => {
    const entries = namespacedEntries(operation)
    try {
      throwIfAborted(signal)
    } catch (error) {
      throw normalizeStorageException(error, StorageBackend.cookie, undefined, operation)
    }
    for (const entry of entries) {
      try {
        throwIfAborted(signal)
      } catch (error) {
        throw normalizeStorageException(error, StorageBackend.cookie, entry.logicalKey, operation)
      }
      writeCookie(serializeCookieRemoval(entry.physicalKey, scope), operation, entry.logicalKey)
    }
    if (entries.length > 0) publishChange({ channel: 'value', kind: 'clear' })
  }

  const sync: ISyncCookieStore = {
    get: (key) => {
      assertLive()
      return (
        readVisibleCookie(
          namespacedKey(namespace, key, namespaceCodec, StorageBackend.cookie),
          'cookie.get',
          key
        ) ?? null
      )
    },
    set: (key, value, ctx) => {
      assertLive()
      const context = snapshotCookieWriteContext(ctx, key)
      snapshotSyncWriteOptions(context)
      if (typeof value !== 'string')
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.cookie,
          key,
          cause: new TypeError('cookie value must be a string')
        })
      const physicalKey = namespacedKey(namespace, key, namespaceCodec, StorageBackend.cookie)
      /** Snapshot mutable/getter-backed context fields before validation and serialization. */
      const maxAge = context?.maxAge
      const expires = context?.expires
      if (maxAge !== undefined && !Number.isSafeInteger(maxAge))
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.cookie,
          key,
          cause: new RangeError('cookie maxAge must be a safe integer')
        })
      if (expires !== undefined && (typeof expires !== 'object' || expires === null))
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.cookie,
          key,
          cause: new RangeError('cookie expires must be a valid Date')
        })
      /** Read a Date-like value once so validation and serialization cannot observe different times. */
      let expiresTime: number | undefined
      try {
        expiresTime =
          expires === undefined
            ? undefined
            : ((expires as { getTime(): unknown }).getTime() as number)
      } catch (cause) {
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.cookie,
          key,
          cause
        })
      }
      if (expiresTime !== undefined && !Number.isFinite(expiresTime))
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.cookie,
          key,
          cause: new RangeError('cookie expires must be a valid Date')
        })
      const expiresNow =
        maxAge !== undefined ? maxAge <= 0 : expiresTime !== undefined && expiresTime <= Date.now()
      const visibleBefore = readVisibleCookie(physicalKey, StorageOperation.cookieSet, key)
      writeCookie(
        expiresNow
          ? serializeCookieRemoval(physicalKey, scope)
          : serializeCookieAssignment(physicalKey, value, {
              ...scope,
              expires: expiresTime === undefined ? undefined : new Date(expiresTime),
              maxAge
            }),
        StorageOperation.cookieSet,
        key
      )
      const visible = readVisibleCookie(physicalKey, StorageOperation.cookieSet, key)
      if (expiresNow && visible === undefined) {
        if (visibleBefore !== undefined)
          publishChange({ channel: 'value', kind: 'remove', keys: [key] })
        return
      }
      if (!expiresNow && visible === value) {
        publishChange({ channel: 'value', kind: 'put', keys: [key] })
        return
      }
      if (visible !== undefined)
        throw new StorageError(StorageErrorCode.cookieScopeAmbiguous, {
          backend: StorageBackend.cookie,
          key,
          operation: StorageOperation.cookieSet,
          cause: new Error('same cookie name remains visible from an unknown scope')
        })
      throw new StorageError(StorageErrorCode.writeFailed, {
        backend: StorageBackend.cookie,
        key,
        operation: StorageOperation.cookieSet,
        cause: new Error('cookie write was not visible in the active scope')
      })
    },
    remove: (key) => {
      assertLive()
      const physicalKey = namespacedKey(namespace, key, namespaceCodec, StorageBackend.cookie)
      const visible = readVisibleCookie(physicalKey, StorageOperation.cookieRemove, key)
      writeCookie(serializeCookieRemoval(physicalKey, scope), StorageOperation.cookieRemove, key)
      if (visible !== undefined) publishChange({ channel: 'value', kind: 'remove', keys: [key] })
    },
    has: (key) => {
      assertLive()
      return (
        readVisibleCookie(
          namespacedKey(namespace, key, namespaceCodec, StorageBackend.cookie),
          'cookie.has',
          key
        ) !== undefined
      )
    },
    keys: () => {
      assertLive()
      return namespacedEntries().flatMap((entry) =>
        typeof entry.logicalKey === 'string' ? [entry.logicalKey] : []
      )
    },
    clearValues: () => {
      assertLive()
      clearNamespacedEntries('cookie.clearValues')
    }
  }

  /** Cookie entities retain their fixed scope and the original visibility/quota checks. */
  const commitValueWrite: IBackendValueCommit = async (input, ctx) => {
    const release = controller.beginMutation()
    try {
      await runtime.execution.run(
        { operation: StorageOperation.entityUniqueWrite, input, ctx },
        (captured) =>
          withAbort(ctx, async (signal, _context, operationRuntime) => {
            await withNativeValueWrite(
              () => {
                assertLive()
                /**
                 * Snapshot verification and the original private native write share one synchronous
                 * turn.
                 */
                const actual = namespacedEntries(StorageOperation.entityUniqueWrite).flatMap(
                  (entry) => {
                    if (
                      typeof entry.logicalKey !== 'string' ||
                      !entry.logicalKey.startsWith(captured.prefix)
                    )
                      return []
                    const value = readVisibleCookie(
                      entry.physicalKey,
                      StorageOperation.entityUniqueWrite,
                      entry.logicalKey
                    )
                    return value === undefined ? [] : [[entry.logicalKey, value] as const]
                  }
                )
                assertValueSnapshot(actual, captured.expected, StorageBackend.cookie)
                sync.set(captured.key, captured.value)
              },
              StorageBackend.cookie,
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

  const store: ISyncCapableStore<ICookieStore> = {
    backend: StorageBackend.cookie,
    capabilities: CAPABILITIES,
    sync,
    get: (key, ctx) => withCookieAbort(ctx, async () => sync.get(key)),
    set: async (key, value, ctx?: ICookieWriteContext) => {
      const context = snapshotCookieWriteContext(ctx, key)
      await withAbort(context?.lifecycle, async () =>
        sync.set(key, value, {
          expires: context?.expires,
          maxAge: context?.maxAge
        })
      )
    },
    remove: (key, ctx?: ICookieRemoveContext) => withCookieAbort(ctx, async () => sync.remove(key)),
    has: (key, ctx) => withCookieAbort(ctx, async () => sync.has(key)),
    keys: (ctx) => withCookieAbort(ctx, async () => sync.keys()),
    clearValues: (ctx) =>
      withCookieAbort(ctx, async (signal) => {
        assertLive()
        clearNamespacedEntries('cookie.clearValues', signal)
      }),
    clearAll: (ctx) =>
      withCookieAbort(ctx, async (signal) => {
        assertLive()
        clearNamespacedEntries('cookie.clearAll', signal)
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
            StorageBackend.cookie,
            runtime,
            (): IStorageStore<never> => construction.store,
            assertLive,
            (keys, operation) => {
              assertLive()
              /** Typed codec admission completes before reading the visible cookie snapshot. */
              const physical = keys.map(({ key }) =>
                namespacedStorageKey(namespace, key, namespaceCodec, StorageBackend.cookie)
              )
              /** One header snapshot supplies all requested results without per-key public reads. */
              const visible = new Map<string, string>()
              /** Duplicate visible names retain the original fixed-scope ambiguity failure. */
              const ambiguous = new Set<string>()
              for (const [key, value] of parseCookieEntries(readCookie(operation))) {
                if (visible.has(key)) ambiguous.add(key)
                visible.set(key, value)
              }
              /** Canonical duplicate positions reuse the first result from this one header. */
              const values: (string | undefined)[] = []
              for (let index = 0; index < keys.length; index += 1) {
                const entry = keys[index]!
                if (entry.firstIndex !== index) {
                  values.push(values[entry.firstIndex])
                  continue
                }
                const key = physical[index]!
                if (ambiguous.has(key))
                  throw new StorageError(StorageErrorCode.cookieScopeAmbiguous, {
                    backend: StorageBackend.cookie,
                    key: entry.key,
                    operation
                  })
                values.push(visible.get(key))
              }
              return values
            }
          )
        )
      )
    ],
    controller,
    () => doc
  )
  /** The fixed cookie scope and native atomic writer remain on this same physical construction. */
  const physical = { ...construction, commitValueWrite }
  return {
    ...physical,
    ...(bindOrganizations
      ? {
          orgBinding: createBrowserOrgBinding(runtime, namespace, physical, (target, ports) =>
            cookiesHost({ namespace: target, namespaceCodec, scope, document: doc }, ports, false)
          )
        }
      : {})
  }
}

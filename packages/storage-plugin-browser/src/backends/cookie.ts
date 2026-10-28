import {
  createBackendChangeController,
  resolveStorageNamespace,
  lockKey,
  snapshotStorageBatchKeys,
  snapshotOperationContext,
  throwIfAborted,
  withAbort,
  reportCleanupError,
  createStorageOperationReporter,
  type IBackendValueCommit
} from '@migaia/storage-host/sdk'
import { createTextRedo, type ITextRedoStore } from './text-redo.js'
import { bindBrowserExecution, textExecutionKeys } from './execution.js'
import { createBrowserOrgBinding } from './organizations.js'
import { createTextBatchApi, BrowserBatchMethod } from './batch.js'
import {
  implement,
  kv,
  StorageContractError,
  StorageContractErrorCode,
  type IStorageChange,
  type IStorageStore
} from '@migaia/storage-contract'
import {
  lengthPrefixedNamespaceCodec,
  namespacedStorageKey,
  admitNamespaceCodec,
  stripStorageNamespace
} from '../utils/key.js'
import type { INamespaceCodec } from '../utils/key.js'
import { parseCookieEntries, serializeCookieRemoval } from '../utils/cookie-string.js'
import { StorageError, createStorageTypeError } from '../types/errors.js'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import { normalizeStorageException } from '../utils/quota.js'
import { StorageBackend, StorageOperation, storageBackendOperation } from '../constants.js'
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
  provideBackendConstruction,
  browserKeyValueApi,
  type IBackendConstruction,
  type IBackendRuntime,
  type IKeyValueBackendStore
} from './construction.js'
import { createCookieSync, prepareCookie } from './cookie-sync.js'

const CAPABILITIES: IStorageCapabilities = {
  batch: false,
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
}

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
  /** Explicitly select the original WAL-backed visible-cookie draft. */
  readonly redo?: true
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

/** Own mutable write options across journal preparation before native serialization begins. */
const snapshotCookieWriteContext = (
  context: ICookieWriteContext | undefined
): ICookieWriteContextSnapshot | undefined => {
  const lifecycle = snapshotOperationContext(context)
  if (context === undefined) return undefined
  return {
    ...lifecycle,
    expires: context.expires,
    maxAge: context.maxAge,
    lifecycle
  }
}

/**
 * Own fixed scope attributes across awaited writes so later caller mutation cannot retarget
 * deletion.
 */
function snapshotCookieScope(scope: unknown): ICookieScope {
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie scope must be an object')
    })
  }
  const candidate = scope as Record<string, unknown>
  const { path, domain, sameSite, secure, partitioned } = candidate
  if (
    (path !== undefined &&
      (typeof path !== 'string' || !path.startsWith('/') || path.includes(';'))) ||
    (domain !== undefined && (typeof domain !== 'string' || !domain || /[;\s]/.test(domain))) ||
    (sameSite !== undefined && !['strict', 'lax', 'none'].includes(sameSite as string)) ||
    (secure !== undefined && typeof secure !== 'boolean') ||
    (partitioned !== undefined && typeof partitioned !== 'boolean')
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie scope contains an invalid attribute')
    })
  if (sameSite === 'none' && !secure)
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('SameSite=None requires Secure')
    })
  if (partitioned && !secure)
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
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
/** Physical cookie construction retains its borrowed native document and redo ports. */
type ICookieConstruction = IBackendConstruction<
  IKeyValueBackendStore<ISyncCapableStore<ICookieStore> & ITextRedoStore>,
  ICookieDocument
>
/** A cookie namespace owns its fixed physical scope, native document and redo assembly. */
export type ICookieContext = {
  /** Original options is captured before native construction begins. */
  readonly options: ICookiesOptions
  /** Original runtime is captured before native construction begins. */
  readonly runtime: IBackendRuntime
  /** Original bindOrganizations is captured before native construction begins. */
  readonly bindOrganizations: boolean

  /** Whether the namespace selects its existing WAL-backed transaction path. */
  redoEnabled: boolean

  /** Physical namespace shared by native cookie names and organization views. */
  namespace: string

  /** Detached fixed cookie attributes retained across asynchronous writes and removals. */
  scope: ICookieScope

  /** Original admitted codec receiver used by all physical key operations. */
  namespaceCodec: INamespaceCodec

  /** Borrowed native document whose cookie access retains browser policy failures. */
  doc: ICookieDocument

  /** Private commit-after controller shared by direct and Host-created exact stores. */
  controller: ReturnType<IBackendRuntime['createChangeController']>

  /** Symbol cleanup reports failure while explicit disposal retains the primary rejection. */
  symbolicDispose: Promise<void> | undefined

  /** Synchronous native cookie primitives reused by asynchronous paths. */
  sync: ISyncCookieStore

  /** Cookie replay preserves the fixed native scope and absolute expiry, without renewing Max-Age. */
  redo: ReturnType<typeof createTextRedo>

  /** Private cookie backend before execution and provider publication. */
  store: ISyncCapableStore<ICookieStore> & ITextRedoStore

  /** Provided physical namespace and its original native client resolver. */
  construction: ICookieConstruction

  /** Same native construction carrying the entity commit port. */
  physical: ICookieConstruction & { readonly commitValueWrite: IBackendValueCommit }

  /** Journal binding resolving each organization through the same native owner. */
  binding: ReturnType<ReturnType<typeof createTextRedo>['binding']>

  /** Organization registry published after the physical construction exists. */
  orgBinding: ReturnType<typeof createBrowserOrgBinding> | undefined
}
/** Construct one fixed-scope visible-cookie namespace with its original native lifecycle. */
export function cookiesHost(
  options: ICookiesOptions,
  runtime: IBackendRuntime,
  bindOrganizations = true
): IBackendConstruction<
  IKeyValueBackendStore<ISyncCapableStore<ICookieStore> & ITextRedoStore>,
  ICookieDocument
> {
  /** Initialize native facts in original construction order before publishing any port. */
  const cookieContext = { options, runtime, bindOrganizations } as ICookieContext

  configureCookieNamespace(cookieContext)

  /** Private commit-after controller shared by direct and Host-created exact stores. */
  cookieContext.controller = cookieContext.runtime.createChangeController(
    {
      backend: StorageBackend.cookie,
      platform: cookieContext.doc,
      options: {
        namespace: cookieContext.namespace,
        namespaceCodec: cookieContext.namespaceCodec,
        scope: cookieContext.scope
      }
    },
    createBackendChangeController
  )
  return assembleCookieConstruction(cookieContext)
}

/** Admit the physical cookie namespace, fixed scope and borrowed native document. */
function configureCookieNamespace(cookieContext: ICookieContext): void {
  /** Constructor admission consumes fields synchronously; native state below owns later work. */
  const options = cookieContext.options
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie options must be an object')
    })
  /** Physical identity is selected before native resources are acquired. */
  const namespace = options.namespace === undefined ? 'default' : options.namespace
  cookieContext.redoEnabled = options.redo === true
  if (options.redo !== undefined && !cookieContext.redoEnabled)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: StorageBackend.cookie
    })
  if (typeof namespace !== 'string' || namespace.length === 0)
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('namespace must be non-empty and namespaceCodec must be callable')
    })
  cookieContext.namespace = namespace
  if (cookieContext.bindOrganizations)
    resolveStorageNamespace(
      namespace,
      cookieContext.runtime.defaultOrgId,
      cookieContext.runtime.defaultOrgId
    )
  cookieContext.scope = snapshotCookieScope(
    options.scope === undefined ? { path: '/' } : options.scope
  )
  /** Browser policy can refuse the native cookie surface; the original failure remains coded. */
  const documentCandidate =
    options.document === undefined
      ? (globalThis as { document?: ICookieDocument }).document
      : options.document
  if (documentCandidate === undefined)
    throw new StorageError(StorageBrowserErrorCode.unavailable, { backend: StorageBackend.cookie })
  if (
    typeof documentCandidate !== 'object' ||
    documentCandidate === null ||
    Array.isArray(documentCandidate)
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie document must expose a string cookie property')
    })
  /** Read the native surface before codec admission, preserving original construction order. */
  let initialCookie: unknown
  try {
    initialCookie = documentCandidate.cookie
  } catch (cause) {
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause
    })
  }
  if (typeof initialCookie !== 'string')
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie document must expose a string cookie property')
    })
  cookieContext.namespaceCodec = admitNamespaceCodec(
    options.namespaceCodec === undefined ? lengthPrefixedNamespaceCodec : options.namespaceCodec,
    StorageBackend.cookie
  )
  cookieContext.doc = documentCandidate
}

/** Publish native methods, redo and organization ports after their original owners exist. */
function assembleCookieConstruction(cookieContext: ICookieContext): ICookieConstruction {
  cookieContext.sync = createCookieSync(cookieContext)
  cookieContext.redo = createCookieRedo(cookieContext)
  cookieContext.store = createCookieStore(cookieContext)

  cookieContext.store = bindBrowserExecution(
    cookieContext.store,
    cookieContext.runtime,
    [],
    textExecutionKeys
  )
  cookieContext.construction = provideBackendConstruction(
    cookieContext.store,
    [
      implement(
        kv,
        browserKeyValueApi(
          cookieContext.store,
          cookieContext.redoEnabled
            ? cookieContext.redo.batch
            : createTextBatchApi(
                StorageBackend.cookie,
                cookieContext.runtime,
                (): IStorageStore<never> => cookieContext.construction.store,
                () => assertLive(cookieContext),
                (
                  keys: readonly import('@migaia/storage-contract').IStorageBatchKey[],
                  operation: string
                ) => readCookieBatch(cookieContext, keys, operation)
              )
        ),
        cookieContext.redoEnabled ? { forTransaction: (scope) => scope } : undefined
      )
    ],
    cookieContext.controller,
    () => {
      if (cookieContext.redoEnabled)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: StorageBackend.cookie
        })
      return cookieContext.doc
    }
  )

  /** The fixed cookie scope and native atomic writer remain on this same physical construction. */
  cookieContext.redo.initialize(cookieContext.construction.store)

  cookieContext.physical = {
    ...cookieContext.construction,
    commitValueWrite: (input, ctx) => commitValueWrite(cookieContext, input, ctx)
  }

  cookieContext.binding = cookieContext.redo.binding((orgId) => {
    const target = cookieContext.orgBinding?.resolve(orgId) ?? cookieContext.physical
    if (target === cookieContext.physical) return cookieContext.binding
    if (target.journalBinding === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    return target.journalBinding
  })

  cookieContext.orgBinding = cookieContext.bindOrganizations
    ? createBrowserOrgBinding(
        cookieContext.runtime,
        cookieContext.namespace,
        { ...cookieContext.physical, journalBinding: cookieContext.binding },
        (target, ports) =>
          cookiesHost(
            {
              namespace: target,
              namespaceCodec: cookieContext.namespaceCodec,
              scope: cookieContext.scope,
              document: cookieContext.doc,
              ...(cookieContext.redoEnabled ? { redo: true } : {})
            },
            ports,
            false
          )
      )
    : undefined
  return {
    ...cookieContext.physical,
    journalBinding: cookieContext.binding,
    ...(cookieContext.orgBinding === undefined ? {} : { orgBinding: cookieContext.orgBinding })
  }
}

/** Publish only after a visible cookie mutation has completed successfully. */
export function publishChange(
  cookieContext: ICookieContext,
  change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>
): void {
  cookieContext.controller.publish({ ...change, orgId: cookieContext.runtime.defaultOrgId })
}

/** Read the live cookie jar while preserving host failures in the storage error protocol. */
function readCookie(cookieContext: ICookieContext, operation: string, key?: IStorageKey): string {
  try {
    const value: unknown = cookieContext.doc.cookie
    if (typeof value !== 'string')
      throw createStorageTypeError(
        StorageBrowserErrorCode.unavailable,
        StorageErrorText.cookieDocumentBecameInvalid
      )
    return value
  } catch (cause) {
    throw new StorageError(StorageBrowserErrorCode.unavailable, {
      backend: StorageBackend.cookie,
      key,
      operation,
      cause
    })
  }
}

/** Write the live cookie jar while preserving host failures in the storage error protocol. */
export function writeCookie(
  cookieContext: ICookieContext,
  value: string,
  operation: string,
  key?: IStorageKey
): void {
  try {
    cookieContext.doc.cookie = value
  } catch (cause) {
    throw new StorageError(StorageBrowserErrorCode.writeFailed, {
      backend: StorageBackend.cookie,
      key,
      operation,
      cause
    })
  }
}

export function assertLive(cookieContext: ICookieContext): void {
  cookieContext.controller.assertLive()
}

export function namespacedEntries(
  cookieContext: ICookieContext,
  operation = 'cookie.keys'
): Array<{
  readonly physicalKey: string
  readonly logicalKey: IStorageKey
}> {
  const collected: ReturnType<typeof namespacedEntries> = []
  /** Repeated visible names prove that document.cookie cannot identify their scopes. */
  const seenPhysicalKeys = new Set<string>()
  for (const [rawKey] of parseCookieEntries(readCookie(cookieContext, operation))) {
    const stripped = stripStorageNamespace(
      cookieContext.namespace,
      rawKey,
      cookieContext.namespaceCodec,
      StorageBackend.cookie
    )
    if (stripped === undefined) continue
    if (seenPhysicalKeys.has(rawKey))
      throw new StorageError(StorageBrowserErrorCode.cookieScopeAmbiguous, {
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
export function readVisibleCookie(
  cookieContext: ICookieContext,
  physicalKey: string,
  operation: string,
  logicalKey: IStorageKey
): string | undefined {
  let visible: string | undefined
  let matches = 0
  for (const [name, value] of parseCookieEntries(
    readCookie(cookieContext, operation, logicalKey)
  )) {
    if (name !== physicalKey) continue
    matches += 1
    visible = value
  }
  if (matches > 1)
    throw new StorageError(StorageBrowserErrorCode.cookieScopeAmbiguous, {
      backend: StorageBackend.cookie,
      key: logicalKey,
      operation,
      cause: new Error('multiple visible cookiesHost share one physical name')
    })
  return visible
}

/** Delete a stable cookie-name snapshot while exposing the exact partial-failure boundary. */
export function clearNamespacedEntries(
  cookieContext: ICookieContext,
  operation: string,
  signal?: AbortSignal
): void {
  const entries = namespacedEntries(cookieContext, operation)
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
    writeCookie(
      cookieContext,
      serializeCookieRemoval(entry.physicalKey, cookieContext.scope),
      operation,
      entry.logicalKey
    )
  }
  if (entries.length > 0) publishChange(cookieContext, { channel: 'value', kind: 'clear' })
}

/** One native header snapshot supplies ordinary and redo batch reads through the same parser. */
function readCookieBatch(
  cookieContext: ICookieContext,
  keys: readonly import('@migaia/storage-contract').IStorageBatchKey[],
  operation: string
): readonly (string | undefined)[] {
  assertLive(cookieContext)
  /** Typed codec admission completes before reading the visible cookie snapshot. */
  const physical = keys.map(({ key }) =>
    namespacedStorageKey(
      cookieContext.namespace,
      key,
      cookieContext.namespaceCodec,
      StorageBackend.cookie
    )
  )
  /** One header snapshot supplies all requested results without per-key public reads. */
  const visible = new Map<string, string>()
  /** Duplicate visible names retain the original fixed-scope ambiguity failure. */
  const ambiguous = new Set<string>()
  for (const [key, value] of parseCookieEntries(readCookie(cookieContext, operation))) {
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
      throw new StorageError(StorageBrowserErrorCode.cookieScopeAmbiguous, {
        backend: StorageBackend.cookie,
        key: entry.key,
        operation
      })
    values.push(visible.get(key))
  }
  return values
}

/** Cookie replay preserves the fixed native scope and absolute expiry, without renewing Max-Age. */
/** Supply the existing redo owner with fixed-scope native preparation and replay. */
function createCookieRedo(cookieContext: ICookieContext): ICookieContext['redo'] {
  return createTextRedo({
    enabled: cookieContext.redoEnabled,
    backend: StorageBackend.cookie,
    namespace: cookieContext.namespace,
    runtime: cookieContext.runtime,
    controller: cookieContext.controller,
    read: (key) =>
      readVisibleCookie(
        cookieContext,
        namespacedStorageKey(
          cookieContext.namespace,
          key,
          cookieContext.namespaceCodec,
          StorageBackend.cookie
        ),
        'cookie.get',
        key
      ) ?? null,
    readMany: (keys) =>
      keys.length === 0
        ? []
        : readCookieBatch(
            cookieContext,
            snapshotStorageBatchKeys(keys, StorageBackend.cookie),
            storageBackendOperation(StorageBackend.cookie, BrowserBatchMethod.getMany)
          ),
    keys: () => namespacedEntries(cookieContext).map(({ logicalKey }) => logicalKey),
    prepare: (key, value) =>
      prepareCookie(cookieContext, key, value, undefined, {
        notify: false,
        durable: true,
        remove: true
      }),
    replay: (key, image, present) => {
      if (!present)
        return prepareCookie(cookieContext, key, null, undefined, {
          notify: false,
          durable: true,
          remove: true
        }).apply
      if (typeof image !== 'object' || image === null || Array.isArray(image))
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      const value: unknown = Reflect.get(image, 'value')
      const expiresAt: unknown = Reflect.get(image, 'expiresAt')
      if (
        typeof value !== 'string' ||
        (expiresAt !== undefined &&
          (typeof expiresAt !== 'number' || !Number.isFinite(new Date(expiresAt).getTime())))
      )
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      return prepareCookie(
        cookieContext,
        key,
        value,
        { expires: expiresAt === undefined ? undefined : new Date(expiresAt) },
        { notify: false, durable: true }
      ).apply
    },
    publish: (changes) => {
      if (changes.length)
        publishChange(cookieContext, {
          channel: 'value',
          kind: 'batch',
          keys: changes.flatMap(({ target }) => (target.channel === 'text' ? [target.key] : []))
        })
    }
  })
}

/** The original cookie lifecycle budget prepares each lazy org's configured observations once. */
function plain<R>(
  cookieContext: ICookieContext,
  context: IOperationContext | undefined,
  read: (signal: AbortSignal | undefined) => R
) {
  return withCookieAbort(context, async (signal) => {
    if (cookieContext.runtime.journal !== undefined) await cookieContext.runtime.journal.prepare()
    return read(signal)
  })
}

/** Cookie entities retain their fixed scope and the original visibility/quota checks. */
async function commitValueWrite(
  cookieContext: ICookieContext,
  input: Parameters<IBackendValueCommit>[0],
  ctx: Parameters<IBackendValueCommit>[1]
): Promise<void> {
  const release = cookieContext.controller.beginMutation()
  try {
    await cookieContext.runtime.execution.run(
      { operation: StorageOperation.entityUniqueWrite, input, ctx },
      (captured) =>
        cookieContext.redoEnabled
          ? cookieContext.redo.write([lockKey.text(captured.key)], ctx, async (scope) => {
              const actual = namespacedEntries(
                cookieContext,
                StorageOperation.entityUniqueWrite
              ).flatMap((entry) => {
                if (
                  typeof entry.logicalKey !== 'string' ||
                  !entry.logicalKey.startsWith(captured.prefix)
                )
                  return []
                const value = readVisibleCookie(
                  cookieContext,
                  entry.physicalKey,
                  StorageOperation.entityUniqueWrite,
                  entry.logicalKey
                )
                return value === undefined ? [] : [[entry.logicalKey, value] as const]
              })
              assertValueSnapshot(actual, captured.expected, StorageBackend.cookie)
              await scope.set(captured.key, captured.value)
            })
          : withAbort(ctx, async (signal, _context, operationRuntime) => {
              if (cookieContext.runtime.journal !== undefined)
                await cookieContext.runtime.journal.prepare()
              await withNativeValueWrite(
                () => {
                  assertLive(cookieContext)
                  /**
                   * Snapshot verification and the original private native write share one
                   * synchronous turn.
                   */
                  const actual = namespacedEntries(
                    cookieContext,
                    StorageOperation.entityUniqueWrite
                  ).flatMap((entry) => {
                    if (
                      typeof entry.logicalKey !== 'string' ||
                      !entry.logicalKey.startsWith(captured.prefix)
                    )
                      return []
                    const value = readVisibleCookie(
                      cookieContext,
                      entry.physicalKey,
                      StorageOperation.entityUniqueWrite,
                      entry.logicalKey
                    )
                    return value === undefined ? [] : [[entry.logicalKey, value] as const]
                  })
                  assertValueSnapshot(actual, captured.expected, StorageBackend.cookie)
                  cookieContext.sync.set(captured.key, captured.value)
                },
                StorageBackend.cookie,
                signal,
                operationRuntime,
                cookieContext.controller.closingSignal
              )
            })
    )
  } finally {
    release()
  }
}

/**
 * Store shape the CookieStore class implements; named because implements cannot take an
 * intersection.
 */
type ICookieStoreShape = ICookieContext['store']

/** Cookie store of one namespace: text reads, writes and batches over document.cookie. */
class CookieStore implements ICookieStoreShape {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #cookieContext: ICookieContext

  backend: ICookieStoreShape['backend'] = StorageBackend.cookie

  capabilities: ICookieStoreShape['capabilities']

  sync: ICookieStoreShape['sync']

  transaction: ICookieStoreShape['transaction']

  tx: ICookieStoreShape['tx']

  get: ICookieStoreShape['get'] = (key, ctx) =>
    this.#cookieContext.redoEnabled
      ? this.#cookieContext.redo.read(ctx, () => this.#cookieContext.sync.get(key))
      : plain(this.#cookieContext, ctx, () => this.#cookieContext.sync.get(key))

  set: ICookieStoreShape['set'] = async (key, value, ctx?: ICookieWriteContext) => {
    const context = snapshotCookieWriteContext(ctx)
    if (this.#cookieContext.redoEnabled) {
      await this.#cookieContext.redo.write(
        [lockKey.text(key)],
        context?.lifecycle,
        (scope) => scope.set(key, value),
        (key, value) =>
          prepareCookie(
            this.#cookieContext,
            key,
            value,
            { expires: context?.expires, maxAge: context?.maxAge },
            { notify: false, durable: true, remove: true }
          )
      )
      return
    }
    await withAbort(context?.lifecycle, async () => {
      if (this.#cookieContext.runtime.journal !== undefined)
        await this.#cookieContext.runtime.journal.prepare()
      return this.#cookieContext.sync.set(key, value, {
        expires: context?.expires,
        maxAge: context?.maxAge
      })
    })
  }

  remove: ICookieStoreShape['remove'] = (key, ctx?: ICookieRemoveContext) =>
    this.#cookieContext.redoEnabled
      ? this.#cookieContext.redo.write([lockKey.text(key)], ctx, (scope) => scope.remove(key))
      : plain(this.#cookieContext, ctx, () => this.#cookieContext.sync.remove(key))

  has: ICookieStoreShape['has'] = (key, ctx) =>
    this.#cookieContext.redoEnabled
      ? this.#cookieContext.redo.read(ctx, () => this.#cookieContext.sync.has(key))
      : plain(this.#cookieContext, ctx, () => this.#cookieContext.sync.has(key))

  keys: ICookieStoreShape['keys'] = (ctx) =>
    this.#cookieContext.redoEnabled
      ? this.#cookieContext.redo.read(ctx, () => this.#cookieContext.sync.keys())
      : plain(this.#cookieContext, ctx, () => this.#cookieContext.sync.keys())

  clearValues: ICookieStoreShape['clearValues'] = (ctx) =>
    this.#cookieContext.redoEnabled
      ? this.#cookieContext.redo.clear(ctx)
      : plain(this.#cookieContext, ctx, (signal) => {
          assertLive(this.#cookieContext)
          clearNamespacedEntries(this.#cookieContext, 'cookie.clearValues', signal)
        })

  clearAll: ICookieStoreShape['clearAll'] = (ctx) =>
    this.#cookieContext.redoEnabled
      ? this.#cookieContext.redo.clear(ctx)
      : plain(this.#cookieContext, ctx, (signal) => {
          assertLive(this.#cookieContext)
          clearNamespacedEntries(this.#cookieContext, 'cookie.clearAll', signal)
        })

  dispose: ICookieStoreShape['dispose'] = () => {
    return this.#cookieContext.controller.dispose()
  };

  [asyncDisposeKey]: ICookieStoreShape[typeof asyncDisposeKey] = () =>
    (this.#cookieContext.symbolicDispose ??= this.#cookieContext.store
      .dispose()
      .catch((error) => reportCleanupError(createStorageOperationReporter(), error)))

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(cookieContext: ICookieContext) {
    this.#cookieContext = cookieContext
    this.capabilities = this.#cookieContext.redoEnabled
      ? { ...CAPABILITIES, batch: true, transactions: true }
      : CAPABILITIES
    this.sync = this.#cookieContext.sync
    this.transaction = this.#cookieContext.redo.transaction
    this.tx = this.#cookieContext.redo.tx
  }
}

/** Expose asynchronous cookie methods through the original controller and redo engine. */
function createCookieStore(cookieContext: ICookieContext): ICookieContext['store'] {
  return new CookieStore(cookieContext)
}

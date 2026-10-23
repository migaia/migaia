import {
  kv,
  records,
  readTransactionImplementation,
  type IAnyStorageCapability,
  type ITransactionCapabilityView,
  type ITransactionCapabilityApi
} from './capability.js'
import { TRANSACTION_KEY_VALUE_METHODS, StorageCapabilityMethod } from './capability-constants.js'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { IRecordQuery, IQueryResult } from './query-chain.js'
import {
  ConcurrencyPolicy,
  assertConcurrencyPolicy,
  type IConcurrencyPolicy,
  type IConcurrencyStageObserver
} from './concurrency.js'
import { StorageStageKind } from './stage-kind.js'
import type { IConflictPolicy, IStorageKey, IKeyRange } from './context.js'
import type { IStorageBase } from './store.js'
import { snapshotStorageBaseDetailed } from './store.js'
import { createStorageIteratorLifetime, type IStorageIterator } from './resource.js'
import type {
  IRecordIndexHandle,
  IRecordIndexProjection,
  IRecordIndexQuery
} from './secondary-index.js'
import { StorageContractErrorText } from './error-text.js'
import {
  assimilateCapturedThen,
  inspectThenable,
  observeThenableRejection
} from '@migaia/utils/function'
import type { IBackendKind } from './capabilities.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'

/** Reduced write options used inside a backend-owned transaction scope. */
export type ITransactionWriteOptions = {
  /**
   * Conflict rejects an existing key; replace permits overwrite. Omission is interpreted as
   * conflict.
   */
  readonly conflictPolicy?: IConflictPolicy
}

/** Text operations bound to the original transaction scope, without root operation contexts. */
export type ITransactionKeyValueApi = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: ITransactionWriteOptions): Promise<void>
  remove(key: string): Promise<void>
  has(key: string): Promise<boolean>
  getMany(keys: readonly IStorageKey[]): Promise<readonly (string | undefined)[]>
  setMany(
    entries: readonly {
      readonly key: IStorageKey
      readonly value: string
      readonly ttlMs?: number
    }[]
  ): Promise<void>
  removeMany(keys: readonly IStorageKey[]): Promise<number>
  removeByPrefix(prefix: IStorageKey): Promise<number>
}

/** Transaction record queries share the real executor while refusing ordinary operation contexts. */
export type ITransactionRecordsApi<
  TValue = ICodecValue,
  TAugmentMethods extends object = Record<never, never>
> = {
  query<R = TValue>(): IRecordQuery<R, undefined, TAugmentMethods>
  removeByPrefix(prefix: IStorageKey): Promise<number>
}
/** Complete backend-owned transaction view; all methods use the same physical transaction. */
export type ITransactionScope<
  TValue = unknown,
  TCaps extends IAnyStorageCapability = never
> = ITransactionCapabilityView<typeof kv | TCaps, TValue> &
  ITransactionKeyValueApi & {
    getBytes(key: string): Promise<Uint8Array | null>
    setBytes(key: string, value: Uint8Array, options?: ITransactionWriteOptions): Promise<void>
    removeBytes(key: string): Promise<void>
    getRecord(key: IStorageKey): Promise<TValue | undefined>
    putRecord(
      value: TValue,
      key?: IStorageKey,
      options?: ITransactionWriteOptions
    ): Promise<IStorageKey>
    deleteRecord(key: IStorageKey): Promise<void>
    iterateRecords(range?: IKeyRange): IStorageIterator<[IStorageKey, TValue]>
    putIndexedRecord?(
      value: TValue,
      key: IStorageKey,
      handle: IRecordIndexHandle,
      projection: IRecordIndexProjection,
      options?: ITransactionWriteOptions
    ): Promise<IStorageKey>
    iterateRecordIndex?(query: IRecordIndexQuery): IStorageIterator<[IStorageKey, TValue]>
  }

/**
 * Rejects a non-callable transaction callback before a provider allocates transaction resources.
 * Valid functions return without being invoked. Invalid input throws INVALID_ARGUMENT with the
 * supplied backend label and a native TypeError cause; this does not validate callback results.
 */
export const assertTransactionCallback = (run: unknown, backend: IBackendKind): void => {
  if (typeof run === 'function') return
  throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
    backend,
    cause: new TypeError(StorageContractErrorText.transactionCallback)
  })
}

/**
 * Reads one transaction write policy before the provider changes records. Omitted options or an
 * omitted conflictPolicy return conflict; the only other accepted value is replace. Invalid
 * shapes/policies throw INVALID_ARGUMENT with the supplied backend label. Accessor or reflection
 * failure remains reachable as cause. No transaction or storage operation is started.
 */
export const readTransactionConflictPolicy = (
  options: unknown,
  backend: IBackendKind
): IConflictPolicy => {
  if (options === undefined) return 'conflict'
  try {
    if (typeof options === 'object' && options !== null && !Array.isArray(options)) {
      /** Capture the policy once so accessors cannot change it between validation and use. */
      const policy = (options as { conflictPolicy?: unknown }).conflictPolicy
      if (policy === undefined || policy === 'conflict') return 'conflict'
      if (policy === 'replace') return 'replace'
    }
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend,
      cause
    })
  }
  throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
    backend,
    cause: new TypeError(StorageContractErrorText.transactionWriteOptions)
  })
}

/** Original transaction observations never admit work or alter commit decisions. */
export type ITransactionStageObserver = Readonly<{
  readonly kind: typeof StorageStageKind.transaction
  forTransaction: (scope: object) => ITransactionStageObserver
  beforeTransaction?: () => void | PromiseLike<void>
  onTransactionStart?: () => void | PromiseLike<void>
  beforeTxOperation?: (operation: string) => void | PromiseLike<void>
  afterTxOperation?: (operation: string) => void | PromiseLike<void>
  beforeCommit?: () => void | PromiseLike<void>
  afterCommit?: (changedKeys: number) => void | PromiseLike<void>
  afterRollback?: (code?: string) => void | PromiseLike<void>
  onTransactionClose?: () => void | PromiseLike<void>
  beforePersistFlush?: () => void | PromiseLike<void>
  afterPersistFlush?: () => void | PromiseLike<void>
  report: (error: unknown) => undefined
}>

/** Actual backend activity mode, never a caller-supplied permission claim. */
export const TransactionActivityMode = { managed: 'managed', native: 'native' } as const
/** Activity names share the canonical runtime declaration. */
export type TransactionActivityMode = keyof typeof TransactionActivityMode
/** All short-lived views of one transaction return this same immutable fact record. */
export type ITransactionInfo = Readonly<{ id: string; activityMode: TransactionActivityMode }>
/** Working boundaries remain observations; only the backend executes and commits. */
export const TransactionBeforeStage = {
  beforeTransaction: 'beforeTransaction',
  beforeTxOperation: 'beforeTxOperation',
  beforeCommit: 'beforeCommit',
  beforePersistFlush: 'beforePersistFlush'
} as const
/** Before-stage names share one canonical declaration. */
export type TransactionBeforeStage = keyof typeof TransactionBeforeStage
/** Terminal observations use captured identity without reopening a data view. */
export const TransactionObservedStage = {
  onTransactionStart: 'onTransactionStart',
  afterTxOperation: 'afterTxOperation',
  afterCommit: 'afterCommit',
  afterRollback: 'afterRollback',
  onTransactionClose: 'onTransactionClose',
  afterPersistFlush: 'afterPersistFlush'
} as const
/** Observed-stage names share one canonical declaration. */
export type TransactionObservedStage = keyof typeof TransactionObservedStage

/** Backend normalization is the only owner of transaction failure source, code and topology. */
type ITransactionFailure = Error & { readonly source: string; readonly code: string }
/** Private registration kinds never authorize an object based on public fields. */
const RegistrationKind = { owner: 'owner', view: 'view', iterator: 'iterator' } as const
/** One store initialization captures its backend-owned normalizer and fixed resource key. */
type IOwnerRegistration = {
  readonly kind: typeof RegistrationKind.owner
  readonly store: IStorageBase
  readonly backend: string
  readonly normalizeFailure: (error: unknown) => ITransactionFailure
  readonly asyncDisposeKey: typeof Symbol.asyncDispose
  readonly defaultPolicy: IConcurrencyPolicy
  readonly concurrencyStages: IConcurrencyStageObserver | undefined
}
/** Expired views release the transaction and retain only immutable facts and rejection identity. */
type IViewRegistration = {
  readonly kind: typeof RegistrationKind.view
  readonly backend: string
  readonly info: ITransactionInfo
  state: ITransactionState | undefined
  expiredFailure: ITransactionFailure | undefined
  capabilities:
    | Map<IAnyStorageCapability, { readonly implementation: object; readonly api: unknown }>
    | undefined
}
/** An actual iterator remains recognizable after its resource and original view have closed. */
type IIteratorRegistration = {
  readonly kind: typeof RegistrationKind.iterator
  readonly info: ITransactionInfo
  readonly advance: (scope: object) => Promise<IteratorResult<unknown>>
  readonly cleanup: () => Promise<void>
  readonly compose: <TResult>(
    run: (scope: object | undefined) => Promise<TResult>
  ) => Promise<TResult>
  /** Query projection reuses this exact owner's iterator registration and cleanup implementation. */
  readonly derive: <TResult>(
    read: (
      next: () => Promise<IteratorResult<unknown>>,
      fail: (error: unknown) => unknown
    ) => Promise<IteratorResult<TResult>>
  ) => IStorageIterator<TResult>
  readonly fail: (error: unknown) => unknown
}
/** Only active work and resources are retained; completed history is removed at settlement. */
type ITransactionState = {
  readonly owner: IOwnerRegistration
  readonly info: ITransactionInfo
  readonly views: Set<IViewRegistration>
  readonly operations: Set<Promise<unknown>>
  readonly iterators: Set<IIteratorRegistration>
  userView: IViewRegistration | undefined
  createScope: (() => object) | undefined
  onFailure: ((error: ITransactionFailure) => void) | undefined
  beforeCommit: ((scope: object) => void | PromiseLike<void>) | undefined
  checks: ((scope: object) => void | PromiseLike<void>)[]
  firstFailure: ITransactionFailure | undefined
  expiredFailure: ITransactionFailure | undefined
  finalizers: Promise<void> | undefined
  closingIterators: Promise<void> | undefined
  checksFrozen: boolean
  closed: boolean
}
/** Sole identity registry for stores, every transaction view and actual iterator objects. */
const transactionRegistrations = new WeakMap<
  object,
  IOwnerRegistration | IViewRegistration | IIteratorRegistration
>()
/** A monotonic arbitrary-width identity has no runtime or host dependency. */
let nextTransactionId = 0n

/** Builds the registered contract argument boundary without leaking resource payloads. */
function invalidTransaction(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { cause },
    StorageContractErrorText.transactionArgument
  )
}
/** Reuses the existing host error channel for cleanup/report callback failures. */
function reportTransactionFailure(error: unknown): void {
  observeThenableRejection(undefined, { error }, (failure) => {
    throw failure
  })
}
/** Uses the canonical captured-then implementation; getters are inspected exactly once. */
function awaitTransactionResult<T>(result: T): Promise<Awaited<T>> {
  /** Inspection distinguishes a source getter failure from a non-thenable value. */
  const inspection = inspectThenable(result)
  if ('error' in inspection) return Promise.reject(inspection.error)
  if ('then' in inspection && inspection.then !== undefined)
    return assimilateCapturedThen<Awaited<T>>(inspection.then, result)
  return Promise.resolve(result as Awaited<T>)
}
/** Captures one resource-free failure before any view loses its backend state reference. */
function expirationFailure(state: ITransactionState): ITransactionFailure {
  return (state.expiredFailure ??= state.owner.normalizeFailure(
    new Error(StorageContractErrorText.transactionInactive)
  ))
}
/** Closing one view releases its data/factory access without affecting accepted sibling work. */
function invalidateView(view: IViewRegistration): void {
  /** Live state owns the one precomputed expiry error shared by its derived views. */
  const state = view.state
  if (!state) return
  view.expiredFailure = expirationFailure(state)
  view.capabilities?.clear()
  view.capabilities = undefined
  view.state = undefined
  state.views.delete(view)
}
/** First failure stops all further data admission and immediately triggers backend rollback. */
function failTransaction(state: ITransactionState, error: unknown): ITransactionFailure {
  /** Idempotent backend normalization preserves already-coded native or backend error identity. */
  const failure =
    state.firstFailure && error === state.firstFailure
      ? state.firstFailure
      : state.owner.normalizeFailure(error)
  if (!state.firstFailure) {
    state.firstFailure = failure
    for (const view of state.views) invalidateView(view)
    /** The backend callback is captured once and has no authority to replace the original failure. */
    const onFailure = state.onFailure
    if (onFailure) {
      try {
        onFailure(failure)
      } catch (callbackError) {
        reportTransactionFailure(callbackError)
      }
    }
  }
  return failure
}
/** Keeps late data rejection observable by the caller while preventing an unhandled Promise leak. */
function rejectedTransactionResult<T>(failure: ITransactionFailure | undefined): Promise<T> {
  /** The backend already retained and reported this failure through its original owner. */
  const result = Promise.reject<T>(failure)
  void result.then(undefined, () => undefined)
  return result
}
/** Looks up authentic view identity; expired data calls are treated separately by their caller. */
function transactionView(scope: object): IViewRegistration {
  /** Public shape and method names cannot substitute for private registration. */
  const registration = transactionRegistrations.get(scope)
  if (registration?.kind !== RegistrationKind.view) throw invalidTransaction()
  return registration
}
/** Registers a fresh complete backend method factory result under the same real transaction. */
function createTransactionView(state: ITransactionState): {
  scope: object
  view: IViewRegistration
} {
  /** Terminal closure has already detached the factory. */
  const createScope = state.createScope
  if (!createScope) throw invalidTransaction()
  /** No view may be reused, revived, or mistaken for another registered owner/resource. */
  const scope = createScope()
  if (typeof scope !== 'object' || scope === null || transactionRegistrations.has(scope))
    throw invalidTransaction()
  /** Only the private record carries backend authorization. */
  const view: IViewRegistration = {
    kind: RegistrationKind.view,
    backend: state.owner.backend,
    info: state.info,
    state,
    expiredFailure: undefined,
    capabilities: undefined
  }
  transactionRegistrations.set(scope, view)
  state.views.add(view)
  return { scope, view }
}
/** Waits only currently accepted work, including children started before their parent settles. */
async function drainTransactionOperations(state: ITransactionState): Promise<void> {
  while (state.operations.size > 0) await Promise.allSettled(state.operations)
}
/** Aggregates cleanup after the normalized primary, then reuses the backend's error boundary. */
function cleanupFailure(state: ITransactionState, errors: readonly unknown[]): ITransactionFailure {
  /** The first transaction failure must remain the first reachable aggregate entry. */
  const primary = state.firstFailure
  /** A single already-normalized failure needs no extra wrapper. */
  if (errors.length === 1 && (!primary || primary === errors[0]))
    return errors[0] as ITransactionFailure
  return state.owner.normalizeFailure(
    new AggregateError(
      primary ? [primary, ...errors.filter((error) => error !== primary)] : errors,
      StorageContractErrorText.transactionCleanup
    )
  )
}
/** Drains before cleanup, releases all remaining resources and retains every cleanup failure. */
async function closeTransactionIterators(state: ITransactionState): Promise<void> {
  await drainTransactionOperations(state)
  /** Snapshot only current resources, then release in reverse creation order. */
  const resources = [...state.iterators]
  /** Only this cleanup round's failures count; prior data errors are not replayed as cleanup. */
  const errors: unknown[] = []
  for (let index = resources.length - 1; index >= 0; index -= 1) {
    try {
      await resources[index]!.cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) throw cleanupFailure(state, errors)
}
/** Checks are outside the active-operation set they must drain, so they cannot await themselves. */
async function runTransactionCheck(
  state: ITransactionState,
  check: (scope: object) => void | PromiseLike<void>
): Promise<void> {
  /** Even factory failure enters the same backend normalization and rollback path. */
  let view: IViewRegistration | undefined
  try {
    try {
      /** Each check and final beforeCommit receives an independent complete view. */
      const created = createTransactionView(state)
      view = created.view
      await awaitTransactionResult(check(created.scope))
    } catch (error) {
      failTransaction(state, error)
    }
    await closeTransactionIterators(state)
    if (state.firstFailure) throw state.firstFailure
  } finally {
    if (view) invalidateView(view)
  }
}

/** Initializes the sole transaction owner before a backend publishes the original base. */
export function createTransactionOwner<
  TValue = unknown,
  TBaseScope extends object = Omit<ITransactionScope<TValue>, 'use'>
>(
  store: IStorageBase,
  normalizeFailure: (error: unknown) => ITransactionFailure,
  options?: {
    readonly activityMode?: TransactionActivityMode
    readonly asyncDisposeKey?: typeof Symbol.asyncDispose
    readonly defaultPolicy?: IConcurrencyPolicy
    readonly concurrencyStages?: IConcurrencyStageObserver
  }
): {
  register<TScope extends TBaseScope>(
    scope: TScope,
    options: {
      readonly createScope: () => NoInfer<TScope>
      readonly onFailure: (error: ITransactionFailure) => void
      readonly beforeCommit?: (checkScope: NoInfer<TScope>) => void | PromiseLike<void>
    }
  ): {
    stopAdmission(): void
    runFinalizers(): Promise<void>
    closeIterators(): Promise<void>
    close(): void
  }
  registerIterator<TScope extends TBaseScope, T>(
    scope: TScope,
    port: {
      readonly next: (currentScope: NoInfer<TScope>) => PromiseLike<IteratorResult<T>>
      readonly close: () => void | PromiseLike<void>
    }
  ): IStorageIterator<T>
} {
  try {
    /** Options and the canonical symbol are captured once before any owner is registered. */
    const activityMode = options?.activityMode ?? TransactionActivityMode.managed
    /** The outer host supplies a fallback identity; this foundation never invents one. */
    const asyncDisposeKey: typeof Symbol.asyncDispose | undefined =
      options?.asyncDisposeKey ?? Symbol.asyncDispose
    if (
      typeof normalizeFailure !== 'function' ||
      typeof asyncDisposeKey !== 'symbol' ||
      (activityMode !== TransactionActivityMode.managed &&
        activityMode !== TransactionActivityMode.native)
    )
      throw invalidTransaction()
    /** The original owner is the only store-default policy registration. */
    const configuredPolicy = options?.defaultPolicy
    /** Observations retain their existing host registry and grant no policy or lock authority. */
    const concurrencyStages = options?.concurrencyStages
    if (configuredPolicy !== undefined) assertConcurrencyPolicy(configuredPolicy)
    if (concurrencyStages !== undefined && concurrencyStages.kind !== StorageStageKind.concurrency)
      throw invalidTransaction()
    /** Missing policy creates exactly one authentic default for this original owner. */
    const defaultPolicy =
      configuredPolicy === undefined ? ConcurrencyPolicy.wait() : configuredPolicy
    /** Shared non-owning admission validates resource methods and support facts exactly once. */
    const base = snapshotStorageBaseDetailed(store, { asyncDisposeKey })
    if (!base.valid || transactionRegistrations.has(store))
      throw invalidTransaction(base.valid ? undefined : base.cause)
    /** No backend callbacks or connections are duplicated by this registration. */
    const owner: IOwnerRegistration = {
      kind: RegistrationKind.owner,
      store,
      backend: base.backend,
      normalizeFailure,
      asyncDisposeKey,
      defaultPolicy,
      concurrencyStages
    }
    transactionRegistrations.set(store, owner)
    return {
      register(scope, registrationOptions) {
        try {
          /** Capture callbacks before changing registration state. */
          const { createScope, onFailure, beforeCommit } = registrationOptions
          if (
            typeof scope !== 'object' ||
            scope === null ||
            transactionRegistrations.has(scope) ||
            typeof createScope !== 'function' ||
            typeof onFailure !== 'function' ||
            (beforeCommit !== undefined && typeof beforeCommit !== 'function')
          )
            throw invalidTransaction()
          /** All views share one immutable identity, independent of their object lifetime. */
          const info: ITransactionInfo = Object.freeze({
            id: String(++nextTransactionId),
            activityMode
          })
          /** Only live sets and unresolved checks retain backend operation references. */
          const state: ITransactionState = {
            owner,
            info,
            views: new Set(),
            operations: new Set(),
            iterators: new Set(),
            userView: undefined,
            createScope,
            onFailure,
            beforeCommit: beforeCommit as ITransactionState['beforeCommit'],
            checks: [],
            firstFailure: undefined,
            expiredFailure: undefined,
            finalizers: undefined,
            closingIterators: undefined,
            checksFrozen: false,
            closed: false
          }
          /** The initial user view cannot reopen after callback admission stops. */
          const view: IViewRegistration = {
            kind: RegistrationKind.view,
            backend: base.backend,
            info,
            state,
            expiredFailure: undefined,
            capabilities: undefined
          }
          state.userView = view
          state.views.add(view)
          transactionRegistrations.set(scope, view)
          return {
            stopAdmission() {
              if (state.userView) invalidateView(state.userView)
              state.userView = undefined
            },
            runFinalizers() {
              if (state.finalizers) return state.finalizers
              state.checksFrozen = true
              if (state.userView) invalidateView(state.userView)
              state.userView = undefined
              /** Freeze and detach the accepted checks before any asynchronous draining begins. */
              const checks = state.checks
              state.checks = []
              state.finalizers = Promise.resolve().then(async () => {
                await closeTransactionIterators(state)
                if (state.firstFailure) throw state.firstFailure
                if (state.closed) throw expirationFailure(state)
                for (const check of checks) await runTransactionCheck(state, check)
                if (state.beforeCommit) await runTransactionCheck(state, state.beforeCommit)
              })
              return state.finalizers
            },
            closeIterators() {
              if (state.closingIterators) return state.closingIterators
              /** Only simultaneous cleanup calls share a round; later checks may own new resources. */
              const closing = closeTransactionIterators(state)
              state.closingIterators = closing
              void closing.then(
                () => {
                  state.closingIterators = undefined
                },
                () => {
                  state.closingIterators = undefined
                }
              )
              return closing
            },
            close() {
              if (state.closed) return
              state.closed = true
              for (const current of state.views) invalidateView(current)
              state.userView = undefined
              state.createScope = undefined
              state.onFailure = undefined
              state.beforeCommit = undefined
              state.checks = []
              state.operations.clear()
              state.iterators.clear()
            }
          }
        } catch (cause) {
          if (cause instanceof StorageContractError) throw cause
          throw invalidTransaction(cause)
        }
      },
      registerIterator: function registerIterator<TScope extends TBaseScope, T>(
        scope: TScope,
        port: {
          readonly next: (currentScope: NoInfer<TScope>) => PromiseLike<IteratorResult<T>>
          readonly close: () => void | PromiseLike<void>
        }
      ): IStorageIterator<T> {
        /** Iterator creation borrows a currently authentic view, never public structural claims. */
        const creationView = transactionView(scope)
        /** Live authorization must match this exact store owner. */
        const state = creationView.state
        if (!state || state.owner !== owner || state.closed || state.firstFailure)
          throw invalidTransaction()
        /** The port and original scope are released when the actual cleanup settles. */
        let next: typeof port.next | undefined
        /** One close function is captured before the resource becomes observable. */
        let close: typeof port.close | undefined
        try {
          next = port.next
          close = port.close
        } catch (cause) {
          throw invalidTransaction(cause)
        }
        if (typeof next !== 'function' || typeof close !== 'function') throw invalidTransaction()
        /** The live transaction reference is detached after cleanup, leaving only immutable facts. */
        let iteratorState: ITransactionState | undefined = state
        /** Creation-scope authority is discarded after cleanup. */
        let originalScope: object | undefined = scope
        /** Actual registration is assigned before any resource method can run. */
        let resource: IIteratorRegistration
        /** The canonical resource lifetime waits complete accepted advances before native close. */
        const lifetime = createStorageIteratorLifetime<T>({
          close: async () => {
            /** Capture before awaiting so reentrant cleanup cannot invoke the port again. */
            const release = close
            close = undefined
            if (release) {
              try {
                await awaitTransactionResult(release())
              } catch (error) {
                throw failTransaction(iteratorState!, error)
              }
            }
          },
          report: reportTransactionFailure,
          onSettled: () => {
            iteratorState?.iterators.delete(resource)
            iteratorState = undefined
            next = undefined
            originalScope = undefined
          }
        })
        /** One original scope still authorizes each complete advance and its operation view. */
        const advance = (currentScope: object): Promise<IteratorResult<T>> =>
          lifetime.advance(() =>
            runTransactionOperation(currentScope, (operationScope) => {
              if (lifetime.isClosing() || !next)
                return { done: true, value: undefined } as IteratorResult<T>
              return next(operationScope as typeof scope)
            })
          )
        /** All existing cleanup paths retain the canonical cached main Promise. */
        const cleanup = lifetime.dispose
        resource = {
          kind: RegistrationKind.iterator,
          info: state.info,
          advance,
          cleanup,
          /** A complete query borrows its own real operation view rather than the expired user view. */
          compose: (run) =>
            originalScope ? runTransactionOperation(originalScope, run) : run(undefined),
          /** A mapped stream remains a real resource in the original scope after native exhaustion. */
          derive: (read) => {
            if (!originalScope) throw invalidTransaction()
            return registerIterator(originalScope as TScope, {
              next: (currentScope) =>
                read(() => nextTransactionIterator(currentScope, iterator), resource.fail),
              close: cleanup
            })
          },
          /** Primary query failure reaches the original owner before cursor cleanup can fail. */
          fail: (error) =>
            iteratorState
              ? (iteratorState.firstFailure ?? failTransaction(iteratorState, error))
              : error
        }
        /** Only this actual object is registered; copying its methods grants no new identity. */
        const iterator: IStorageIterator<T> = {
          next: () =>
            originalScope
              ? advance(originalScope)
              : creationView.state
                ? Promise.resolve({ done: true, value: undefined })
                : rejectedTransactionResult(creationView.expiredFailure),
          return: lifetime.returned,
          dispose: cleanup,
          [owner.asyncDisposeKey]: lifetime.symbolic,
          [Symbol.asyncIterator]() {
            return this
          }
        }
        transactionRegistrations.set(iterator, resource)
        state.iterators.add(resource)
        return iterator
      }
    }
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidTransaction(cause)
  }
}

/**
 * Internal query composition borrows the actual iterator's original owner. The entire terminal is
 * synchronously admitted before its first next; its scoped advances remain valid after the user
 * callback ends. Failure is recorded before cleanup so cleanup cannot become the primary error.
 * Non-transaction iterators keep their original direct advance/cleanup owner. This helper is not
 * exported from the package root and grants no registration, lifecycle or backend author
 * authority.
 */
export function runTransactionIteratorOperation<T, TResult>(
  iterator: IStorageIterator<T>,
  run: (
    next: () => Promise<IteratorResult<T>>,
    fail: (error: unknown) => unknown
  ) => Promise<TResult>
): Promise<TResult> {
  /** Only the existing actual iterator record can provide original transaction authority. */
  const resource = transactionRegistrations.get(iterator)
  if (resource?.kind !== RegistrationKind.iterator)
    return run(
      () => iterator.next(),
      (error) => error
    )
  return resource.compose((scope) =>
    run(
      scope === undefined ? () => iterator.next() : () => nextTransactionIterator(scope, iterator),
      resource.fail
    )
  )
}

/**
 * Projects one query read through the original iterator owner. The existing registration alone
 * supplies scope admission, accepted-next draining and cached cleanup; no second lifecycle exists.
 * Unregistered source resources retain their own native iterator contract and return undefined.
 */
export function deriveTransactionIterator<T, TResult>(
  iterator: IStorageIterator<T>,
  read: (
    next: () => Promise<IteratorResult<T>>,
    fail: (error: unknown) => unknown
  ) => Promise<IteratorResult<TResult>>
): IStorageIterator<TResult> | undefined {
  /** Only an original actual registration can create a resource in that same scope. */
  const resource = transactionRegistrations.get(iterator)
  if (resource?.kind !== RegistrationKind.iterator) return undefined
  return resource.derive(
    read as (
      next: () => Promise<IteratorResult<unknown>>,
      fail: (error: unknown) => unknown
    ) => Promise<IteratorResult<TResult>>
  )
}

/** Returns authentic live identity without granting registration, reads or future validity. */
export function assertTransactionOwner(store: IStorageBase, scope: object): ITransactionInfo {
  /** Store and view must both be present in the same private owner table. */
  const owner = transactionRegistrations.get(store)
  /** A genuine expired view remains recognizable but cannot be rebound. */
  const view = transactionView(scope)
  if (
    owner?.kind !== RegistrationKind.owner ||
    view.state?.owner !== owner ||
    view.state.closed ||
    view.state.firstFailure
  )
    throw invalidTransaction()
  return view.info
}

/** Actual record projection values follow the original full backend scope. */
type IScopeRecordValue<TScope> = TScope extends {
  getRecord(key: IStorageKey): Promise<(infer TValue) | undefined>
}
  ? TValue
  : ICodecValue
/** Retrieves only authentic live scope state, never a public store/capabilities lookalike. */
function liveTransactionCapability(
  scope: object,
  capability: IAnyStorageCapability
): {
  readonly state: ITransactionState
  readonly binding: ReturnType<typeof readTransactionImplementation>
} {
  /** The same view record owns cache lifetime, transaction validity and its exact original store. */
  const view = transactionView(scope)
  /** Pure lookup cannot revive an invalidated user, operation or check view. */
  const state = view.state
  if (!state || state.closed || state.firstFailure) throw invalidTransaction()
  return { state, binding: readTransactionImplementation(state.owner.store, capability) }
}
/** Executes one projected data method inside the original operation owner with a fresh full view. */
function runTransactionCapabilityMethod(
  scope: ITransactionScope<unknown>,
  capability: IAnyStorageCapability,
  method: string,
  args: readonly unknown[]
): Promise<unknown> {
  return runTransactionOperation(scope, (operationScope) => {
    /** Re-read publication authority rather than retaining an installation after Feature release. */
    const { binding } = liveTransactionCapability(operationScope, capability)
    /** Only the current operation view reaches backend binding; old views are never reused. */
    const api = binding.forTransaction(operationScope)
    if (typeof api !== 'object' || api === null) throw invalidTransaction()
    /** Borrow one actual native method and preserve its API receiver and returned value. */
    const execute = (api as Record<string, unknown>)[method]
    if (typeof execute !== 'function') throw invalidTransaction()
    return Reflect.apply(execute, api, args)
  })
}
/** Adds original-owner admission to the actual selected chain without copying its nodes or plan. */
function transactionRecordQueryResult<R>(
  scope: object,
  query: IQueryResult<R, undefined>
): IQueryResult<R, undefined> {
  return Object.freeze({
    ...query,
    all: () => runTransactionOperation(scope, () => query.all()),
    explain: () => query.explain(),
    requirePushdown: () => transactionRecordQueryResult(scope, query.requirePushdown())
  })
}
/** Preserves the actual immutable query and every typed branch; only terminal admission is added. */
function transactionRecordQuery<R>(
  scope: object,
  query: IRecordQuery<R, undefined>
): IRecordQuery<R, undefined> {
  /** Forwarding retains the original overloads, row inference and one-time condition capture. */
  const where = ((...args: readonly unknown[]) =>
    transactionRecordQuery(scope, Reflect.apply(query.where, query, args))) as IRecordQuery<
    R,
    undefined
  >['where']
  /** Selection remains the original shared node constructor and never gains a second executor. */
  const select = ((...args: readonly unknown[]) =>
    transactionRecordQueryResult(scope, Reflect.apply(query.select, query, args))) as IRecordQuery<
    R,
    undefined
  >['select']
  return Object.freeze({
    ...query,
    where,
    select,
    limit: (count: number) => transactionRecordQuery(scope, query.limit(count)),
    orderByComparator: (compare: (left: R, right: R) => number) => {
      /** Original argument admission stays at the comparator call, before any terminal. */
      const pending = query.orderByComparator(compare)
      return {
        limit: (count: number) =>
          transactionRecordQuery(scope, pending.limit(count) as IRecordQuery<R, undefined>)
      }
    },
    all: () => runTransactionOperation(scope, () => query.all()),
    explain: () => query.explain(),
    requirePushdown: () => transactionRecordQuery(scope, query.requirePushdown())
  }) as IRecordQuery<R, undefined>
}
/**
 * Reads the original store capability table from an authentic view. Pure lookup invokes no binder
 * or I/O. Cached finite projections keep only this view/token identity; invalidation clears them.
 * Data calls still enter the original operation owner; record query construction remains pure and
 * its authentic backend source supplies the existing iterator/complete-terminal ownership.
 */
export function useTransactionCapability<
  TScope extends ITransactionScope<unknown>,
  TCap extends IAnyStorageCapability & Parameters<TScope['use']>[0]
>(
  scope: TScope,
  capability: TCap
): TCap extends typeof records
  ? ITransactionRecordsApi<IScopeRecordValue<TScope>>
  : ITransactionCapabilityApi<TCap> {
  /** Membership is checked before returning even a previously cached projection. */
  const { binding } = liveTransactionCapability(scope, capability)
  /** The current view is already proved authentic and active by the same owner lookup. */
  const view = transactionView(scope)
  /** One cached API object per actual implementation and view preserves pure lookup identity. */
  const previous = view.capabilities?.get(capability)
  if (previous?.implementation === binding.implementation)
    return previous.api as TCap extends typeof records
      ? ITransactionRecordsApi<IScopeRecordValue<TScope>>
      : ITransactionCapabilityApi<TCap>
  /** Complete finite methods delegate to the original binder only when an operation actually runs. */
  const api: Record<string, unknown> = {}
  if (capability === kv) {
    for (const method of TRANSACTION_KEY_VALUE_METHODS)
      api[method] = (...args: readonly unknown[]) =>
        runTransactionCapabilityMethod(scope, capability, method, args)
  } else {
    /**
     * Queries bind the current user/check/operation view without opening a cursor during
     * construction.
     */
    api.query = () => {
      /**
       * Actual native sources retain this original view and register their iterators with its
       * owner.
       */
      const { state, binding } = liveTransactionCapability(scope, capability)
      try {
        /** The backend's pure query constructor must use its real scope, never a root API. */
        const bound = binding.forTransaction(scope)
        if (typeof bound !== 'object' || bound === null) throw invalidTransaction()
        /** One borrowed constructor keeps the actual shared chain and its source receiver intact. */
        const query = (bound as Record<string, unknown>).query
        if (typeof query !== 'function') throw invalidTransaction()
        return transactionRecordQuery(scope, Reflect.apply(query, bound, []))
      } catch (error) {
        throw failTransaction(state, error)
      }
    }
    api.removeByPrefix = (prefix: IStorageKey) =>
      runTransactionCapabilityMethod(scope, capability, StorageCapabilityMethod.removeByPrefix, [
        prefix
      ])
  }
  /** Only the projection object is frozen; the backend scope/API and original base are not patched. */
  const frozen = Object.freeze(api)
  ;(view.capabilities ??= new Map()).set(capability, {
    implementation: binding.implementation,
    api: frozen
  })
  return frozen as TCap extends typeof records
    ? ITransactionRecordsApi<IScopeRecordValue<TScope>>
    : ITransactionCapabilityApi<TCap>
}

/** Registers and invokes a composed operation synchronously before schema, codec or native work. */
export function runTransactionOperation<TScope extends object, TResult>(
  scope: TScope,
  run: (operationScope: TScope) => TResult
): Promise<Awaited<TResult>> {
  /** Forged scopes fail synchronously; authentic expired data calls return backend rejection. */
  const view = transactionView(scope)
  /** Capture live state once rather than asking public scope fields for permission. */
  const state = view.state
  if (!state) {
    return rejectedTransactionResult<Awaited<TResult>>(view.expiredFailure)
  }
  /** A deferred public result is inserted before invoking the backend view factory or user code. */
  let resolveResult!: (value: Awaited<TResult>) => void
  /** The result remains rejected for its caller while an internal observer prevents late leaks. */
  let rejectResult!: (error: unknown) => void
  /** Every operation occupies exactly one active-set entry until actual settlement. */
  const result = new Promise<Awaited<TResult>>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  state.operations.add(result)
  /** One created view belongs exclusively to this operation and is invalidated at settlement. */
  let operationView: IViewRegistration | undefined
  /** Both synchronous and asynchronous outcomes use one settlement owner. */
  const finish = (value: Awaited<TResult> | undefined, error?: unknown, failed = false): void => {
    if (operationView) invalidateView(operationView)
    state.operations.delete(result)
    if (failed) rejectResult(failTransaction(state, error))
    else resolveResult(value as Awaited<TResult>)
  }
  try {
    if (typeof run !== 'function') throw invalidTransaction()
    /** Factory methods retain the concrete backend extensions, rather than copying the caller. */
    const created = createTransactionView(state)
    operationView = created.view
    /** Direct invocation lets native transaction requests start in their actual active window. */
    const value = run(created.scope as TScope)
    /** Inspection and assimilation share the captured then getter. */
    const inspection = inspectThenable(value)
    if ('error' in inspection) finish(undefined, inspection.error, true)
    else if ('then' in inspection && inspection.then !== undefined)
      void assimilateCapturedThen<Awaited<TResult>>(inspection.then, value).then(
        (value) => finish(value),
        (error) => finish(undefined, error, true)
      )
    else finish(value as Awaited<TResult>)
  } catch (error) {
    finish(undefined, error, true)
  }
  void result.then(undefined, () => undefined)
  return result
}

/** Registers one final check in order, before the first finalizer run freezes the accepted list. */
export function registerTransactionFinalizer<TScope extends object>(
  scope: TScope,
  check: (checkScope: TScope) => void | PromiseLike<void>
): void {
  /** Finalizers require a currently authentic view and never revive an expired callback object. */
  const view = transactionView(scope)
  /** The same transaction owns checks registered from any of its active method views. */
  const state = view.state
  if (
    !state ||
    state.closed ||
    state.firstFailure ||
    state.checksFrozen ||
    typeof check !== 'function'
  )
    throw invalidTransaction()
  state.checks.push(check as (scope: object) => void | PromiseLike<void>)
}

/** Advances only a registered actual iterator from the same currently authentic transaction. */
export function nextTransactionIterator<_TValue, T>(
  scope: object,
  iterator: AsyncIterator<T>
): Promise<IteratorResult<T>> {
  /** This identity check is separate from data execution's backend expiry error. */
  const view = transactionView(scope)
  /** Iterator identity cannot be forged by copying a public next method. */
  const resource = transactionRegistrations.get(iterator)
  if (
    !view.state ||
    view.state.closed ||
    view.state.firstFailure ||
    resource?.kind !== RegistrationKind.iterator ||
    resource.info !== view.info
  )
    throw invalidTransaction()
  return resource.advance(scope) as Promise<IteratorResult<T>>
}

/** Backend-only policy resolution reads the original owner; it does not grant transaction authority. */
export function resolveConcurrencyPolicy(
  store: IStorageBase,
  override?: IConcurrencyPolicy
): IConcurrencyPolicy {
  /** Authentic store identity is required even when the caller supplies a valid override. */
  const owner = transactionRegistrations.get(store)
  if (owner?.kind !== RegistrationKind.owner) throw invalidTransaction()
  if (override !== undefined) {
    assertConcurrencyPolicy(override)
    return override
  }
  return owner.defaultPolicy
}

/** Internal loop wiring reads captured backend/stages from the same authentic store registration. */
export function readTransactionConcurrency(store: IStorageBase): {
  readonly backend: IBackendKind
  readonly stages: IConcurrencyStageObserver | undefined
} {
  /** This lookup cannot admit a structurally copied store or a transaction view as an owner. */
  const owner = transactionRegistrations.get(store)
  if (owner?.kind !== RegistrationKind.owner) throw invalidTransaction()
  return { backend: owner.backend, stages: owner.concurrencyStages }
}

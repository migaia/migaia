import {
  readTransactionImplementation,
  type IAnyStorageCapability,
  type ITransactionCapabilityView,
  type ITransactionCapabilityApi
} from './capability.js'
import { StorageCapabilityMethod } from './capability-constants.js'
import { readCapabilityTokenFacts } from './capability-token.js'
import type { kv } from './capabilities/kv.js'
import type { records } from './capabilities/records.js'
import type { IQuad } from './capabilities/rdf.js'
import {
  deriveStorageSqlQuery,
  SqlQueryMethod,
  type ISqlExecutor,
  type ISqlTag,
  type ISqlInput,
  type ISqlQuery
} from './sql.js'
import type { ICodecValue } from '@migaia/serialize/codec'
import {
  RecordQueryMethod,
  RdfQueryMethod,
  type IRecordQuery,
  type IQueryResult,
  type IRdfQuery
} from './query-chain.js'
import {
  ConcurrencyPolicy,
  assertConcurrencyPolicy,
  type IConcurrencyPolicy,
  type IConcurrencyStageObserver
} from './concurrency.js'
import { StorageStageKind } from './stage-kind.js'
import type { IConflictPolicy, IStorageKey, IKeyRange, IOperationContext } from './context.js'
import { snapshotOperationContext } from './operation-context.js'
import type { IStorageBase } from './store.js'
import { snapshotStorageBaseDetailed } from './store.js'
import { createStorageIteratorLifetime, type IStorageIterator } from './resource.js'
import type {
  IRecordIndexHandle,
  IRecordIndexProjection,
  IRecordIndexQuery
} from './secondary-index.js'
import { StorageContractErrorText } from './error-text.js'
import { observeThenableRejection } from '@migaia/utils/function'
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
    /**
     * Reads only this transaction's native index snapshot. Missing, pending or stale handles return
     * false; complete metadata must match the handle's generation and fingerprint. No index is
     * refreshed or created.
     */
    isRecordIndexReady?(handle: IRecordIndexHandle): Promise<boolean>
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
  if (typeof options === 'object' && options !== null && !Array.isArray(options)) {
    /** The ordinary option field selects one existing write policy. */
    const policy = (options as { conflictPolicy?: unknown }).conflictPolicy
    if (policy === undefined || policy === 'conflict') return 'conflict'
    if (policy === 'replace') return 'replace'
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
  readonly normalizeFailure: (error: unknown, expiredScope?: true) => ITransactionFailure
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
      fail: (error: unknown) => unknown,
      currentScope: object
    ) => Promise<IteratorResult<TResult>>,
    close?: () => void | PromiseLike<void>
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
  context: IOperationContext | undefined
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
/** Assimilate ordinary callback results through the existing native Promise machinery. */
function awaitTransactionResult<T>(result: T): Promise<Awaited<T>> {
  return Promise.resolve(result as Awaited<T>)
}
/** Captures one resource-free failure before any view loses its backend state reference. */
function expirationFailure(state: ITransactionState): ITransactionFailure {
  return (state.expiredFailure ??= state.owner.normalizeFailure(
    new Error(StorageContractErrorText.transactionInactive),
    true
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

/** Registration callbacks and context belong to the original backend scope factory. */
type ITransactionRegistrationOptions<TScope extends object> = {
  readonly createScope: () => TScope
  readonly onFailure: (error: ITransactionFailure) => void
  readonly beforeCommit?: (scope: TScope) => void | PromiseLike<void>
  readonly context?: IOperationContext
}
/** One original owner publishes finite registration methods without sharing factory locals. */
type ITransactionOwner<TBaseScope extends object> = {
  register<TScope extends TBaseScope>(
    scope: TScope,
    options: ITransactionRegistrationOptions<NoInfer<TScope>>
  ): {
    stopAdmission(): void
    runFinalizers(): Promise<void>
    closeIterators(): Promise<void>
    close(): void
  }
  registerIterator<TScope extends TBaseScope, T>(
    scope: TScope,
    port: ITransactionIteratorPort<NoInfer<TScope>, T>
  ): IStorageIterator<T>
}
/** A backend iterator supplies operations only; the existing lifetime owns draining and cleanup. */
type ITransactionIteratorPort<TScope extends object, T> = {
  readonly next: (scope: TScope) => PromiseLike<IteratorResult<T>>
  readonly close: () => void | PromiseLike<void>
}
/** Admit the initial view and create only the live context retained until transaction closure. */
function registerTransactionState<TScope extends object>(
  owner: IOwnerRegistration,
  activityMode: TransactionActivityMode,
  scope: TScope,
  options: ITransactionRegistrationOptions<TScope>
): ITransactionState {
  if (
    typeof scope !== 'object' ||
    scope === null ||
    transactionRegistrations.has(scope) ||
    typeof options.createScope !== 'function' ||
    typeof options.onFailure !== 'function' ||
    (options.beforeCommit !== undefined && typeof options.beforeCommit !== 'function')
  )
    throw invalidTransaction()
  /** This backend context spans accepted asynchronous operations and finalizer callbacks. */
  const context = snapshotOperationContext(options.context)
  /** One identity is shared by views whose lifetimes end independently. */
  const info: ITransactionInfo = { id: String(++nextTransactionId), activityMode }
  /** Only active work/resources retain callbacks; close detaches these ports. */
  const state: ITransactionState = {
    owner,
    info,
    views: new Set(),
    operations: new Set(),
    iterators: new Set(),
    userView: undefined,
    createScope: options.createScope,
    context,
    onFailure: options.onFailure,
    beforeCommit: options.beforeCommit as ITransactionState['beforeCommit'],
    checks: [],
    firstFailure: undefined,
    expiredFailure: undefined,
    finalizers: undefined,
    closingIterators: undefined,
    checksFrozen: false,
    closed: false
  }
  /** The initial callback view shares the same identity registration as every derived view. */
  const view: IViewRegistration = {
    kind: RegistrationKind.view,
    backend: owner.backend,
    info,
    state,
    expiredFailure: undefined,
    capabilities: undefined
  }
  state.userView = view
  state.views.add(view)
  transactionRegistrations.set(scope, view)
  return state
}
/** Own admission stop, final checks and terminal detachment for one actual transaction. */
class TransactionRegistration {
  /** Every operation and view still refers to this same canonical transaction context. */
  readonly #state: ITransactionState
  /** Retain the state already registered by the backend owner. */
  constructor(state: ITransactionState) {
    this.#state = state
  }
  /** Ending callback admission never cancels operations accepted by a sibling view. */
  stopAdmission = (): void => {
    if (this.#state.userView) invalidateView(this.#state.userView)
    this.#state.userView = undefined
  }
  /** Detach the accepted check list before awaiting resources so reentrancy cannot extend it. */
  runFinalizers = (): Promise<void> => {
    if (this.#state.finalizers) return this.#state.finalizers
    this.#state.checksFrozen = true
    this.stopAdmission()
    /** These accepted callbacks span the drain await; later registration is already closed. */
    const checks = this.#state.checks
    this.#state.checks = []
    this.#state.finalizers = Promise.resolve().then(() => this.#runFinalizers(checks))
    return this.#state.finalizers
  }
  /** Original check ordering and final beforeCommit share the same view/error owner. */
  async #runFinalizers(
    checks: readonly ((scope: object) => void | PromiseLike<void>)[]
  ): Promise<void> {
    await closeTransactionIterators(this.#state)
    if (this.#state.firstFailure) throw this.#state.firstFailure
    if (this.#state.closed) throw expirationFailure(this.#state)
    for (const check of checks) await runTransactionCheck(this.#state, check)
    if (this.#state.beforeCommit) await runTransactionCheck(this.#state, this.#state.beforeCommit)
  }
  /** Concurrent cleanup calls share one round; subsequent check views may own new iterators. */
  closeIterators = (): Promise<void> => {
    if (this.#state.closingIterators) return this.#state.closingIterators
    /** Cache before settlement callbacks clear only this original cleanup round. */
    const closing = closeTransactionIterators(this.#state)
    this.#state.closingIterators = closing
    void closing.then(
      () => {
        this.#state.closingIterators = undefined
      },
      () => {
        this.#state.closingIterators = undefined
      }
    )
    return closing
  }
  /** Invalidate views once and release all backend callback references after the owner settles. */
  close = (): void => {
    if (this.#state.closed) return
    this.#state.closed = true
    for (const view of this.#state.views) invalidateView(view)
    this.#state.userView = undefined
    this.#state.createScope = undefined
    this.#state.context = undefined
    this.#state.onFailure = undefined
    this.#state.beforeCommit = undefined
    this.#state.checks = []
    this.#state.operations.clear()
    this.#state.iterators.clear()
  }
}
/** One native iterator retains its exact view/port until the shared resource lifetime settles. */
class TransactionIterator<TScope extends object, T> {
  /** Live authorization is detached on cleanup while the original identity facts remain. */
  #state: ITransactionState | undefined
  /** Original view identity determines the cached inactive result after cleanup. */
  readonly #creationView: IViewRegistration
  /** Scope authority is borrowed only for accepted advances and is released with the port. */
  #scope: TScope | undefined
  /** The backend owns next/close; this owner releases its references after cleanup. */
  #port: ITransactionIteratorPort<TScope, T> | undefined
  /** Only the canonical iterator lifetime drains accepted advances and caches cleanup promises. */
  readonly #lifetime: ReturnType<typeof createStorageIteratorLifetime<T>>
  /** Private registration is also the transaction's active cleanup entry. */
  readonly #registration: IIteratorRegistration
  /** This exact published object is the sole iterator identity registered in the owner table. */
  readonly iterator: IStorageIterator<T>
  /** Admit one live original scope before exposing any iterator method. */
  constructor(
    owner: TransactionOwner<TScope>,
    registration: IOwnerRegistration,
    scope: TScope,
    port: ITransactionIteratorPort<TScope, T>
  ) {
    this.#creationView = transactionView(scope)
    this.#state = this.#creationView.state
    if (
      !this.#state ||
      this.#state.owner !== registration ||
      this.#state.closed ||
      this.#state.firstFailure ||
      typeof port.next !== 'function' ||
      typeof port.close !== 'function'
    )
      throw invalidTransaction()
    this.#scope = scope
    this.#port = port
    this.#lifetime = createStorageIteratorLifetime<T>({
      close: () => this.#close(),
      report: reportTransactionFailure,
      onSettled: () => this.#settled()
    })
    this.#registration = {
      kind: RegistrationKind.iterator,
      info: this.#state.info,
      advance: (currentScope) => this.#advance(currentScope as TScope),
      cleanup: this.#lifetime.dispose,
      compose: (run) => (this.#scope ? runTransactionOperation(this.#scope, run) : run(undefined)),
      derive: (read, closeExtra) => this.#derive(owner, read, closeExtra),
      fail: (error) => this.#fail(error)
    }
    this.iterator = {
      next: () => this.#next(),
      return: this.#lifetime.returned,
      dispose: this.#lifetime.dispose,
      [registration.asyncDisposeKey]: this.#lifetime.symbolic,
      [Symbol.asyncIterator]() {
        return this
      }
    }
    transactionRegistrations.set(this.iterator, this.#registration)
    this.#state.iterators.add(this.#registration)
  }
  /** Capture and release the original close port before awaiting native resource cleanup. */
  async #close(): Promise<void> {
    /** Reentrant cleanup cannot invoke a captured backend close twice. */
    const port = this.#port
    this.#port = undefined
    if (port)
      try {
        await awaitTransactionResult(port.close())
      } catch (error) {
        throw failTransaction(this.#state!, error)
      }
  }
  /** Actual settlement releases the context, backend port and creation scope together. */
  #settled(): void {
    this.#state?.iterators.delete(this.#registration)
    this.#state = undefined
    this.#port = undefined
    this.#scope = undefined
  }
  /** Each advance borrows the original owner's fresh operation view and complete drain path. */
  #advance(scope: TScope): Promise<IteratorResult<T>> {
    return this.#lifetime.advance(() =>
      runTransactionOperation(scope, (current) => {
        if (this.#lifetime.isClosing() || !this.#port)
          return { done: true, value: undefined } as IteratorResult<T>
        return this.#port.next(current)
      })
    )
  }
  /** Expired original views retain their cached backend failure rather than reviving a scope. */
  #next(): Promise<IteratorResult<T>> {
    return this.#scope
      ? this.#advance(this.#scope)
      : this.#creationView.state
        ? Promise.resolve({ done: true, value: undefined })
        : rejectedTransactionResult(this.#creationView.expiredFailure)
  }
  /** The first data failure reaches the original transaction before cleanup can fail. */
  #fail(error: unknown): unknown {
    return this.#state ? (this.#state.firstFailure ?? failTransaction(this.#state, error)) : error
  }
  /** A derived reader is another real resource of this owner, using the original iterator port. */
  #derive<TResult>(
    owner: TransactionOwner<TScope>,
    read: (
      next: () => Promise<IteratorResult<unknown>>,
      fail: (error: unknown) => unknown,
      scope: object
    ) => Promise<IteratorResult<TResult>>,
    closeExtra?: () => void | PromiseLike<void>
  ): IStorageIterator<TResult> {
    if (!this.#scope) throw invalidTransaction()
    /** Derived cleanup must retain this original context even after the source naturally exhausts. */
    const state = this.#state!
    return owner.registerIterator(this.#scope, {
      next: (scope) =>
        read(() => nextTransactionIterator(scope, this.iterator), this.#registration.fail, scope),
      close:
        closeExtra === undefined
          ? this.#lifetime.dispose
          : () => this.#closeDerived(state, closeExtra)
    })
  }
  /** Reverse-order additional-source cleanup attempts both ports and retains every failure. */
  async #closeDerived(
    state: ITransactionState,
    closeExtra: () => void | PromiseLike<void>
  ): Promise<void> {
    /** Only this close round's secondary failures are aggregated after the primary. */
    const errors: unknown[] = []
    try {
      await awaitTransactionResult(closeExtra())
    } catch (error) {
      errors.push(failTransaction(state, error))
    }
    try {
      await this.#lifetime.dispose()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length > 0) throw cleanupFailure(state, errors)
  }
}
/** Each backend store has one canonical owner; registration never duplicates native resources. */
class TransactionOwner<TBaseScope extends object> implements ITransactionOwner<TBaseScope> {
  /** One record proves store authority for every scope and resource published by this owner. */
  readonly #registration: IOwnerRegistration
  /** Activity is fixed before any transaction receives its identity. */
  readonly #activityMode: TransactionActivityMode
  /** Validate the real store definition before publishing registration authority. */
  constructor(
    store: IStorageBase,
    normalizeFailure: (error: unknown, expiredScope?: true) => ITransactionFailure,
    options?: {
      readonly activityMode?: TransactionActivityMode
      readonly asyncDisposeKey?: typeof Symbol.asyncDispose
      readonly defaultPolicy?: IConcurrencyPolicy
      readonly concurrencyStages?: IConcurrencyStageObserver
    }
  ) {
    this.#activityMode = options?.activityMode ?? TransactionActivityMode.managed
    /** The caller supplies its original symbol; no alternate lifetime owner is created. */
    const asyncDisposeKey: typeof Symbol.asyncDispose =
      options?.asyncDisposeKey ?? Symbol.asyncDispose
    if (
      typeof normalizeFailure !== 'function' ||
      typeof asyncDisposeKey !== 'symbol' ||
      (this.#activityMode !== TransactionActivityMode.managed &&
        this.#activityMode !== TransactionActivityMode.native)
    )
      throw invalidTransaction()
    if (options?.defaultPolicy !== undefined) assertConcurrencyPolicy(options.defaultPolicy)
    if (
      options?.concurrencyStages !== undefined &&
      options.concurrencyStages.kind !== StorageStageKind.concurrency
    )
      throw invalidTransaction()
    /** Default policy belongs to this one original store initialization. */
    const defaultPolicy = options?.defaultPolicy ?? ConcurrencyPolicy.wait()
    /** Non-owning admission grants neither data nor close authority to this definition layer. */
    const base = snapshotStorageBaseDetailed(store, { asyncDisposeKey })
    if (!base.valid || transactionRegistrations.has(store))
      throw invalidTransaction(base.valid ? undefined : base.cause)
    this.#registration = {
      kind: RegistrationKind.owner,
      store,
      backend: base.backend,
      normalizeFailure,
      asyncDisposeKey,
      defaultPolicy,
      concurrencyStages: options?.concurrencyStages
    }
    transactionRegistrations.set(store, this.#registration)
  }
  /** Register initial callback admission under this owner's existing state and identity table. */
  register = <TScope extends TBaseScope>(
    scope: TScope,
    options: ITransactionRegistrationOptions<NoInfer<TScope>>
  ): TransactionRegistration => {
    return new TransactionRegistration(
      registerTransactionState(this.#registration, this.#activityMode, scope, options)
    )
  }
  /** Publish one actual iterator while preserving its backend-specific scope refinement. */
  registerIterator = <TScope extends TBaseScope, T>(
    scope: TScope,
    port: ITransactionIteratorPort<NoInfer<TScope>, T>
  ): IStorageIterator<T> => {
    return new TransactionIterator(
      this as unknown as TransactionOwner<TScope>,
      this.#registration,
      scope,
      port
    ).iterator
  }
}
/** Initialize the sole store owner before the original backend base is published. */
export function createTransactionOwner<
  TValue = unknown,
  TBaseScope extends object = Omit<ITransactionScope<TValue>, 'use'>
>(
  store: IStorageBase,
  normalizeFailure: (error: unknown, expiredScope?: true) => ITransactionFailure,
  options?: {
    readonly activityMode?: TransactionActivityMode
    readonly asyncDisposeKey?: typeof Symbol.asyncDispose
    readonly defaultPolicy?: IConcurrencyPolicy
    readonly concurrencyStages?: IConcurrencyStageObserver
  }
): ITransactionOwner<TBaseScope> {
  return new TransactionOwner(store, normalizeFailure, options)
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
    fail: (error: unknown) => unknown,
    currentScope: object | undefined
  ) => Promise<TResult>,
  currentScope?: object
): Promise<TResult> {
  /** Only the existing actual iterator record can provide original transaction authority. */
  const resource = transactionRegistrations.get(iterator)
  if (resource?.kind !== RegistrationKind.iterator)
    return run(
      () => iterator.next(),
      (error) => error,
      currentScope
    )
  /**
   * A nested reader borrows its already active parent view; original identity checks stay
   * authoritative.
   */
  if (currentScope !== undefined)
    return run(() => nextTransactionIterator(currentScope, iterator), resource.fail, currentScope)
  return resource.compose((scope) =>
    run(
      scope === undefined ? () => iterator.next() : () => nextTransactionIterator(scope, iterator),
      resource.fail,
      scope
    )
  )
}

/**
 * Projects one query read through the original iterator owner. The existing registration alone
 * supplies scope admission, accepted-next draining and cached cleanup; no second lifecycle exists.
 * read receives the actual current operation view; retaining it never extends its lifetime.
 * Optional additional-source close runs before original-source cleanup, and both are attempted on
 * failure. Unregistered source resources retain their own native iterator contract and return
 * undefined.
 */
export function deriveTransactionIterator<T, TResult>(
  iterator: IStorageIterator<T>,
  read: (
    next: () => Promise<IteratorResult<T>>,
    fail: (error: unknown) => unknown,
    currentScope: object
  ) => Promise<IteratorResult<TResult>>,
  close?: () => void | PromiseLike<void>
): IStorageIterator<TResult> | undefined {
  /** Only an original actual registration can create a resource in that same scope. */
  const resource = transactionRegistrations.get(iterator)
  if (resource?.kind !== RegistrationKind.iterator) return undefined
  if (typeof read !== 'function' || (close !== undefined && typeof close !== 'function'))
    throw invalidTransaction()
  return resource.derive(
    read as (
      next: () => Promise<IteratorResult<unknown>>,
      fail: (error: unknown) => unknown,
      currentScope: object
    ) => Promise<IteratorResult<TResult>>,
    close
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

/**
 * Reads the original backend attempt's context from an authentic live view. Every user, operation
 * and finalizer view shares the same snapshot and original signal. Omitted registration context
 * returns undefined; forged or expired views throw INVALID_ARGUMENT. This grants no registration,
 * cancellation-controller, budget or close authority.
 */
export function readTransactionOperationContext(scope: object): IOperationContext | undefined {
  /** Identity and lifetime use the same private view record as transaction composition. */
  const state = transactionView(scope).state
  if (!state || state.closed || state.firstFailure) throw invalidTransaction()
  return state.context
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
/** Executes one projected method with the original owner's exact authenticated operation view. */
function runTransactionCapabilityMethod(
  scope: object,
  capability: IAnyStorageCapability,
  method: string,
  args: readonly unknown[]
): Promise<unknown> {
  return runTransactionOperation(scope, (operationScope) => {
    /** Re-read publication authority rather than retaining an installation after Feature release. */
    const { binding } = liveTransactionCapability(operationScope, capability)
    /** Only the current operation view reaches backend binding; old views are never reused. */
    const api = (binding as unknown as { forTransaction(scope: object): unknown }).forTransaction(
      operationScope
    )
    if (typeof api !== 'object' || api === null) throw invalidTransaction()
    /** Borrow one actual native method and preserve its API receiver and returned value. */
    const execute = (api as Record<string, unknown>)[method]
    if (typeof execute !== 'function') throw invalidTransaction()
    return (api as Record<string, (...args: readonly unknown[]) => unknown>)[method]!(...args)
  })
}
/** Fresh native SQL binding runs only inside the original accepted operation and its budget. */
function runTransactionSqlQuery(
  scope: object,
  capability: IAnyStorageCapability,
  fragment: ISqlQuery,
  method: (typeof SqlQueryMethod)[keyof typeof SqlQueryMethod]
): Promise<unknown> {
  return runTransactionOperation(scope, (operationScope) => {
    /** Binding authority is re-read for every terminal, including a saved derived query. */
    const { binding } = liveTransactionCapability(operationScope, capability)
    /** The actual backend tag receives the new full operation view, never the old constructor view. */
    const native = (
      binding as unknown as { forTransaction(scope: object): unknown }
    ).forTransaction(operationScope) as ISqlExecutor
    /** One fragment reference reuses captured nodes and bytes without rereading caller input. */
    const query = native.sql`${fragment}`
    return query[method]()
  })
}
/** Pure SQL composition retains its fragment owner; terminals acquire no independent lifetime. */
function transactionSqlTag(
  scope: object,
  capability: IAnyStorageCapability,
  root: ISqlExecutor
): ISqlTag {
  /** Capture the published pure constructor and tools without entering a binder or native call. */
  const original = root.sql
  /** No SQL text or fragment is compiled during capability lookup or query construction. */
  const empty = original.empty
  /** Construction only captures the original graph; every data terminal enters the same owner. */
  const tag = (strings: TemplateStringsArray, ...values: readonly ISqlInput[]) => {
    /** An expired saved tag cannot construct another transaction-bound operation. */
    const { state } = liveTransactionCapability(scope, capability)
    try {
      /** The root tag supplies pure composition only; its execution callbacks are never selected. */
      const fragment = root.sql(strings, ...values) as ISqlQuery
      return deriveStorageSqlQuery(fragment, {
        all: () =>
          runTransactionSqlQuery(scope, capability, fragment, SqlQueryMethod.all) as ReturnType<
            ISqlQuery['all']
          >,
        get: () =>
          runTransactionSqlQuery(scope, capability, fragment, SqlQueryMethod.get) as ReturnType<
            ISqlQuery['get']
          >,
        run: () =>
          runTransactionSqlQuery(scope, capability, fragment, SqlQueryMethod.run) as ReturnType<
            ISqlQuery['run']
          >
      })
    } catch (error) {
      throw failTransaction(state, error)
    }
  }
  return Object.assign(tag, {
    id: (...parts: readonly [string, ...string[]]) => original.id(...parts),
    join: (...args: Parameters<ISqlTag['join']>) => original.join(...args),
    empty
  }) as ISqlTag
}
/** Complete read terminals enter the original operation before validation, execution and cleanup. */
function transactionQueryReads<R>(scope: object, query: IQueryResult<R, undefined>) {
  /** Only business arguments cross this zero-context projection; stream retains its iterator owner. */
  const methods = [
    [RecordQueryMethod.all, 0],
    [RecordQueryMethod.first, 0],
    [RecordQueryMethod.maybe, 0],
    [RecordQueryMethod.firstOrThrow, 0],
    [RecordQueryMethod.pluck, 1],
    [RecordQueryMethod.exists, 0],
    [RecordQueryMethod.count, 0],
    [RecordQueryMethod.each, 1],
    [RecordQueryMethod.chunk, 2],
    [RecordQueryMethod.min, 1],
    [RecordQueryMethod.max, 1],
    [RecordQueryMethod.sum, 1],
    [RecordQueryMethod.avg, 1],
    [RecordQueryMethod.page, 1]
  ] as const
  /** These wrappers borrow the immutable query rather than copying its nodes or owning execution. */
  const reads: Record<string, unknown> = {}
  for (const [method, argumentCount] of methods)
    reads[method] = (...args: readonly unknown[]) =>
      runTransactionOperation(scope, () =>
        (query as unknown as Record<string, (...values: readonly unknown[]) => unknown>)[method]!(
          ...args.slice(0, argumentCount)
        )
      )
  return reads as Pick<IQueryResult<R, undefined>, (typeof methods)[number][0]>
}
/** Actual family writes enter the same original operation before validation or draft access. */
function transactionQueryWrites(scope: object, query: object): Record<string, unknown> {
  /** Only actual family write methods are wrapped; selected read results never enter this helper. */
  const writes: Record<string, unknown> = {}
  for (const [name, argumentCount] of [
    [RecordQueryMethod.delete, 0],
    [RecordQueryMethod.update, 1],
    [RdfQueryMethod.replace, 2]
  ] as const) {
    /** The original method and receiver remain fixed across the borrowed transaction view. */
    const method = Reflect.get(query, name)
    if (typeof method === 'function')
      writes[name] = (...args: readonly unknown[]) =>
        runTransactionOperation(scope, () =>
          (query as Record<string, (...values: readonly unknown[]) => unknown>)[name]!(
            ...args.slice(0, argumentCount)
          )
        )
  }
  return writes
}
/** Adds original-owner admission to the actual selected chain without copying its nodes or plan. */
function transactionQueryResult<R>(
  scope: object,
  query: IQueryResult<R, undefined>
): IQueryResult<R, undefined> {
  return {
    ...query,
    ...transactionQueryReads(scope, query),
    explain: () => query.explain(),
    requirePushdown: () => transactionQueryResult(scope, query.requirePushdown())
  }
}
/**
 * Rewraps only real pure branch constructors. Each returned chain keeps its original method state,
 * while the original terminal wrapper remains responsible for transaction operation admission.
 */
function transactionQueryBranches<TQuery extends IQueryResult<unknown, undefined>>(
  query: TQuery,
  names: readonly string[],
  project: (query: TQuery) => TQuery
): Record<string, unknown> {
  /** The finite result contains functions only, without a query registry, plan or lifecycle state. */
  const branches: Record<string, unknown> = {}
  for (const name of names) {
    /** Canonical immutable query constructors are captured once with their original receiver. */
    const method = Reflect.get(query, name)
    if (typeof method === 'function')
      branches[name] = (...args: readonly unknown[]) =>
        project(
          (query as unknown as Record<string, (...values: readonly unknown[]) => TQuery>)[name]!(
            ...args
          )
        )
  }
  return branches
}
/** Pure controls common to record and RDF queries keep their original family state after branching. */
const transactionQueryBranchMethods = [
  RecordQueryMethod.where,
  RecordQueryMethod.limit,
  RecordQueryMethod.skip,
  RecordQueryMethod.distinct,
  RecordQueryMethod.orderBy,
  RecordQueryMethod.after
] as const
/** Preserves the actual immutable query and every typed branch; only terminal admission is added. */
function transactionRecordQuery<TQuery extends IQueryResult<unknown, undefined>>(
  scope: object,
  query: TQuery
): TQuery {
  /** Original selector/comparator type states are retained by projecting the exact returned chain. */
  const branches = transactionQueryBranches(query, transactionQueryBranchMethods, (next) =>
    transactionRecordQuery(scope, next)
  )
  /** Only comparator-capable states expose this original bounded transition. */
  const comparator = Reflect.get(query, RecordQueryMethod.orderByComparator)
  if (typeof comparator === 'function')
    branches.orderByComparator = (compare: (left: unknown, right: unknown) => number) => {
      /** Comparator admission remains pure and keeps its one original immediate-bound protocol. */
      const pending = (
        query as unknown as {
          orderByComparator(compare: (left: unknown, right: unknown) => number): unknown
        }
      ).orderByComparator(compare) as {
        first(): Promise<unknown>
        limit(count: number): IQueryResult<unknown, undefined>
      }
      return {
        first: () => runTransactionOperation(scope, () => pending.first()),
        limit: (count: number) => transactionRecordQuery(scope, pending.limit(count))
      }
    }
  return {
    ...query,
    ...transactionQueryReads(scope, query),
    ...branches,
    ...transactionQueryWrites(scope, query),
    select: (...args: readonly unknown[]) =>
      transactionQueryResult(
        scope,
        (
          query as unknown as {
            select(...args: readonly unknown[]): IQueryResult<unknown, undefined>
          }
        ).select(...args)
      ),
    explain: () => query.explain(),
    requirePushdown: (): IQueryResult<unknown, undefined> =>
      transactionRecordQuery(scope, query.requirePushdown())
  } as TQuery
}
/** RDF branches reuse the same original node constructors and complete read admission table. */
function transactionRdfQuery(scope: object, query: IRdfQuery<undefined>): IRdfQuery<undefined> {
  return {
    ...query,
    ...transactionQueryReads(scope, query),
    ...transactionQueryWrites(scope, query),
    ...transactionQueryBranches(
      query,
      [...transactionQueryBranchMethods, RdfQueryMethod.follow, RdfQueryMethod.inverse],
      (next) => transactionRdfQuery(scope, next)
    ),
    select: (...args: readonly unknown[]) =>
      transactionQueryResult(
        scope,
        (
          query as unknown as {
            select(...args: readonly unknown[]): IQueryResult<unknown, undefined>
          }
        ).select(...args)
      ),
    explain: () => query.explain(),
    requirePushdown: () => transactionRdfQuery(scope, query.requirePushdown())
  } as IRdfQuery<undefined>
}
/**
 * Reads the original store capability table from an authentic view. Pure lookup invokes no binder
 * or I/O. Cached finite projections keep only this view/token identity; invalidation clears them.
 * Data calls still enter the original operation owner; record query construction remains pure and
 * its authentic backend source supplies the existing iterator/complete-terminal ownership.
 */
export function useTransactionCapability<
  TScope extends { use: (...args: never[]) => unknown },
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
  /** Projection facts remain on the authentic token row, outside the backend binder receiver. */
  const transaction = readCapabilityTokenFacts(capability)!.transaction!
  if (transaction.query) {
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
        const bound = (
          binding as unknown as { forTransaction(scope: object): unknown }
        ).forTransaction(scope)
        if (typeof bound !== 'object' || bound === null) throw invalidTransaction()
        /** One borrowed constructor keeps the actual shared chain and its source receiver intact. */
        const query = (bound as Record<string, unknown>).query
        if (typeof query !== 'function') throw invalidTransaction()
        return transactionRecordQuery(
          scope,
          (bound as { query(): IQueryResult<unknown, undefined> }).query()
        )
      } catch (error) {
        throw failTransaction(state, error)
      }
    }
    api.removeByPrefix = (prefix: IStorageKey) =>
      runTransactionCapabilityMethod(scope, capability, StorageCapabilityMethod.removeByPrefix, [
        prefix
      ])
  }
  if (transaction.rdf)
    api.match = (pattern: Partial<IQuad>) => {
      /** Pure construction binds the actual native scope without registering another owner. */
      const { state, binding } = liveTransactionCapability(scope, capability)
      try {
        /** The backend supplies its real ground query source and original iterator registration. */
        const bound = (
          binding as unknown as { forTransaction(scope: object): unknown }
        ).forTransaction(scope)
        if (typeof bound !== 'object' || bound === null) throw invalidTransaction()
        /** One native match lookup preserves receiver and canonical pattern capture. */
        const match = (bound as Record<string, unknown>).match
        if (typeof match !== 'function') throw invalidTransaction()
        return transactionRdfQuery(
          scope,
          (bound as { match(pattern: Partial<IQuad>): IRdfQuery<undefined> }).match(pattern)
        )
      } catch (error) {
        throw failTransaction(state, error)
      }
    }
  if (transaction.sql)
    api.sql = transactionSqlTag(scope, capability, binding.implementation.api as ISqlExecutor)
  /** Standard scalar methods use the original fresh-view operation path, without token imports. */
  for (const method of transaction.methods)
    api[method] = (...args: readonly unknown[]) =>
      runTransactionCapabilityMethod(
        scope,
        capability,
        method,
        transaction.rdf ? args.slice(0, 1) : args
      )
  /** Cache only the projection identity; the original backend scope and API remain borrowed. */
  ;(view.capabilities ??= new Map()).set(capability, {
    implementation: binding.implementation,
    api
  })
  return api as TCap extends typeof records
    ? ITransactionRecordsApi<IScopeRecordValue<TScope>>
    : ITransactionCapabilityApi<TCap>
}

/** One accepted operation owns its public result and fresh view until actual settlement. */
class TransactionOperation<TScope extends object, TResult> {
  /** Only the original registered transaction owns admission and failure attribution. */
  readonly #state: ITransactionState
  /** This operation's view is invalidated at settlement, never the accepted sibling views. */
  #view: IViewRegistration | undefined
  /** Resolve the exact public Promise already inserted into the owner's active set. */
  #resolve!: (value: Awaited<TResult>) => void
  /** Reject that same Promise with the first backend-normalized failure. */
  #reject!: (error: unknown) => void
  /** Public identity stays stable while this operation drains or triggers rollback. */
  readonly result: Promise<Awaited<TResult>>
  /** Admission is synchronous so native transaction requests start in their original active window. */
  constructor(state: ITransactionState, run: (scope: TScope) => TResult) {
    this.#state = state
    this.result = new Promise((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
    state.operations.add(this.result)
    this.#execute(run)
    void this.result.then(undefined, () => undefined)
  }
  /** Ordinary Promise assimilation observes asynchronous work; plain values settle immediately. */
  #execute(run: (scope: TScope) => TResult): void {
    try {
      if (typeof run !== 'function') throw invalidTransaction()
      /** Native extensions remain on their original complete backend factory result. */
      const created = createTransactionView(this.#state)
      this.#view = created.view
      /** User work starts only after its public result occupies the active set. */
      const value = run(created.scope as TScope)
      if (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof (value as { then?: unknown }).then === 'function'
      )
        void Promise.resolve(value).then(
          (settled) => this.#finish(settled as Awaited<TResult>),
          (error) => this.#finish(undefined, error, true)
        )
      else this.#finish(value as Awaited<TResult>)
    } catch (error) {
      this.#finish(undefined, error, true)
    }
  }
  /** Both result paths release only this view and active-set entry before settling the caller. */
  #finish(value: Awaited<TResult> | undefined, error?: unknown, failed = false): void {
    if (this.#view) invalidateView(this.#view)
    this.#state.operations.delete(this.result)
    if (failed) this.#reject(failTransaction(this.#state, error))
    else this.#resolve(value as Awaited<TResult>)
  }
}
/** Admit composed work through the original private view registration before invoking user code. */
export function runTransactionOperation<TScope extends object, TResult>(
  scope: TScope,
  run: (operationScope: TScope) => TResult
): Promise<Awaited<TResult>> {
  /** Forged identities still fail synchronously; authentic expired calls retain backend rejection. */
  const view = transactionView(scope)
  if (!view.state) return rejectedTransactionResult<Awaited<TResult>>(view.expiredFailure)
  return new TransactionOperation(view.state, run).result
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

// Transaction state, registrations, iterators and owners for the transaction SDK (see ./transaction.ts).
import {
  type ITransactionScope,
  TransactionActivityMode,
  type ITransactionInfo,
  type IAnyStorageCapability,
  assertConcurrencyPolicy,
  type IConcurrencyPolicy,
  type IConcurrencyStageObserver,
  StorageStageKind,
  type IOperationContext,
  type IStorageBase,
  type IStorageIterator,
  StorageContractErrorText,
  StorageContractError,
  StorageContractErrorCode
} from '@migaia/storage-contract'
import { ConcurrencyPolicy } from './concurrency.js'
import { snapshotOperationContext } from './context.js'
import { snapshotStorageBaseDetailed } from './store.js'
import { createStorageIteratorLifetime } from './resource.js'
import { observeThenableRejection } from '@migaia/utils/function'
import { runTransactionOperation, nextTransactionIterator } from './transaction.js'

/** Backend normalization is the only owner of transaction failure source, code and topology. */
type ITransactionFailure = Error & { readonly source: string; readonly code: string }

/** Private registration kinds never authorize an object based on public fields. */
export const RegistrationKind = { owner: 'owner', view: 'view', iterator: 'iterator' } as const

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
export type IViewRegistration = {
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
export type ITransactionState = {
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
export const transactionRegistrations = new WeakMap<
  object,
  IOwnerRegistration | IViewRegistration | IIteratorRegistration
>()

/** A monotonic arbitrary-width identity has no runtime or host dependency. */
let nextTransactionId = 0n

/** Builds the registered contract argument boundary without leaking resource payloads. */
export function invalidTransaction(cause?: unknown): StorageContractError {
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
export function invalidateView(view: IViewRegistration): void {
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
export function failTransaction(state: ITransactionState, error: unknown): ITransactionFailure {
  /** Idempotent backend normalization preserves already-coded native or backend error identity. */
  const failure =
    state.firstFailure && error === state.firstFailure
      ? state.firstFailure
      : state.owner.normalizeFailure(error)
  if (!state.firstFailure) {
    state.firstFailure = failure
    for (const view of state.views) invalidateView(view)
    /** The optional backend callback reports the original failure without replacement authority. */
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
export function rejectedTransactionResult<T>(failure: ITransactionFailure | undefined): Promise<T> {
  /** The backend already retained and reported this failure through its original owner. */
  const result = Promise.reject<T>(failure)
  void result.then(undefined, () => undefined)
  return result
}

/** Looks up authentic view identity; expired data calls are treated separately by their caller. */
export function transactionView(scope: object): IViewRegistration {
  /** Public shape and method names cannot substitute for private registration. */
  const registration = transactionRegistrations.get(scope)
  if (registration?.kind !== RegistrationKind.view) throw invalidTransaction()
  return registration
}

/** Registers a fresh complete backend method factory result under the same real transaction. */
export function createTransactionView(state: ITransactionState): {
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
  if (typeof scope !== 'object' || scope === null || transactionRegistrations.has(scope))
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
      this.#state.firstFailure
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
      this.#activityMode !== TransactionActivityMode.managed &&
      this.#activityMode !== TransactionActivityMode.native
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

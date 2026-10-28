import {
  createRuntime,
  ReactiveErrorPhase,
  type IDisposable,
  type IDisposer,
  type IRuntime
} from '@migaia/reactive'
import { claimOwnership, ownerOf } from '@migaia/reactive/extension'
import {
  containAsyncRejection,
  createSyncStartedDisposalLedger,
  mergeCleanupResults,
  type ICollectedError,
  type ISyncStartedDisposalOutcome,
  type ISyncStartedDisposalLedger,
  LifecycleState,
  type ILifecycleState
} from '@migaia/lifecycle'
import { createAtomStore, type IAtomStore } from '@migaia/store-keyed/atom/store'
import {
  createStoreReactAggregateError,
  createStoreReactError,
  identifyRegistryDisposalFailure
} from './errors.ts'
import { StoreReactErrorCode } from './error-code.ts'
import { StoreReactErrorText } from './error-text.ts'
import { snapshotOwnDescriptors } from '@migaia/utils/object'

const STORE_TOKEN_VALUE = Symbol('store-token-value')

/**
 * Routes registry lifecycle failures to the Runtime reporter, which already contains reporter
 * failures.
 */
function reportRegistryFailure(runtime: IRuntime, error: unknown): void {
  runtime.reportError(identifyRegistryDisposalFailure(error), {
    phase: ReactiveErrorPhase.lifecycleHook
  })
}

/** Typed immutable key shared by registration and synchronous lookup within a registry. */
export type IStoreToken<T> = Readonly<{
  /** Unique symbol used for registration; equal debug labels do not make tokens interchangeable. */
  key: symbol
  /** Human-readable error label, not a lookup key. */
  debugName: string
  /** Type-only value association; factory-created tokens contain no runtime payload here. */
  readonly [STORE_TOKEN_VALUE]?: (value: T) => T
}>

/** Explicit per-registration cleanup ownership; ordinary registration borrows its value. */
export type IStoreRegistrationOptions = {
  /** Defaults to false; true releases this entry through $dispose, or dispose when absent. */
  readonly owned?: boolean
}

/** Rejects null/non-object registration options before reading ownership flags. */
function readRegistrationOwned(options: unknown, fallback: boolean): boolean {
  if (options === null || typeof options !== 'object')
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      StoreReactErrorText.optionsObject
    )
  const descriptorSnapshot = snapshotOwnDescriptors(options)
  if (!descriptorSnapshot.ok) {
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      StoreReactErrorText.optionsObject,
      { cause: descriptorSnapshot.error }
    )
  }
  try {
    const owned = 'owned' in options ? options.owned : undefined
    if (owned !== undefined && typeof owned !== 'boolean') {
      throw createStoreReactError(
        StoreReactErrorCode.invalidConfig,
        StoreReactErrorText.ownedOption
      )
    }
    return owned ?? fallback
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      StoreReactErrorText.ownedOption,
      { cause: error }
    )
  }
}

type IRegistryEntry = {
  readonly value: unknown
  readonly owned: boolean
}

/**
 * Create a frozen typed token with a fresh symbol. debugName must be a nonempty string or
 * INVALID_CONFIG is thrown; reuse this exact token for both registration and lookup.
 */
export function createStoreToken<T>(debugName: string): IStoreToken<T> {
  if (typeof debugName !== 'string' || debugName.length === 0) {
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      StoreReactErrorText.tokenDebugName
    )
  }
  return Object.freeze({
    key: Symbol(debugName),
    debugName
  })
}

/**
 * Runtime-bound token registry and isolated atom store for a Provider or explicit SSR request
 * scope. Registered values are borrowed unless marked owned. Registration lookups are synchronous
 * rather than reactive; owned cleanup and atom-store retirement belong to the registry, not its
 * Runtime.
 */
export class StoreRegistry implements IDisposable {
  /** Selected Runtime; even a registry-created Runtime is not disposed by registry cleanup. */
  readonly runtime: IRuntime
  /** Provider-local atom state/override boundary. Same Runtime may host many registries. */
  readonly atomStore: IAtomStore
  /** Values and ownership flags admitted before disposal starts. */
  #entries = new Map<symbol, IRegistryEntry>()
  /** Committed Provider retainers participating in delayed release. */
  #retainCount = 0
  /** Invalidates a scheduled zero-owner release after a later retain/dispose. */
  #lifecycleGeneration = 0
  /** Lifecycle-owned pending/error/completion truth for the whole registry disposal plan. */
  #disposalLedger: ISyncStartedDisposalLedger = createSyncStartedDisposalLedger()
  /** Published before cleanup callbacks; also closes registry admission during ledger plan assembly. */
  #disposingAsync: Promise<void> | undefined

  /** Create an isolated atom store in the supplied Runtime, or a fresh Runtime when omitted. */
  constructor(runtime: IRuntime = createRuntime()) {
    this.runtime = runtime
    this.atomStore = createAtomStore(runtime)
    claimOwnership(this, runtime)
  }

  /** Part of the project's unified lifecycle shape (see `@migaia/lifecycle`'s `ILifecycleState`). */
  get lifecycle(): ILifecycleState {
    if (this.#disposingAsync && this.#disposalLedger.lifecycle === LifecycleState.open)
      return LifecycleState.closing
    return this.#disposalLedger.lifecycle
  }

  /**
   * Resolves once this registry (and any thenable disposer results) has actually finished tearing
   * down.
   */
  whenTerminal(): Promise<void> {
    return this.#disposalLedger.whenTerminal()
  }

  /** True from closing onward, before asynchronous owned cleanup has necessarily settled. */
  get disposed(): boolean {
    return this.lifecycle !== LifecycleState.open
  }

  /**
   * Register one token, defaulting owned to false. Duplicate token, foreign Runtime ownership and
   * closed-registry admission reject. The returned idempotent disposer removes only this entry;
   * owned cleanup starts synchronously, with later rejection reported rather than awaited.
   */
  register<T>(token: IStoreToken<T>, value: T, options: IStoreRegistrationOptions = {}): IDisposer {
    this.#assertActive()
    const owned = readRegistrationOwned(options, false)
    this.#assertRuntime(token, value)
    if (this.#entries.has(token.key)) {
      throw createStoreReactError(
        StoreReactErrorCode.storeDuplicate,
        StoreReactErrorText.duplicateToken(token.debugName)
      )
    }
    const entry: IRegistryEntry = {
      value,
      owned
    }
    this.#entries.set(token.key, entry)
    return () => {
      if (this.#entries.get(token.key) === entry) {
        this.#entries.delete(token.key)
        if (entry.owned) this.#disposeValueObserved(entry.value)
      }
    }
  }

  /**
   * Publish a new entry, defaulting owned to false, then release a different previously owned
   * value. An old registration disposer cannot remove this replacement. Cleanup failure does not
   * restore the old entry; asynchronous cleanup is reported and not added to whole-registry
   * completion.
   */
  replace<T>(token: IStoreToken<T>, value: T, options: IStoreRegistrationOptions = {}): void {
    this.#assertActive()
    const owned = readRegistrationOwned(options, false)
    this.#assertRuntime(token, value)
    const previous = this.#entries.get(token.key)
    this.#entries.set(token.key, {
      value,
      owned
    })
    if (previous?.owned && previous.value !== value) {
      this.#disposeValueObserved(previous.value)
    }
  }

  /**
   * Read a registered value or undefined; use has to distinguish an explicitly registered
   * undefined.
   */
  get<T>(token: IStoreToken<T>): T | undefined {
    this.#assertActive()
    return this.#entries.get(token.key)?.value as T | undefined
  }

  /** Read a registered value or throw STORE_MISSING; registry closure throws REGISTRY_DISPOSED. */
  require<T>(token: IStoreToken<T>): T {
    this.#assertActive()
    const entry = this.#entries.get(token.key)
    if (!entry) {
      throw createStoreReactError(
        StoreReactErrorCode.storeMissing,
        StoreReactErrorText.missingStore(token.debugName)
      )
    }
    return entry.value as T
  }

  /** Test exact token membership while open, without creating a reactive dependency. */
  has<T>(token: IStoreToken<T>): boolean {
    this.#assertActive()
    return this.#entries.has(token.key)
  }

  /**
   * Remove a token and return whether it existed. By default start owned cleanup; false detaches
   * without disposing. Later cleanup rejection is reported, not awaited by disposeAsync.
   */
  remove<T>(token: IStoreToken<T>, disposeOwned = true): boolean {
    this.#assertActive()
    const entry = this.#entries.get(token.key)
    if (!entry) return false
    this.#entries.delete(token.key)
    if (disposeOwned && entry.owned) this.#disposeValueObserved(entry.value)
    return true
  }

  /**
   * Retain a committed Provider and return an idempotent release. If this release requests disposal
   * and leaves no retainers, schedule a task to recheck the count/generation before disposing. A
   * newer retain cancels that scheduled retirement, including StrictMode effect replay.
   */
  retain(disposeOnRelease: boolean): IDisposer {
    this.#assertActive()
    this.#retainCount++
    this.#lifecycleGeneration++
    let retained = true
    return () => {
      if (!retained) return
      retained = false
      this.#retainCount--
      const generation = ++this.#lifecycleGeneration
      if (!disposeOnRelease || this.#retainCount !== 0) return
      // React StrictMode may replay passive effects across a microtask
      // boundary. Defer disposal to a task so the replacement setup can
      // retain the registry before the zero-owner check runs.
      const dispose = () => {
        if (
          this.#disposalLedger.lifecycle === LifecycleState.open &&
          this.#retainCount === 0 &&
          this.#lifecycleGeneration === generation
        ) {
          try {
            this.dispose()
          } catch (error) {
            reportRegistryFailure(this.runtime, error)
          }
        }
      }
      // React StrictMode may replay passive effects across a microtask boundary;
      // always yield to a task before reclaiming the zero-owner registry.
      setTimeout(dispose, 0)
    }
  }

  /**
   * Idempotent, immediately enters `closing`. If an owned value's disposer returns a thenable, this
   * cannot block on it (it's sync) — the thenable is tracked and observed (never left as an
   * unhandled rejection) so a later `disposeAsync()` call still waits for it instead of resolving
   * early just because `dispose()` already ran (see `disposeAsync()`). `lifecycle` only reaches
   * `terminal` once every tracked thenable has actually settled.
   */
  dispose(): void {
    if (this.disposed) return
    // The ledger accepts plan items until seal; the registry stops public admission before any
    // user disposer can register another value or reenter disposeAsync().
    this.#disposingAsync = this.#disposalLedger.whenTerminal().then(async () => {
      /** Once terminal, seal returns the original immutable plan and its complete continuation. */
      const { cleanupErrors } = await mergeCleanupResults([this.#disposalLedger.seal()])
      if (cleanupErrors.length === 0) return
      throw this.#mapDisposalErrors(cleanupErrors as readonly ICollectedError[])
    })
    // Synchronous callers may never request async completion; the existing Runtime observer reports
    // failures while this handler prevents the stable public completion from becoming unhandled.
    void this.#disposingAsync.catch(() => undefined)
    this.#lifecycleGeneration++
    const entries = [...this.#entries.values()].reverse()
    this.#entries.clear()
    for (const entry of entries) {
      if (!entry.owned) continue
      this.#disposalLedger.start('registry', () => disposeValue(entry.value))
    }
    this.#disposalLedger.start('atom-store', () => this.atomStore.dispose())
    const outcome = this.#disposalLedger.seal()
    this.#observeAsyncDisposalErrors(outcome)
    this.#throwSynchronousDisposalErrors(outcome.cleanupErrors)
  }

  /**
   * Awaitable counterpart. Single-flight: concurrent calls share one completion instead of each
   * racing their own pass over `#entries`. Calling this after a prior synchronous `dispose()` does
   * not resolve early — it waits for whatever thenable disposer results that `dispose()` started
   * but could not block on (tracked by the lifecycle disposal ledger).
   */
  disposeAsync(): Promise<void> {
    if (this.#disposingAsync) return this.#disposingAsync
    try {
      this.dispose()
    } catch {
      // The already-published completion replays this failure to async callers.
    }
    return this.#disposingAsync!
  }

  /** Reports asynchronous raw errors once, after ledger completion, without altering their identity. */
  #observeAsyncDisposalErrors(outcome: ISyncStartedDisposalOutcome): void {
    void outcome.physicalCompletion.then(({ cleanupErrors }) => {
      for (const entry of cleanupErrors) {
        reportRegistryFailure(this.runtime, entry.error)
      }
    })
  }

  /** Projects raw ledger errors into the package cleanup contract without rewriting foreign owners. */
  #mapDisposalErrors(errors: readonly { readonly error: unknown }[]): unknown {
    if (errors.length === 1) return identifyRegistryDisposalFailure(errors[0]!.error)
    return createStoreReactAggregateError(
      StoreReactErrorCode.registryDisposalFailed,
      errors.map((entry) => identifyRegistryDisposalFailure(entry.error)),
      StoreReactErrorText.registryDisposalFailed
    )
  }

  /** Throws only errors observed during synchronous callback start, preserving raw identity. */
  #throwSynchronousDisposalErrors(errors: readonly { readonly error: unknown }[]): void {
    if (errors.length === 0) return
    throw this.#mapDisposalErrors(errors)
  }

  /**
   * Per-entry disposal outside the whole-registry dispose()/disposeAsync() flow (register()'s
   * returned disposer, replace(), remove()). Not tracked for disposeAsync() to wait on — these are
   * independent, ad-hoc operations — but a rejection still must not become unhandled.
   */
  #disposeValueObserved(value: unknown): void {
    try {
      /** Per-entry operations share the same cleanup error classification as whole-owner disposal. */
      const result = disposeValue(value)
      containAsyncRejection(result, (error) => reportRegistryFailure(this.runtime, error))
    } catch (error) {
      throw identifyRegistryDisposalFailure(error)
    }
  }

  #assertRuntime<T>(token: IStoreToken<T>, value: T): void {
    const runtime = readStoreRuntime(value)
    if (runtime && runtime !== this.runtime) {
      throw createStoreReactError(
        StoreReactErrorCode.crossRuntime,
        StoreReactErrorText.differentRuntime(token.debugName)
      )
    }
  }

  #assertActive(): void {
    if (this.disposed) {
      throw createStoreReactError(
        StoreReactErrorCode.registryDisposed,
        StoreReactErrorText.registryDisposed
      )
    }
  }
}

/** Create a token registry with its own atom store, using a fresh Runtime when one is omitted. */
export function createStoreRegistry(runtime: IRuntime = createRuntime()): StoreRegistry {
  return new StoreRegistry(runtime)
}

function readStoreRuntime(value: unknown): IRuntime | undefined {
  // 唯一所有权协议。字段名既可伪造也会漏掉新节点类型，不能再作为边界。
  return ownerOf(value)
}

function disposeValue(value: unknown): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  const candidate = value as {
    $dispose?: () => void | PromiseLike<void>
    dispose?: () => void | PromiseLike<void>
  }
  if (typeof candidate.$dispose === 'function') return candidate.$dispose()
  if (typeof candidate.dispose === 'function') return candidate.dispose()
  return undefined
}

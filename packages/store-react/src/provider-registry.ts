import {
  createRuntime,
  ReactiveErrorPhase,
  type IDisposable,
  type IDisposer,
  type IRuntime
} from '@migaia/reactive'
import { claimOwnership, ownerOf } from '@migaia/reactive/ownership'
import {
  containAsyncRejection,
  createSyncStartedDisposalLedger,
  type ISyncStartedDisposalLedger,
  LifecycleState,
  type ILifecycleState
} from '@migaia/lifecycle'
import { createAtomStore, type IAtomStore } from '@migaia/store-keyed/atom/store'
import { createStoreReactAggregateError, createStoreReactError } from './errors.js'
import { StoreReactErrorCode } from './error-code.js'
import { StoreReactErrorText } from './error-text.js'

const STORE_TOKEN_VALUE = Symbol('store-token-value')

/** Keeps lifecycle diagnostics from escaping timer and promise rejection boundaries. */
function reportRegistryFailure(runtime: IRuntime, error: unknown): void {
  try {
    runtime.reportError(error, { phase: ReactiveErrorPhase.lifecycleHook })
    return
  } catch (reporterError) {
    const hostReportError = (globalThis as { reportError?: (error: unknown) => void }).reportError
    try {
      if (hostReportError) hostReportError(reporterError)
      else console.error(reporterError)
    } catch {
      // Host diagnostics are best effort and must not create a second unhandled failure.
    }
  }
}

/**
 * React gives no public hook for "this render/component instance was discarded before it committed"
 * — no callback fires for an effect that never ran. `prepareForRender()`'s timer is the only signal
 * available, and it is inherently a heuristic: too short risks disposing a candidate a legitimately
 * slow (not abandoned) render still needs; too long delays reclaiming a genuinely abandoned one. A
 * pending readiness barrier is deliberately not reclaimed by wall-clock time: React may commit a
 * legitimately slow render after an arbitrary delay. The owner must resolve/reject the barrier or
 * explicitly dispose the candidate; correctness is more important than heuristic reclamation.
 */
export type IStoreToken<T> = Readonly<{
  key: symbol
  debugName: string
  readonly [STORE_TOKEN_VALUE]?: (value: T) => T
}>

export type IStoreRegistrationOptions = {
  readonly owned?: boolean
}

/** Rejects null/non-object registration options before reading ownership flags. */
function readRegistrationOwned(options: unknown, fallback: boolean): boolean {
  if (options === null || typeof options !== 'object')
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      StoreReactErrorText.optionsObject
    )
  try {
    Object.getOwnPropertyDescriptors(options)
  } catch (error) {
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      StoreReactErrorText.optionsObject,
      { cause: error }
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

/** Runtime-bound registry shared by React Provider and SSR request scopes. */
export class StoreRegistry implements IDisposable {
  readonly runtime: IRuntime
  /** Provider-local atom state/override boundary. Same Runtime may host many registries. */
  readonly atomStore: IAtomStore
  #entries = new Map<symbol, IRegistryEntry>()
  #retainCount = 0
  #lifecycleGeneration = 0
  /** Lifecycle-owned pending/error/completion truth for the whole registry disposal plan. */
  #disposalLedger: ISyncStartedDisposalLedger = createSyncStartedDisposalLedger()
  #disposingAsync: Promise<void> | undefined

  constructor(runtime: IRuntime = createRuntime()) {
    this.runtime = runtime
    this.atomStore = createAtomStore(runtime)
    claimOwnership(this, runtime)
  }

  /** Part of the project's unified lifecycle shape (see `@migaia/lifecycle`'s `ILifecycleState`). */
  get lifecycle(): ILifecycleState {
    return this.#disposalLedger.lifecycle
  }

  /**
   * Resolves once this registry (and any thenable disposer results) has actually finished tearing
   * down.
   */
  whenTerminal(): Promise<void> {
    return this.#disposalLedger.whenTerminal()
  }

  get disposed(): boolean {
    return this.#disposalLedger.lifecycle !== LifecycleState.open
  }

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

  get<T>(token: IStoreToken<T>): T | undefined {
    this.#assertActive()
    return this.#entries.get(token.key)?.value as T | undefined
  }

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

  has<T>(token: IStoreToken<T>): boolean {
    this.#assertActive()
    return this.#entries.has(token.key)
  }

  remove<T>(token: IStoreToken<T>, disposeOwned = true): boolean {
    this.#assertActive()
    const entry = this.#entries.get(token.key)
    if (!entry) return false
    this.#entries.delete(token.key)
    if (disposeOwned && entry.owned) this.#disposeValueObserved(entry.value)
    return true
  }

  /**
   * React StrictMode probes effect cleanup/setup. Delayed release avoids disposing an
   * internally-owned registry between those two phases.
   */
  retain(disposeOnRelease: boolean, _deferTask = false): IDisposer {
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
   * Retained for source compatibility, but deliberately does not reclaim a render candidate. React
   * exposes no reliable abandoned-render signal; any timer, including one armed after a readiness
   * promise settles, can dispose a valid render before its effect commits. Candidate reclamation
   * belongs to an observable owner or a future GC-backed mechanism.
   */
  prepareForRender(after?: Promise<void>): void {
    void after
  }

  /**
   * Idempotent, immediately enters `closing`. If an owned value's disposer returns a thenable, this
   * cannot block on it (it's sync) — the thenable is tracked and observed (never left as an
   * unhandled rejection) so a later `disposeAsync()` call still waits for it instead of resolving
   * early just because `dispose()` already ran (see `disposeAsync()`). `lifecycle` only reaches
   * `terminal` once every tracked thenable has actually settled.
   */
  dispose(): void {
    if (this.#disposalLedger.lifecycle !== LifecycleState.open) return
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
    this.#throwSynchronousDisposalErrors(outcome.synchronousErrors)
  }

  /**
   * Awaitable counterpart. Single-flight: concurrent calls share one completion instead of each
   * racing their own pass over `#entries`. Calling this after a prior synchronous `dispose()` does
   * not resolve early — it waits for whatever thenable disposer results that `dispose()` started
   * but could not block on (tracked by the lifecycle disposal ledger).
   */
  disposeAsync(): Promise<void> {
    if (this.#disposingAsync) return this.#disposingAsync
    if (this.#disposalLedger.lifecycle === LifecycleState.open) {
      try {
        this.dispose()
      } catch {
        // The stable completion below replays this failure to async callers.
      }
    }
    const outcome = this.#disposalLedger.seal()
    const completion = outcome.completion.then((errors) => {
      if (errors.length === 0) return
      throw this.#mapDisposalErrors(errors)
    })
    this.#disposingAsync = completion
    return completion
  }

  /** Reports asynchronous raw errors once, after ledger completion, without altering their identity. */
  #observeAsyncDisposalErrors(outcome: {
    readonly synchronousErrors: readonly unknown[]
    readonly completion: Promise<readonly unknown[]>
  }): void {
    void outcome.completion.then((errors) => {
      for (const entry of errors.slice(outcome.synchronousErrors.length)) {
        reportRegistryFailure(this.runtime, (entry as { readonly error: unknown }).error)
      }
    })
  }

  /** Projects raw ledger errors into Store's synchronous AggregateError contract. */
  #mapDisposalErrors(errors: readonly { readonly error: unknown }[]): unknown {
    if (errors.length === 1) return errors[0]!.error
    return createStoreReactAggregateError(
      StoreReactErrorCode.registryDisposalFailed,
      errors.map((entry) => entry.error),
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
    const result = disposeValue(value)
    containAsyncRejection(result, (error) => reportRegistryFailure(this.runtime, error))
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
    if (this.#disposalLedger.lifecycle !== LifecycleState.open) {
      throw createStoreReactError(
        StoreReactErrorCode.registryDisposed,
        StoreReactErrorText.registryDisposed
      )
    }
  }
}

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

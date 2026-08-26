import {
  createRuntime,
  ReactiveErrorPhase,
  type IDisposable,
  type IDisposer,
  type IRuntime
} from '@migaia/reactive'
import { claimOwnership, ownerOf } from '@migaia/reactive/ownership'
import {
  assimilateCapturedThen,
  createTerminalController,
  probeThenable,
  ThenableProbeKind,
  type ITerminalController,
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
  #disposed = false
  #retainCount = 0
  #lifecycleGeneration = 0
  #terminal: ITerminalController = createTerminalController()
  // Disposers invoked from the synchronous dispose() path whose return value
  // turned out to be a thenable. dispose() can't await them (it's sync),
  // but a later disposeAsync() call must — and a rejection must never
  // become an unhandled rejection just because nothing was watching yet.
  #pendingSyncDisposals = new Set<Promise<void>>()
  #disposingAsync: Promise<void> | undefined
  /** Stable completion ledger for every disposer started by the terminal dispose operation. */
  #disposeCompletion: Promise<void> | undefined
  #resolveDisposeCompletion: (() => void) | undefined
  #rejectDisposeCompletion: ((error: unknown) => void) | undefined
  #disposeErrors: unknown[] = []

  constructor(runtime: IRuntime = createRuntime()) {
    this.runtime = runtime
    this.atomStore = createAtomStore(runtime)
    claimOwnership(this, runtime)
  }

  /** Part of the project's unified lifecycle shape (see `@migaia/lifecycle`'s `ILifecycleState`). */
  get lifecycle(): ILifecycleState {
    return this.#terminal.lifecycle
  }

  /**
   * Resolves once this registry (and any thenable disposer results) has actually finished tearing
   * down.
   */
  whenTerminal(): Promise<void> {
    return this.#terminal.whenTerminal()
  }

  get disposed(): boolean {
    return this.#disposed
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
          !this.#disposed &&
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
    if (this.#disposed) return
    this.#createDisposeCompletion()
    this.#disposed = true
    this.#terminal.close()
    this.#lifecycleGeneration++
    const entries = [...this.#entries.values()].reverse()
    this.#entries.clear()
    for (const entry of entries) {
      if (!entry.owned) continue
      try {
        this.#disposeValueTracked(entry.value)
      } catch (error) {
        this.#disposeErrors.push(error)
      }
    }
    try {
      this.atomStore.dispose()
    } catch (error) {
      this.#disposeErrors.push(error)
    }
    this.#finishDisposeIfReady()
    if (this.#disposeErrors.length === 1) throw this.#disposeErrors[0]
    if (this.#disposeErrors.length > 1)
      throw createStoreReactAggregateError(
        StoreReactErrorCode.registryDisposalFailed,
        this.#disposeErrors,
        StoreReactErrorText.registryDisposalFailed
      )
  }

  /**
   * Awaitable counterpart. Single-flight: concurrent calls share one completion instead of each
   * racing their own pass over `#entries`. Calling this after a prior synchronous `dispose()` does
   * not resolve early — it waits for whatever thenable disposer results that `dispose()` started
   * but could not block on (see `#pendingSyncDisposals`).
   */
  disposeAsync(): Promise<void> {
    if (this.#disposingAsync) return this.#disposingAsync
    if (!this.#disposed) {
      try {
        this.dispose()
      } catch {
        // The stable completion below replays this failure to async callers.
      }
    }
    this.#disposingAsync = this.#createDisposeCompletion()
    return this.#disposingAsync
  }

  /** Creates the one completion promise shared by sync-started and async callers. */
  #createDisposeCompletion(): Promise<void> {
    if (this.#disposeCompletion) return this.#disposeCompletion
    this.#disposeCompletion = new Promise<void>((resolve, reject) => {
      this.#resolveDisposeCompletion = resolve
      this.#rejectDisposeCompletion = reject
    })
    void this.#disposeCompletion.catch(() => undefined)
    return this.#disposeCompletion
  }

  /** Settles the completion ledger once every tracked disposer has settled. */
  #finishDisposeIfReady(): void {
    if (this.#pendingSyncDisposals.size !== 0 || !this.#disposeCompletion) return
    this.#terminal.forceTerminal()
    if (this.#disposeErrors.length === 0) this.#resolveDisposeCompletion?.()
    else if (this.#disposeErrors.length === 1)
      this.#rejectDisposeCompletion?.(this.#disposeErrors[0])
    else
      this.#rejectDisposeCompletion?.(
        createStoreReactAggregateError(
          StoreReactErrorCode.registryDisposalFailed,
          this.#disposeErrors,
          StoreReactErrorText.registryDisposalFailed
        )
      )
    this.#resolveDisposeCompletion = undefined
    this.#rejectDisposeCompletion = undefined
  }

  /**
   * Sync dispose() path: call a value's disposer, and track+observe a thenable result without
   * blocking on it.
   */
  #disposeValueTracked(value: unknown): void {
    const result = disposeValue(value)
    const thenable = asPromiseLike(result)
    if (!thenable) return
    const tracked: Promise<void> = thenable.then(
      () => undefined,
      (error: unknown) => {
        this.#disposeErrors.push(error)
        reportRegistryFailure(this.runtime, error)
        throw error
      }
    )
    this.#pendingSyncDisposals.add(tracked)
    void tracked.then(
      () => this.#finishTrackedDisposal(tracked),
      () => this.#finishTrackedDisposal(tracked)
    )
  }

  /** Removes one settled sync disposer without creating an unhandled rejected finally-chain. */
  #finishTrackedDisposal(tracked: Promise<void>): void {
    this.#pendingSyncDisposals.delete(tracked)
    if (this.#disposed && this.#pendingSyncDisposals.size === 0) {
      this.#finishDisposeIfReady()
    }
  }

  /**
   * Per-entry disposal outside the whole-registry dispose()/disposeAsync() flow (register()'s
   * returned disposer, replace(), remove()). Not tracked for disposeAsync() to wait on — these are
   * independent, ad-hoc operations — but a rejection still must not become unhandled.
   */
  #disposeValueObserved(value: unknown): void {
    const result = disposeValue(value)
    const thenable = asPromiseLike(result)
    if (!thenable) return
    void thenable.catch((error: unknown) => {
      reportRegistryFailure(this.runtime, error)
    })
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
    if (this.#disposed) {
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

function asPromiseLike(value: unknown): Promise<unknown> | undefined {
  const probe = probeThenable(value)
  if (probe.kind === ThenableProbeKind.failed) throw probe.error
  if (probe.kind === ThenableProbeKind.notThenable) return undefined
  return assimilateCapturedThen(probe.thenFn, value)
}

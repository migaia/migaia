import { createLifecycleError } from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import type { IDisposer } from './types.js'

export type IQuiescenceTracker<TKey> = {
  retain(key: TKey): IDisposer
  count(key: TKey): number
  /** Strict, exclusive drain: throws synchronously (not a rejected Promise) unless `isSealed(key)`. */
  whenZero(key: TKey): Promise<void>
  /** Non-exclusive: resolves the next time count reaches zero; does not block new `retain()` calls. */
  whenZeroOnce(key: TKey): Promise<void>
  /** Blocks further `retain()` calls for `key`. Idempotent. */
  seal(key: TKey): void
  isSealed(key: TKey): boolean
  /** Removes a zero-count key and returns whether a state entry was removed. */
  forget(key: TKey): boolean
}

type IKeyStore<TKey, TValue> = {
  get(key: TKey): TValue | undefined
  set(key: TKey, value: TValue): void
  delete(key: TKey): boolean
}

type IKeyState = {
  count: number
  sealed: boolean
  strictWaiters?: Array<() => void>
  looseWaiters?: Array<() => void>
}

/** One canonical counter owner shares semantics while each key store selects idle retention. */
class QuiescenceTracker<TKey> implements IQuiescenceTracker<TKey> {
  /** Object keys are weakly held; string keys need explicit idle-state pruning. */
  readonly #store: IKeyStore<TKey, IKeyState>
  /** Only strong string-key stores prune pristine zero-count entries automatically. */
  readonly #pruneIdle: boolean

  /** Capture the original key store and its fixed retention policy without creating key state. */
  constructor(store: IKeyStore<TKey, IKeyState>, pruneIdle: boolean) {
    this.#store = store
    this.#pruneIdle = pruneIdle
  }

  /** Create counter state lazily; waiter arrays belong only to actual pending waits. */
  #getOrCreate(key: TKey): IKeyState {
    /** A weakly retained idle state is reused by later operations on the same live object key. */
    let state = this.#store.get(key)
    if (!state) {
      state = { count: 0, sealed: false }
      this.#store.set(key, state)
    }
    return state
  }

  /** Publish both waiter lists as consumed before resolving the original zero transition. */
  #settle(key: TKey, state: IKeyState): void {
    if (state.count > 0) return
    /** Detach only allocated lists; an ordinary release needs no empty array or splice. */
    const strict = state.strictWaiters
    /** Loose waiters observe this zero transition without sealing future retention. */
    const loose = state.looseWaiters
    state.strictWaiters = undefined
    state.looseWaiters = undefined
    if (strict) for (const resolve of strict) resolve()
    if (loose) for (const resolve of loose) resolve()
    /** Sealed admission facts persist; WeakMap ownership safely retains idle object states. */
    if (this.#pruneIdle && !state.sealed) this.#store.delete(key)
  }

  /** Retain one operation and return its original idempotent release, callable without a receiver. */
  readonly retain = (key: TKey): IDisposer => {
    /** Existing sealed state rejects synchronously before modifying the count. */
    const existing = this.#store.get(key)
    if (existing?.sealed) {
      throw createLifecycleError(
        LifecycleErrorCode.quiescenceSealed,
        LifecycleErrorText.quiescenceSealed
      )
    }
    /** This release keeps its exact state even if a later epoch uses the same string key. */
    const state = this.#getOrCreate(key)
    state.count++
    /** Only the first release may decrement its retained operation. */
    let active = true
    return () => {
      if (!active) return
      active = false
      state.count--
      this.#settle(key, state)
    }
  }

  /** Read without creating state; detached invocation retains the original owner. */
  readonly count = (key: TKey): number => this.#store.get(key)?.count ?? 0

  /** Strict zero waits require a persistent sealed fence and preserve synchronous rejection. */
  readonly whenZero = (key: TKey): Promise<void> => {
    /** The original sealed entry is shared by every strict wait on this key. */
    const existing = this.#store.get(key)
    if (!existing?.sealed) {
      throw createLifecycleError(
        LifecycleErrorCode.quiescenceUnsealedWait,
        LifecycleErrorText.quiescenceUnsealedWait
      )
    }
    if (existing.count === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      ;(existing.strictWaiters ??= []).push(resolve)
    })
  }

  /** A loose wait observes the next zero transition without creating idle state or sealing. */
  readonly whenZeroOnce = (key: TKey): Promise<void> => {
    /** An idle loose wait has no retention effect; an active wait owns one lazily allocated list. */
    const state = this.#store.get(key)
    if (!state || state.count === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      ;(state.looseWaiters ??= []).push(resolve)
    })
  }

  /** Keep the original admission fence even for a key that has never held an operation. */
  readonly seal = (key: TKey): void => {
    /** Sealed state must remain available after its count reaches zero. */
    const state = this.#getOrCreate(key)
    state.sealed = true
  }

  /** Read the admission fence without allocating any counter state. */
  readonly isSealed = (key: TKey): boolean => this.#store.get(key)?.sealed ?? false

  /** Explicitly remove only an idle state with no unresolved strict or loose waiters. */
  readonly forget = (key: TKey): boolean => {
    /** Object states may be retained at zero; pristine string states were already pruned. */
    const state = this.#store.get(key)
    if (
      !state ||
      state.count !== 0 ||
      (state.strictWaiters?.length ?? 0) !== 0 ||
      (state.looseWaiters?.length ?? 0) !== 0
    )
      return false
    return this.#store.delete(key)
  }
}

/**
 * Object-keyed variant, `WeakMap`-backed so entries are collected once the key is unreachable
 * elsewhere.
 */
export function createQuiescenceTracker<TKey extends object>(): IQuiescenceTracker<TKey> {
  return new QuiescenceTracker<TKey>(new WeakMap(), false)
}

/**
 * String-keyed variant. `WeakMap` cannot take string keys, so pristine entries are pruned
 * explicitly.
 */
function createStringQuiescenceTracker(): IQuiescenceTracker<string> {
  return new QuiescenceTracker<string>(new Map(), true)
}

/**
 * `LeaseRegistry` — the same engine as `QuiescenceTracker`, re-exported under the name lease call
 * sites reach for. It must pass `whenZero()`/`whenZeroOnce()`/`seal()` straight through rather than
 * hiding them behind `count()` polling.
 */
export type ILeaseRegistry<TKey> = IQuiescenceTracker<TKey>

export function createObjectLeaseRegistry<TKey extends object>(): ILeaseRegistry<TKey> {
  return createQuiescenceTracker<TKey>()
}

export function createStringLeaseRegistry(): ILeaseRegistry<string> {
  return createStringQuiescenceTracker()
}

/**
 * The narrow facade for in-flight operations: unlike `LeaseRegistry`, it never exposes lease
 * semantics (retain/seal) to domain callers — only `track()`/`drain()`/`size`.
 */
export type IPendingTracker = {
  /** Registers `promise` as in-flight; auto-releases on settle. Returns `promise` unchanged. */
  track<T>(promise: Promise<T>): Promise<T>
  /**
   * Waits until nothing is in flight, looping via `whenZeroOnce()` so work started while draining
   * is never missed.
   */
  drain(): Promise<void>
  readonly size: number
}

export function createPendingTracker(): IPendingTracker {
  const tracker = createStringQuiescenceTracker()
  const KEY = '@migaia/lifecycle/pending-tracker'
  return {
    track(promise) {
      const release = tracker.retain(KEY)
      const settle = (): void => {
        try {
          release()
        } catch {
          // `release()` is a plain counter decrement and never throws; guarded defensively so a
          // future change here cannot turn into an unhandled rejection on this derived chain.
        }
      }
      // `.then(settle, settle)` always resolves regardless of `promise`'s outcome, so this derived
      // chain never itself becomes an unhandled rejection; the original `promise` is returned
      // untouched for the caller to handle.
      void promise.then(settle, settle)
      return promise
    },
    async drain() {
      while (tracker.count(KEY) > 0) {
        await tracker.whenZeroOnce(KEY)
      }
    },
    get size() {
      return tracker.count(KEY)
    }
  }
}

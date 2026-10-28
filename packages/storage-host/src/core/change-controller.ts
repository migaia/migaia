import { type IStorageChange, type IStorageKey } from '@migaia/storage-contract'
import { createEventChannel, EventDispatchPolicy } from '@migaia/event-subscriber'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import { createStorageOperationReporter, reportCleanupError } from './operation-reporter.ts'
import { REPOSITORY_KEY_PREFIX } from './record-layout.ts'
import type {
  IBackendChangeController,
  IBackendChangeControllerOptions,
  IBackendChangeSnapshot
} from './change-types.ts'
import {
  createBackendLifecycleController,
  type IBackendLifecycleController
} from './backend-lifecycle.ts'
export type * from './change-types.ts'
export * from './backend-registry.ts'
/** Large commits preserve the original coarse-invalidation bound. */
const maxEventKeys = 128

/** Read the canonical entity scope used by coarse record invalidations. */
function canonicalScopeOf(key: IStorageKey): string | undefined {
  return Array.isArray(key) &&
    key.length === 3 &&
    key[0] === REPOSITORY_KEY_PREFIX &&
    typeof key[1] === 'string' &&
    typeof key[2] === 'string'
    ? key[1]
    : undefined
}

/** Derive a scope only when every retained record key belongs to that same scope. */
function deriveScope(keys: readonly IStorageKey[] | undefined): string | undefined {
  if (keys === undefined || keys.length === 0) return undefined
  /** Every key must agree with the first canonical scope. */
  const first = canonicalScopeOf(keys[0]!)
  return first !== undefined && keys.every((key) => canonicalScopeOf(key) === first)
    ? first
    : undefined
}

/** The original channel and lifecycle owners remain private to one physical backend. */
class BackendChangeController implements IBackendChangeController {
  /** Native platform and configured options remain borrowed references in this captured boundary. */
  readonly snapshot: IBackendChangeSnapshot
  /** Same-realm origins retain the existing unique sequence fallback. */
  readonly origin: string
  /** Backend admission observes this original controller's closure. */
  readonly closingSignal: INativeAbortSignal
  /** One canonical lifecycle retains admission, mutation drain and native finalization. */
  readonly #lifecycle: IBackendLifecycleController
  /** Actual committed local publications alone advance this counter. */
  #sequence = 0
  /** Physical closure follows the original lifecycle promise. */
  #disposed = false
  /** All cleanup callers receive the same completion promise. */
  #disposePromise: Promise<void> | undefined
  /** Observer failures terminate at the existing diagnostic boundary. */
  readonly #reporter: ReturnType<typeof createStorageOperationReporter>
  /** The original event channel preserves queued reentrant delivery. */
  readonly #channel: ReturnType<typeof createEventChannel<IStorageChange>>

  /** Admit synchronous configuration before acquiring a channel or lifecycle resource. */
  constructor(input: IBackendChangeControllerOptions) {
    this.#lifecycle = createBackendLifecycleController(input)
    this.snapshot = this.#lifecycle.snapshot
    this.origin = this.#lifecycle.origin
    this.closingSignal = this.#lifecycle.closingSignal
    this.#reporter = createStorageOperationReporter()
    this.#channel = createEventChannel<IStorageChange>({
      report: ({ error }) => reportCleanupError(this.#reporter, error),
      dispatchPolicy: EventDispatchPolicy.queued
    })
  }

  /** Reject new work through the original physical lifecycle. */
  readonly assertLive = (): void => this.#lifecycle.assertLive()

  /** Retain accepted mutations through the original physical lifecycle. */
  readonly beginMutation = (): (() => void) => this.#lifecycle.beginMutation()

  /** Add local sequence/origin only after an actual backend commit. */
  readonly publish = (
    change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>
  ): IStorageChange | undefined => {
    if (this.#disposed) return
    this.#sequence += 1
    /** Oversized commits retain scope while omitting unbounded key lists. */
    const keys =
      change.keys !== undefined && change.keys.length > maxEventKeys ? undefined : change.keys
    /** Caller metadata is retained unchanged alongside this controller's actual commit facts. */
    const event: IStorageChange = {
      ...change,
      keys,
      scope: change.channel === 'record' ? deriveScope(change.keys) : undefined,
      sequence: this.#sequence,
      origin: this.origin
    }
    this.#emit(event)
    return event
  }

  /** Preserve transport sequence and origin without advancing local publication history. */
  readonly publishExternal = (change: IStorageChange): void => {
    if (this.#disposed) return
    /** Coarse external invalidations follow the original bounded event policy. */
    const keys =
      change.keys !== undefined && change.keys.length > maxEventKeys ? undefined : change.keys
    this.#emit({
      ...change,
      keys,
      scope: change.channel === 'record' ? deriveScope(keys) : undefined
    })
  }

  /** Event subscription retains the original event channel's listener lifetime. */
  readonly subscribe = (listener: (change: IStorageChange) => void): (() => void) =>
    this.#channel.subscribe((event) => listener(event.value))

  /** Drain accepted mutations before invoking the original native finalizer exactly once. */
  readonly dispose = (): Promise<void> => {
    if (this.#disposePromise !== undefined) return this.#disposePromise
    /** Publish this completion before lifecycle closure notifies synchronous observers. */
    let resolve!: () => void
    /** Preserve the original lifecycle failure without a second physical cleanup. */
    let reject!: (cause: unknown) => void
    this.#disposePromise = new Promise<void>((yes, no) => {
      resolve = yes
      reject = no
    })
    void this.#lifecycle.dispose().then(
      () => {
        this.#disposed = true
        this.#channel.clear()
        resolve()
      },
      (cause) => {
        this.#disposed = true
        this.#channel.clear()
        reject(cause)
      }
    )
    return this.#disposePromise
  }

  /** Report observer failure without changing a committed native outcome. */
  #emit(event: IStorageChange): void {
    if (this.#disposed) return
    try {
      this.#channel.publish(event)
    } catch (cause) {
      reportCleanupError(this.#reporter, cause)
    }
  }
}

/** Construct one controller without exposing event-channel or lifecycle state. */
export const createBackendChangeController = (
  input: IBackendChangeControllerOptions
): IBackendChangeController => new BackendChangeController(input)

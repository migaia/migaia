/**
 * Owns capability-host admission, allowlist state, completion order and final disposal. Entries own
 * activation resources; lifecycle owns quiescence and generation cancellation. Graph topology and
 * dependency planning are outside this module.
 */
import { createQuiescenceTracker } from '@migaia/lifecycle'
import type {
  ICapabilityDefinition,
  ICapabilityEnableResult,
  ICapabilityHandle,
  ICapabilityHost,
  ICapabilityState
} from './index.js'
import { ActivationOrder } from './activation-order.js'
import { CapabilityEntry, type IHostEntryOwner } from './host-entry.js'
import {
  copyHostFlags,
  rejectedHostOperation,
  snapshotHostDefinition,
  type IHostOptionsSnapshot
} from './host-admission.js'
import { CapabilityErrorCode } from './error-code.js'
import { CapabilityErrorText } from './error-text.js'
import { createCapabilityError } from './errors.js'
import { invokeCapabilityReporter } from './reporter.js'

/** Isolated flag and resource coordinator with receiver-independent public operations. */
export class CapabilityHost<Context> implements ICapabilityHost<Context> {
  /** Registration-order entries remain owned after disposal for read-only diagnostics. */
  readonly #entries = new Map<string, CapabilityEntry<Context>>()
  /** Entry resources receive one explicit host context instead of shared factory captures. */
  readonly #entryOwner: IHostEntryOwner<Context>
  /** Construction snapshot preserves original reporter identity and receiver. */
  readonly #options: IHostOptionsSnapshot
  /** Canonical current allowlist; single-key updates never copy unrelated permissions. */
  #flags: Map<string, boolean>
  /** Completion-order links permit O(1) revocation and allocation-free LIFO batch traversal. */
  readonly #activationOrder = new ActivationOrder<CapabilityEntry<Context>>()
  /** Lifecycle's weak object-key counters own all and per-entry pending activation/cleanup work. */
  readonly #pendingTracker = createQuiescenceTracker<object>()
  /** One object key groups all entry work for terminal host drain. */
  readonly #allKey = {}
  /** Terminal admission closes synchronously before user cleanup starts. */
  #disposed = false
  /** Synchronous lifecycle callback depth rejects same-host mutation reentry. */
  #transitionDepth = 0
  /** First completion Promise is published before synchronous cleanup and retained by identity. */
  #disposePromise: Promise<void> | undefined
  /** Pending duplicate disposal rejects until that first completion has settled. */
  #disposeCompleted = false

  /** Bind entry collaboration after options admission, retaining the original shared context. */
  constructor(context: Context, options: IHostOptionsSnapshot) {
    this.#options = options
    this.#flags = options.flags
    this.#entryOwner = {
      context,
      allowed: (name) => this.#allowed(name),
      reportError: (name, error) => this.#reportError(name, error),
      transition: (operation) => this.#transition(operation),
      trackPending: (entry, promise) => this.#trackPending(entry, promise),
      activated: (entry) => this.#activationOrder.add(entry),
      deactivated: (name) => this.#activationOrder.delete(name)
    }
  }

  /** Capture one admitted registration before publishing its lifecycle owner. */
  readonly register = <Handle extends ICapabilityHandle>(
    definition: ICapabilityDefinition<Context, Handle>
  ): void => {
    this.#assertUsable()
    this.#assertNotTransitioning()
    /** Registration getters run under reentry admission, before duplicate detection. */
    const snapshot = this.#transition(() => snapshotHostDefinition(definition))
    if (this.#entries.has(snapshot.name)) {
      throw createCapabilityError(
        CapabilityErrorCode.alreadyRegistered,
        CapabilityErrorText.alreadyRegistered(snapshot.name)
      )
    }
    this.#entries.set(snapshot.name, new CapabilityEntry(snapshot, this.#entryOwner))
  }

  /** Return a fresh O(n) registration snapshot without exposing the mutable registry. */
  get names(): readonly string[] {
    return [...this.#entries.keys()]
  }
  /** Keep terminal lifecycle diagnostics available without acquiring resources. */
  readonly state = (name: string): ICapabilityState => this.#entryOf(name).state
  /** Retain exact application handle identity while hiding stale or released resources. */
  readonly handle = <Handle extends ICapabilityHandle>(name: string): Handle | undefined =>
    this.#entryOf(name).handle as Handle | undefined
  /** Return the current retained failure independently from mutation admission. */
  readonly error = (name: string): unknown => this.#entryOf(name).error

  /** Update and reconcile one permission in O(1); changing unrelated entries is unnecessary. */
  readonly setFlag = (name: string, enabled: boolean): void => {
    this.#assertUsable()
    this.#assertNotTransitioning()
    this.#transition(() => {
      if (enabled === true) this.#flags.set(name, true)
      else this.#flags.delete(name)
      this.#entries.get(name)?.reconcile()
    })
  }

  /** Publish an entire snapshot before LIFO revocation; unreadable snapshots fail closed. */
  readonly setFlags = (flags: Readonly<Record<string, boolean>>): void => {
    this.#assertUsable()
    this.#assertNotTransitioning()
    this.#transition(() => {
      try {
        this.#replaceFlags(copyHostFlags(flags))
      } catch (error) {
        this.#replaceFlags(new Map())
        throw error
      }
    })
  }

  /** Preserve admission failures as owned rejections and share the entry's exact activation Promise. */
  readonly enable = (name: string): Promise<ICapabilityEnableResult> => {
    /** Lookup failures reject rather than synchronously escaping the public enable boundary. */
    let entry: CapabilityEntry<Context>
    try {
      this.#assertUsable()
      this.#assertNotTransitioning()
      entry = this.#entryOf(name)
    } catch (error) {
      return rejectedHostOperation(error)
    }
    return entry.enable()
  }

  /** Revoke synchronously, then wait for all activation and cleanup work belonging to this entry. */
  readonly disable = async (name: string): Promise<boolean> => {
    this.#assertUsable()
    /** Disposed admission precedes unknown-name errors, preserving the public error priority. */
    const entry = this.#entryOf(name)
    this.#assertUsable()
    this.#assertNotTransitioning()
    /** State before revocation determines whether this operation disabled an enabled resource. */
    const changed = this.#transition(() => entry.deactivate())
    while (this.#pendingTracker.count(entry) > 0) await this.#pendingTracker.whenZeroOnce(entry)
    return changed
  }

  /** Publish completion before cleanup; pending duplicates reject to prevent disposer self-await. */
  readonly dispose = (): Promise<void> => {
    if (this.#disposePromise) {
      if (this.#transitionDepth > 0) this.#assertNotTransitioning()
      if (!this.#disposeCompleted) {
        return rejectedHostOperation<void>(
          createCapabilityError(
            CapabilityErrorCode.hostTransitioning,
            CapabilityErrorText.hostTransitioning
          )
        )
      }
      return this.#disposePromise
    }
    this.#assertNotTransitioning()
    /** Original completion resolver is invoked only after globally tracked work drains. */
    let resolvePromise!: () => void
    /** Unexpected synchronous or drain failures retain their original rejection identity. */
    let rejectPromise!: (error: unknown) => void
    this.#disposePromise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    try {
      this.#disposeSync()
      void this.#drainPending().then(
        () => {
          this.#disposeCompleted = true
          resolvePromise()
        },
        (error) => {
          this.#disposeCompleted = true
          rejectPromise(error)
        }
      )
    } catch (error) {
      rejectPromise(error)
    }
    return this.#disposePromise
  }

  /** Terminal state becomes visible before any controller or handle cleanup callback. */
  get disposed(): boolean {
    return this.#disposed
  }

  /** Reject mutation of a host whose terminal cleanup has begun. */
  #assertUsable(): void {
    if (this.#disposed)
      throw createCapabilityError(
        CapabilityErrorCode.hostDisposed,
        CapabilityErrorText.hostDisposed
      )
  }

  /** Reject synchronous mutation reentry while lifecycle work owns a transition. */
  #assertNotTransitioning(): void {
    if (this.#transitionDepth > 0)
      throw createCapabilityError(
        CapabilityErrorCode.hostTransitioning,
        CapabilityErrorText.hostTransitioning
      )
  }

  /** Keep callback admission guarded for the entire synchronous state transition. */
  #transition<T>(operation: () => T): T {
    this.#transitionDepth++
    try {
      return operation()
    } finally {
      this.#transitionDepth--
    }
  }

  /** Resolve a registered name in O(1), including after terminal disposal. */
  #entryOf(name: string): CapabilityEntry<Context> {
    /** Registry owns stable name identity; unknown names never create entries. */
    const entry = this.#entries.get(name)
    if (!entry)
      throw createCapabilityError(
        CapabilityErrorCode.notRegistered,
        CapabilityErrorText.notRegistered(name)
      )
    return entry
  }

  /** Read the canonical allowlist without copying or traversing unrelated keys. */
  #allowed(name: string): boolean {
    return this.#flags.get(name) === true
  }

  /** Reporter failures remain diagnostics and cannot alter capability state or primary errors. */
  #reportError(name: string, error: unknown): void {
    const { onError, receiver } = this.#options
    invokeCapabilityReporter(() =>
      onError ? Reflect.apply(onError, receiver, [name, error]) : undefined
    )
  }

  /** Retain one Promise in both lifecycle-owned global and entry counters until it settles. */
  #trackPending<T>(entry: CapabilityEntry<Context>, promise: Promise<T>): void {
    /**
     * Host drain includes this operation even if later generations replace the entry's pending
     * field.
     */
    const releaseAll = this.#pendingTracker.retain(this.#allKey)
    /** Entry drain waits for old-generation cleanup as well as current activation. */
    const releaseEntry = this.#pendingTracker.retain(entry)
    void promise.then(
      () => releaseHostPending(releaseAll, releaseEntry),
      () => releaseHostPending(releaseAll, releaseEntry)
    )
  }

  /** Reconcile O(n) entries after publishing a full snapshot, releasing live handles LIFO. */
  #replaceFlags(next: Map<string, boolean>): void {
    this.#flags = next
    for (const entry of this.#activationOrder.reverse()) {
      if (!this.#allowed(entry.name)) entry.deactivate()
    }
    for (const entry of this.#entries.values()) entry.reconcile()
  }

  /** Close all generation owners before releasing handles in completion-reverse order. */
  #disposeSync(): void {
    this.#assertNotTransitioning()
    if (this.#disposed) return
    this.#disposed = true
    for (const entry of this.#entries.values()) this.#transition(() => entry.disposeGeneration())
    for (const entry of this.#activationOrder.reverse())
      this.#transition(() => entry.disposeHandle())
    this.#activationOrder.clear()
    for (const entry of this.#entries.values()) entry.finishDisposal()
  }

  /** Drain until stable zero because settling activations can retain new late-handle cleanup. */
  async #drainPending(): Promise<void> {
    while (this.#pendingTracker.count(this.#allKey) > 0)
      await this.#pendingTracker.whenZeroOnce(this.#allKey)
  }
}

/** Releases both lifecycle counters after the exact tracked operation settles in either direction. */
function releaseHostPending(releaseAll: () => void, releaseEntry: () => void): void {
  releaseAll()
  releaseEntry()
}

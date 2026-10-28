import { assertErrorPolicyReporter } from './error-boundary.js'
import type {
  ICollectedError,
  IErrorPolicy,
  IReleaseContext,
  IReleaseDescriptor,
  ILifecycleState
} from './types.js'
import { ASYNC_OWNER_BRAND } from './types.js'
import { createLifecycleError } from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { OwnedEntryList } from './owned-entries.js'
import { ClosingSignalSource, captureAbortControllerFactory } from './abort-factory.js'
import type { IAbortController } from './abort.js'
import { LifecycleState } from './state-constants.js'
import { admitDescriptor } from './dispose-transaction.js'
import { orderDisposeItems } from './disposal-order.js'
import { executeSyncDisposeTransaction } from './sync-dispose-transaction.js'

const disposeKey = (Symbol as typeof Symbol & { dispose?: symbol }).dispose

/** A descriptor accepted by `SyncLifecycleScope`: `syncSafe` is required and must be `true`. */
export type ISyncReleaseDescriptor = IReleaseDescriptor & { readonly syncSafe: true }

export type ISyncLifecycleScopeOptions = {
  readonly errorPolicy?: IErrorPolicy
  /**
   * Reporter for failures the error policy does not throw or collect. Required when `errorPolicy`
   * is `report` or `firstError`; otherwise the factory throws `INVALID_OPTION` with `detail.field:
   * 'report'`.
   */
  readonly report?: (error: unknown) => void
}

export type ISyncLifecycleScope = {
  readonly lifecycle: ILifecycleState
  own<T>(resource: T, descriptor: ISyncReleaseDescriptor): T
  release(resource: unknown): boolean
  close(): void
  /** Always synchronous — this is the whole reason this type exists. */
  dispose(): readonly ICollectedError[]
  /** Releases the scope synchronously for `using`, discarding the collected-error result. */
  [Symbol.dispose](): void
}

/** One live registration: the admitted descriptor snapshot taken by `own()`. */
type ISyncScopeEntry = {
  readonly resource: unknown
  readonly source: string
  readonly descriptor: IReleaseDescriptor
}

/** Shared admission-failure list: own() already rejected every invalid descriptor. */
const noRejectedItems: readonly ICollectedError[] = Object.freeze([])

/**
 * The synchronous scope. Options are read once at construction and every descriptor is snapshotted
 * by `own()`. Methods live on the prototype and must be called on the scope, not detached.
 */
class SyncLifecycleScope {
  /** Error policy applied to release failures. */
  readonly #errorPolicy: IErrorPolicy
  /** Reporter for failures the policy does not throw or collect. */
  readonly #report: ((error: unknown) => void) | undefined
  /** Host AbortController factory captured at construction. */
  readonly #createController: () => IAbortController
  /** `open` → `closing` → `terminal`. */
  #lifecycle: ILifecycleState = LifecycleState.open
  /** Live owned resources; created by the first `own()`. */
  #entries: OwnedEntryList<ISyncScopeEntry> | undefined
  /** Next registration source id. */
  #nextId = 0
  /** Whether any admitted descriptor has a non-zero `order`; zero-only scopes skip ordering. */
  #customOrder = false
  /** Whether dispose() already started; later calls return an empty result. */
  #disposed = false
  /** True while release callbacks run; rejects reentrant `own()` and `dispose()`. */
  #releasing = false

  /** Captures the host controller factory first, then validates the error policy. */
  constructor(options: ISyncLifecycleScopeOptions) {
    this.#createController = captureAbortControllerFactory()
    this.#errorPolicy = options.errorPolicy ?? 'throw'
    this.#report = options.report
    assertErrorPolicyReporter(this.#errorPolicy, this.#report)
  }

  /** Current lifecycle state. */
  get lifecycle(): ILifecycleState {
    return this.#lifecycle
  }

  /** Registers a `syncSafe` resource with a validated snapshot of its descriptor. */
  own<T>(resource: T, descriptor: ISyncReleaseDescriptor): T {
    if (this.#releasing) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeReentrantOwn,
        LifecycleErrorText.scopeReentrantOwn
      )
    }
    this.#assertOpen()
    if (descriptor?.syncSafe !== true) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeSyncViolation,
        LifecycleErrorText.syncScopeRequiresSyncSafe
      )
    }
    /** Same admission as the async scope; the snapshot is what dispose() releases. */
    const admission = admitDescriptor(descriptor, true)
    if (!admission.ok) throw admission.error
    /** Async owners carry this brand and cannot be released synchronously. */
    const brand = (resource as { readonly [ASYNC_OWNER_BRAND]?: true } | null | undefined)?.[
      ASYNC_OWNER_BRAND
    ]
    if (brand === true) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeSyncViolation,
        LifecycleErrorText.syncScopeOwnsAsyncOwner
      )
    }
    if (admission.descriptor.order !== 0) this.#customOrder = true
    this.#entries ??= new OwnedEntryList()
    this.#entries.push({
      resource,
      source: String(this.#nextId++),
      descriptor: admission.descriptor
    })
    return resource
  }

  /** Unregisters a resource without releasing it. */
  release(resource: unknown): boolean {
    return this.#entries?.release(resource) !== undefined
  }

  /** Synchronous, idempotent, never calls user code. */
  close(): void {
    if (this.#lifecycle === LifecycleState.open) this.#lifecycle = LifecycleState.closing
  }

  /** Releases every owned resource synchronously, newest first (stable by descending `order`). */
  dispose(): readonly ICollectedError[] {
    if (this.#disposed || this.#lifecycle === LifecycleState.terminal) {
      if (this.#releasing) {
        throw createLifecycleError(
          LifecycleErrorCode.scopeReentrantDispose,
          LifecycleErrorText.scopeReentrantDispose
        )
      }
      return []
    }
    this.close()
    this.#disposed = true
    /** Atomic snapshot in registration order, released newest first. */
    const released = this.#entries?.drain() ?? []
    this.#entries = undefined
    if (released.length === 0) {
      this.#lifecycle = LifecycleState.terminal
      return []
    }
    released.reverse()
    if (this.#customOrder) orderDisposeItems(released)
    this.#releasing = true
    try {
      /** Reporter routed through the last error boundary for the reporter's own failures. */
      const report = (error: unknown): void => this.#reportSafely(error)
      /** One lazily created closing signal shared by every item of this dispose. */
      const closing = new ClosingSignalSource(this.#createController)
      return executeSyncDisposeTransaction(
        { admitted: released, rejected: noRejectedItems },
        () => this.#createReleaseContext(report, closing),
        this.#errorPolicy,
        this.#report
      )
    } finally {
      this.#releasing = false
      this.#lifecycle = LifecycleState.terminal
    }
  }

  /** Builds one item's fresh context; its `signal` is created on first read, already aborted. */
  #createReleaseContext(
    report: (error: unknown) => void,
    closing: ClosingSignalSource
  ): IReleaseContext {
    return {
      get signal() {
        return closing.read()
      },
      deadlineAt: undefined,
      report
    }
  }

  /** Last error boundary for the reporter's own synchronous failures. */
  #reportSafely(error: unknown): void {
    if (!this.#report) return
    try {
      this.#report(error)
    } catch {
      // Last error boundary for the reporter's own synchronous failures.
    }
  }

  /** Throws the closing or terminal boundary error for a registration after `close()`. */
  #assertOpen(): void {
    if (this.#lifecycle === LifecycleState.terminal) {
      throw createLifecycleError(LifecycleErrorCode.scopeTerminal, LifecycleErrorText.scopeTerminal)
    }
    if (this.#lifecycle === LifecycleState.closing) {
      throw createLifecycleError(LifecycleErrorCode.scopeClosed, LifecycleErrorText.scopeClosing)
    }
  }
}

/** `using` hook: disposes synchronously and discards the collected-error result. */
function disposeForUsing(this: SyncLifecycleScope): void {
  this.dispose()
}

// The supported host's symbol hook is installed once, non-enumerable, on the prototype.
if (disposeKey) {
  Object.defineProperty(SyncLifecycleScope.prototype, disposeKey, { value: disposeForUsing })
}

/**
 * The `syncSafe`-only scope. Exists so a scope that owns nothing but reactive-graph-style nodes can
 * offer a real, deterministic `[Symbol.dispose]` instead of the general `LifecycleScope`'s
 * always-async `[Symbol.asyncDispose]`.
 */
export function createSyncLifecycleScope(
  options: ISyncLifecycleScopeOptions = {}
): ISyncLifecycleScope {
  return new SyncLifecycleScope(options) as unknown as ISyncLifecycleScope
}

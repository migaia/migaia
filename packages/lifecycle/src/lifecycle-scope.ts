import { assertErrorPolicyReporter } from './error-boundary.js'
import type {
  ICollectedError,
  IErrorPolicy,
  ILifecycleOwner,
  IReleaseContext,
  IReleaseDescriptor,
  ILifecycleState
} from './types.js'
import { ASYNC_OWNER_BRAND } from './types.js'
import { DisposerContext } from './disposer-context.js'
import {
  containAsyncRejection,
  createErrorCollector,
  createLifecycleError,
  safeReport
} from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { OwnedEntryList } from './owned-entries.js'
import { LifecycleState } from './state-constants.js'
import { admitDescriptor, isValidDeadline, releaseAdmittedItems } from './dispose-transaction.js'
import { orderDisposeItems } from './disposal-order.js'
import { ClosingSignalSource, captureAbortControllerFactory } from './abort-factory.js'
import type { IAbortController } from './abort.js'
import type { IScheduler } from '@migaia/utils/scheduler'
import { resolveSchedulerOption } from './scheduler.js'

const asyncDisposeKey = (Symbol as typeof Symbol & { asyncDispose?: symbol }).asyncDispose

/**
 * One shared registry for every `LifecycleScope`. The held value is built without ever holding a
 * reference to `target` from _our_ side — it only closes over `descriptor.force` (the caller's own
 * function) and a throwaway `report` callback, matching "held value 不得强引用被注册 target 或 包含 target 的
 * disposer closure". A caller whose own `force` closes over the resource defeats GC collection on
 * their end, which is outside what this package can enforce.
 */
const finalizationRegistry: FinalizationRegistry<GcFallbackRelease> | undefined =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry((release: GcFallbackRelease) => release.run())
    : undefined

export type ILifecycleScopeOptions = {
  readonly errorPolicy?: IErrorPolicy
  /**
   * Reporter for failures the error policy does not throw or collect. Required when `errorPolicy`
   * is `report` or `firstError`; otherwise the factory throws `INVALID_OPTION` with `detail.field:
   * 'report'`.
   */
  readonly report?: (error: unknown) => void
  /** Shared absolute deadline forwarded to every owned resource's release. */
  readonly deadlineAt?: number
  /**
   * Supplies the clock domain for graceful timeouts and deadlines. Defaults to `systemScheduler`
   * and forwards it to `DisposeTransaction`. This keeps injected teardown and mutation queues, such
   * as those in `plugin-host`, in one clock domain.
   */
  readonly scheduler?: IScheduler
}

export type ILifecycleScope = ILifecycleOwner & {
  readonly lifecycle: ILifecycleState
  /** Unregisters a resource without releasing it — the caller has already released it independently. */
  release(resource: unknown): boolean
  /** Synchronous, idempotent, never calls user code. */
  close(): void
  /**
   * Always asynchronous — there is no synchronous `dispose()` on this type. Resolves to the
   * collected errors for the `collect` policy (empty for the other three, which throw/report
   * internally instead).
   *
   * Concurrent external calls reuse the same published Promise even while release is in flight.
   * Only a synchronous call from an active disposer callback is rejected as reentrant, preventing
   * that callback from self-awaiting the Promise it is currently helping to settle.
   */
  dispose(): Promise<readonly ICollectedError[]>
  /** Awaits scope release for `await using`, discarding the collected-error result. */
  [Symbol.asyncDispose](): Promise<void>
}

/** One live registration: the admitted descriptor snapshot taken by `own()`. */
type IScopeEntry = {
  readonly resource: unknown
  readonly source: string
  readonly descriptor: IReleaseDescriptor
  readonly unregisterToken: object | undefined
}

/** Settled starting point for an empty scope's dispose; each call still returns a fresh array. */
const settledEmpty: Promise<void> = Promise.resolve()

/**
 * GC-fallback held value. It holds only the caller's `force`, the scope's reporter and the captured
 * AbortController factory, never the registered resource, so the registry cannot keep the target
 * alive.
 */
class GcFallbackRelease {
  /** Caller-supplied force callback admitted by `own()`. */
  readonly #force: IReleaseDescriptor['force']
  /** Scope reporter captured at construction; absent when the scope has none. */
  readonly #report: ((error: unknown) => void) | undefined
  /** Host AbortController factory captured by the owning scope. */
  readonly #createController: () => IAbortController

  /** Captures the release inputs once; nothing is read again when the finalizer fires. */
  constructor(
    force: IReleaseDescriptor['force'],
    report: ((error: unknown) => void) | undefined,
    createController: () => IAbortController
  ) {
    this.#force = force
    this.#report = report
    this.#createController = createController
  }

  /** Runs `force` once after the resource was collected; every failure goes to the reporter. */
  run(): void {
    /** Fresh, never-aborted context: the owning scope may be long gone. */
    const context: IReleaseContext = {
      signal: this.#createController().signal,
      deadlineAt: undefined,
      report: (error) => this.#reportSafely(error)
    }
    try {
      containAsyncRejection(this.#force(context), (error) => context.report(error))
    } catch (error) {
      context.report(error)
    }
  }

  /** Last error boundary: a GC callback has no caller left to receive a reporter failure. */
  #reportSafely(error: unknown): void {
    if (!this.#report) return
    try {
      this.#report(error)
    } catch {
      // Last error boundary for the reporter's own synchronous failures.
    }
  }
}

/**
 * The async scope. Options are read once at construction and every descriptor is snapshotted by
 * `own()`, so `dispose()` never calls caller getters. Methods live on the prototype and must be
 * called on the scope (`scope.own(...)`), not detached.
 */
class LifecycleScope {
  /** Error policy applied to release failures. */
  readonly #errorPolicy: IErrorPolicy
  /** Reporter for failures the policy does not throw or collect. */
  readonly #report: ((error: unknown) => void) | undefined
  /** Shared absolute deadline forwarded to every release. */
  readonly #deadlineAt: number | undefined
  /** Clock domain forwarded to every release; `undefined` means the default scheduler. */
  readonly #scheduler: IScheduler | undefined
  /** Host AbortController factory captured at construction. */
  readonly #createController: () => IAbortController
  /** `open` → `closing` → `terminal`. */
  #lifecycle: ILifecycleState = LifecycleState.open
  /** Live owned resources; created by the first `own()`. */
  #entries: OwnedEntryList<IScopeEntry> | undefined
  /** Next registration source id. */
  #nextId = 0
  /** Whether any admitted descriptor has a non-zero `order`; zero-only scopes skip ordering. */
  #customOrder = false
  /** Live GC-fallback registrations; dispose skips the unregister pass when there are none. */
  #gcRegistrations = 0
  /** Release-callback marker and `join()` capability; created by the first non-empty dispose. */
  #disposer: DisposerContext | undefined
  /** The one canonical dispose Promise, published before any release callback runs. */
  #disposePromise: Promise<readonly ICollectedError[]> | undefined

  /** Validates the error policy and captures every option once. */
  constructor(options: ILifecycleScopeOptions) {
    this.#errorPolicy = options.errorPolicy ?? 'throw'
    this.#report = options.report
    assertErrorPolicyReporter(this.#errorPolicy, this.#report)
    this.#scheduler = resolveSchedulerOption(options)
    this.#deadlineAt = options.deadlineAt
    this.#createController = captureAbortControllerFactory()
  }

  /** Current lifecycle state. */
  get lifecycle(): ILifecycleState {
    return this.#lifecycle
  }

  /**
   * Registers `resource` with a validated snapshot of `descriptor`. Throws when called from a
   * running release callback, after `close()`, or with an invalid descriptor.
   */
  own<T>(resource: T, descriptor: IReleaseDescriptor): T {
    if (this.#isInsideRelease()) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeReentrantOwn,
        LifecycleErrorText.scopeReentrantOwn
      )
    }
    this.#assertOpen()
    /** The snapshot used at dispose time; later descriptor changes are not observed. */
    const admission = admitDescriptor(descriptor, true)
    if (!admission.ok) throw admission.error
    /** Admitted plain-data descriptor. */
    const admitted = admission.descriptor
    /** Token for unregistering the GC fallback, present only when one was registered. */
    let unregisterToken: object | undefined
    if (
      descriptor.gcFallback &&
      finalizationRegistry &&
      resource !== null &&
      typeof resource === 'object'
    ) {
      unregisterToken = {}
      finalizationRegistry.register(
        resource,
        new GcFallbackRelease(admitted.force, this.#report, this.#createController),
        unregisterToken
      )
      this.#gcRegistrations++
    }
    if (admitted.order !== 0) this.#customOrder = true
    this.#entries ??= new OwnedEntryList()
    this.#entries.push({
      resource,
      source: String(this.#nextId++),
      descriptor: admitted,
      unregisterToken
    })
    return resource
  }

  /** Unregisters a resource without releasing it — the caller has already released it. */
  release(resource: unknown): boolean {
    /** The earliest live registration for `resource`, if any. */
    const entry = this.#entries?.release(resource)
    if (entry === undefined) return false
    // The caller released this resource independently; the GC fallback must not force it again.
    this.#unregisterGcFallback(entry.unregisterToken)
    return true
  }

  /** Synchronous, idempotent, never calls user code. */
  close(): void {
    if (this.#lifecycle === LifecycleState.open) this.#lifecycle = LifecycleState.closing
  }

  /**
   * Releases every owned resource once, newest first (stable by descending `order`). Concurrent
   * calls share one Promise; a synchronous call from a running release callback throws.
   */
  dispose(): Promise<readonly ICollectedError[]> {
    if (this.#disposePromise) {
      if (this.#isInsideRelease()) {
        throw createLifecycleError(
          LifecycleErrorCode.scopeReentrantDispose,
          LifecycleErrorText.scopeReentrantDispose
        )
      }
      // Concurrent, non-reentrant call: reuse the one real disposal in flight.
      return this.#disposePromise
    }
    if (this.#lifecycle === LifecycleState.terminal) return Promise.resolve([])
    this.close()
    /** Atomic snapshot: nothing added later is released, nothing is skipped or doubled. */
    const snapshot = this.#entries?.drain() ?? []
    this.#entries = undefined
    if (snapshot.length === 0) {
      this.#disposePromise = settledEmpty.then(() => this.#finishEmpty())
      return this.#disposePromise
    }
    if (this.#gcRegistrations > 0) {
      // Every entry is about to be released explicitly; no GC fallback may fire afterwards.
      for (const entry of snapshot) this.#unregisterGcFallback(entry.unregisterToken)
    }
    // Newest first; the stable order pass keeps that LIFO sequence among equal `order` values.
    snapshot.reverse()
    if (this.#customOrder) orderDisposeItems(snapshot)
    this.#disposer = new DisposerContext()
    // Publish the Promise before any release callback runs, so a callback that synchronously calls
    // dispose() is caught as reentrant instead of starting a second teardown.
    let resolveDispose!: (value: readonly ICollectedError[]) => void
    let rejectDispose!: (error: unknown) => void
    this.#disposePromise = new Promise<readonly ICollectedError[]>((resolve, reject) => {
      resolveDispose = resolve
      rejectDispose = reject
    })
    this.#release(snapshot).then(resolveDispose, rejectDispose)
    return this.#disposePromise
  }

  /** Moves an empty scope to terminal and returns its (empty) result. */
  #finishEmpty(): readonly ICollectedError[] {
    this.#lifecycle = LifecycleState.terminal
    return []
  }

  /** Releases the ordered snapshot through the shared release loop, then marks terminal. */
  async #release(items: readonly IScopeEntry[]): Promise<readonly ICollectedError[]> {
    try {
      /** Applies the error policy to every release failure. */
      const collector = createErrorCollector(this.#errorPolicy, this.#report)
      await releaseAdmittedItems(
        items,
        this.#createReleaseContext(),
        isValidDeadline(this.#deadlineAt),
        (source, error) => collector.add(source, error)
      )
      return collector.finalize(LifecycleErrorText.disposeTransactionFailed)
    } finally {
      this.#lifecycle = LifecycleState.terminal
    }
  }

  /**
   * Builds the one context shared by every release callback of this dispose. `signal` is created on
   * first read, already aborted with the scope-closed reason; callbacks that never read it cost no
   * AbortController.
   */
  #createReleaseContext(): IReleaseContext {
    /** Lazily created closing signal shared by this dispose's release callbacks. */
    const closing = new ClosingSignalSource(this.#createController)
    /** Reporter routed through the shared containment rules. */
    const report = this.#report
    return {
      get signal() {
        return closing.read()
      },
      deadlineAt: this.#deadlineAt,
      scheduler: this.#scheduler,
      report: (error) => safeReport(report, error),
      disposer: this.#disposer
    }
  }

  /** Whether a release callback of this scope is on the current synchronous stack. */
  #isInsideRelease(): boolean {
    return this.#disposer !== undefined && DisposerContext.isActive(this.#disposer)
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

  /** Cancels one GC-fallback registration, when the entry had one. */
  #unregisterGcFallback(unregisterToken: object | undefined): void {
    if (unregisterToken === undefined) return
    finalizationRegistry?.unregister(unregisterToken)
    this.#gcRegistrations--
  }
}

/** `await using` hook: awaits `dispose()` and discards the collected-error result. */
async function disposeForAsyncUsing(this: LifecycleScope): Promise<void> {
  await this.dispose()
}

// Brand read by SyncLifecycleScope to reject async owners; shared through the prototype.
Object.defineProperty(LifecycleScope.prototype, ASYNC_OWNER_BRAND, { value: true })
// The supported host's symbol hook is installed once, non-enumerable, on the prototype.
if (asyncDisposeKey) {
  Object.defineProperty(LifecycleScope.prototype, asyncDisposeKey, {
    value: disposeForAsyncUsing
  })
}

/**
 * Creates the general-purpose async scope: register each resource with `own(resource, descriptor)`
 * where it is created, then release them all with one `dispose()` when the owner (a page, a
 * connection, a service) ends.
 *
 * Release runs in reverse registration order, so a resource registered after the one it depends on
 * is released first. Every resource is attempted even when one fails; failures surface through the
 * error policy (`throw` by default, after everything ran; or `collect`/`report`). Concurrent
 * `dispose()` calls share one Promise. After `close()` or `dispose()`, `own()` throws
 * `SCOPE_CLOSED`/`SCOPE_TERMINAL`; calling `own()`/`dispose()` from inside one of its own disposers
 * throws the reentrancy codes. Supports `await using`.
 */
export function createLifecycleScope(options: ILifecycleScopeOptions = {}): ILifecycleScope {
  return new LifecycleScope(options) as unknown as ILifecycleScope
}

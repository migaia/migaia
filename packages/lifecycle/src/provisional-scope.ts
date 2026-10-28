import { attachLifecycleSecondaryErrors } from './error-boundary.ts'
import type { ILifecycleOwner, IReleaseDescriptor } from './types.ts'
import { ASYNC_OWNER_BRAND } from './types.ts'
import { createLifecycleError, createLifecycleFailure } from './errors.ts'
import { LifecycleErrorCode } from './error-code.ts'
import { LifecycleErrorText } from './error-text.ts'
import {
  admitDescriptor,
  releaseInPlanOrder,
  type IAdmittedDisposeItem
} from './dispose-transaction.ts'
import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import { captureAbortControllerFactory } from './abort-factory.ts'
import type { IAbortController } from './abort.ts'
import {
  observeAbortSubscription,
  type IObservedAbortSubscription
} from './observed-subscription.ts'
import {
  LifecycleErrorPolicy,
  ProvisionalScopeState,
  type IProvisionalScopeState
} from './state-constants.ts'

export type IProvisionalScopeOptions = {
  /** Forwarded so `signal` also reflects a parent's abort (e.g. a superseded generation). */
  readonly parentSignal?: IAbortSignal
}

export type IProvisionalScope = {
  readonly signal: INativeAbortSignal
  own<T>(resource: T, descriptor: IReleaseDescriptor): T
  /**
   * Transfers every owned resource to `parent`, in registration order. If `parent.own()` rejects
   * partway (e.g. `parent` is already closing), everything already transferred stays with `parent`;
   * everything not yet transferred is released by this scope (in reverse order) and **awaited**
   * before the original error is rethrown — nothing is left owned by neither side, and the returned
   * Promise settles only after the compensation has completed.
   */
  commitTo(parent: ILifecycleOwner): Promise<void>
  /**
   * Releases every owned resource in reverse order. A single failure keeps its annotated native
   * identity; multiple failures form an AggregateError. Repeated calls reuse the first Promise,
   * including its rejection.
   */
  rollback(): Promise<void>
}

type IEntry = {
  readonly resource: unknown
  readonly source: string
  /** The caller's descriptor, handed unchanged to `parent.own()` on commit. */
  readonly descriptor: IReleaseDescriptor
  /** Order-blind snapshot taken by `own()`, released on rollback. */
  readonly admitted: IReleaseDescriptor
}

/**
 * The provisional owner. Without a parent signal its AbortController and settle reason are created
 * on the first `signal` read; with one, the controller exists from construction so the parent's
 * abort can be forwarded. Methods live on the prototype and must be called on the scope.
 */
class ProvisionalScope {
  /** Host AbortController factory captured at construction. */
  readonly #createController: () => IAbortController
  /** This scope's controller; eager only when a parent signal must be forwarded. */
  #controller: IAbortController | undefined
  /** Live parent abort subscription, detached at settlement. */
  #parentSubscription: IObservedAbortSubscription | undefined
  /** Listener-cleanup failures reported by the parent subscription. */
  readonly #registrationErrors: unknown[] = []
  /** Owned resources in registration order. */
  #entries: IEntry[] = []
  /** Next registration source id. */
  #nextId = 0
  /** Pending → committed | rolledback. */
  #state: IProvisionalScopeState = ProvisionalScopeState.pending
  /** How the scope settled; the lazy signal is aborted with the matching reason. */
  #settledBy: IProvisionalScopeState = ProvisionalScopeState.pending
  /** The one settle Promise reused by repeated rollback() and commit compensation. */
  #rollbackPromise: Promise<void> | undefined

  /**
   * Captures the host controller factory and subscribes to `parentSignal` synchronously, so a
   * failing registration throws from the factory.
   */
  constructor(options: IProvisionalScopeOptions) {
    this.#createController = captureAbortControllerFactory()
    /** Read once; absent means no forwarding and a lazily created controller. */
    const parentSignal = options.parentSignal
    if (parentSignal === undefined) return
    this.#controller = this.#createController()
    if (parentSignal.aborted) {
      this.#controller.abort(parentSignal.reason)
      return
    }
    try {
      this.#parentSubscription = observeAbortSubscription(
        parentSignal,
        (reason) => this.#controller!.abort(reason),
        (error) => this.#registrationErrors.push(error)
      )
      this.#parentSubscription.retryRegistrationCleanup()
      if (this.#registrationErrors.length > 0) throw this.#registrationErrors[0]
    } catch (error) {
      throw attachLifecycleSecondaryErrors(
        error,
        this.#registrationErrors,
        LifecycleErrorText.provisionalCleanupFailed
      )
    }
  }

  /** Aborted once the scope commits or rolls back (or the parent aborts). */
  get signal(): INativeAbortSignal {
    if (this.#controller === undefined) {
      this.#controller = this.#createController()
      if (this.#settledBy !== ProvisionalScopeState.pending)
        this.#controller.abort(createSettleReason(this.#settledBy))
    }
    return this.#controller.signal as INativeAbortSignal
  }

  /** Registers a resource with a validated, order-blind snapshot of its descriptor. */
  own<T>(resource: T, descriptor: IReleaseDescriptor): T {
    this.#assertPending()
    // The parent's own() validates `order` again on commit.
    const admission = admitDescriptor(descriptor, false)
    if (!admission.ok) throw admission.error
    this.#entries.push({
      resource,
      source: String(this.#nextId++),
      descriptor,
      admitted: admission.descriptor
    })
    return resource
  }

  /**
   * Releases every owned resource in reverse order. Repeated calls reuse the first Promise,
   * including its rejection; a committed scope returns a rejected Promise.
   */
  rollback(): Promise<void> {
    if (this.#rollbackPromise) return this.#rollbackPromise
    if (this.#state !== ProvisionalScopeState.pending) return Promise.reject(createSettledError())
    this.#state = ProvisionalScopeState.rolledBack
    // Publish the Promise before aborting, so an abort listener that calls rollback() gets it.
    let resolveRollback!: () => void
    let rejectRollback!: (error: unknown) => void
    this.#rollbackPromise = new Promise<void>((resolve, reject) => {
      resolveRollback = resolve
      rejectRollback = reject
    })
    /** Abort or detach failure; the release still runs and the failure is rethrown after it. */
    const settleError = this.#settle(ProvisionalScopeState.rolledBack)
    /** Owned resources, released newest first. */
    const remaining = this.#takeEntries()
    remaining.reverse()
    releaseRollback(remaining, settleError).then(resolveRollback, rejectRollback)
    return this.#rollbackPromise
  }

  /**
   * Transfers every owned resource to `parent` in registration order. A partial transfer keeps what
   * the parent accepted and releases the rest before the original error is rethrown.
   */
  commitTo(parent: ILifecycleOwner): Promise<void> {
    this.#assertPending()
    /** Owned resources in registration order. */
    const remaining = this.#takeEntries()
    this.#state = ProvisionalScopeState.committed
    /** Abort or detach failure, attached after the transfer settles. */
    const settleError = this.#settle(ProvisionalScopeState.committed)
    /** Transfer plus compensation for anything the parent refused. */
    const transferPromise = this.#commitEntries(parent, remaining)
    if (settleError === noSettleError) return transferPromise
    return transferPromise.then(
      () => {
        throw settleError
      },
      (transferError: unknown) => {
        throw attachLifecycleSecondaryErrors(
          transferError,
          [settleError],
          LifecycleErrorText.provisionalCleanupFailed
        )
      }
    )
  }

  /** Hands entries to `parent`; on refusal releases the rest and rethrows the parent's error. */
  async #commitEntries(parent: ILifecycleOwner, remaining: readonly IEntry[]): Promise<void> {
    /** Index of the first entry the parent has not accepted. */
    let index = 0
    try {
      for (; index < remaining.length; index++) {
        /** Entry being transferred. */
        const entry = remaining[index]!
        parent.own(entry.resource, entry.descriptor)
      }
    } catch (error) {
      // Everything from `index` onward never reached `parent` and must be released by this scope;
      // the compensation is awaited before this Promise settles.
      const leftover = remaining.slice(index)
      leftover.reverse()
      this.#state = ProvisionalScopeState.rolledBack
      // Compensation is the rollback: reuse the single `#rollbackPromise`.
      const cleanupPromise = releaseInPlanOrder(
        toAdmittedItems(leftover),
        LifecycleErrorPolicy.collect
      )
      this.#rollbackPromise = cleanupPromise.then(() => undefined)
      /** Raw cleanup failures, in release order. */
      const cleanupErrors = (await cleanupPromise).map((entry) => entry.error)
      // A closing/terminal parent is surfaced as its own provisional code, keeping the parent's
      // error as `cause`.
      const parentCode = (error as { readonly code?: unknown } | null)?.code
      if (
        parentCode === LifecycleErrorCode.scopeClosed ||
        parentCode === LifecycleErrorCode.scopeTerminal
      ) {
        throw createLifecycleError(
          LifecycleErrorCode.provisionalParentClosed,
          LifecycleErrorText.provisionalParentClosed,
          { cause: error, errors: cleanupErrors }
        )
      }
      throw attachLifecycleSecondaryErrors(
        error,
        cleanupErrors,
        LifecycleErrorText.provisionalCleanupFailed
      )
    }
  }

  /**
   * Aborts the signal (now, if it exists; lazily otherwise) and detaches the parent listener.
   * Returns the combined failure, or `noSettleError` when both steps succeeded.
   */
  #settle(settledBy: IProvisionalScopeState): unknown {
    this.#settledBy = settledBy
    /** First settle failure; later failures are attached to it. */
    let settleError: unknown = noSettleError
    if (this.#controller !== undefined) {
      try {
        this.#controller.abort(createSettleReason(settledBy))
      } catch (error) {
        settleError = error
      }
    }
    try {
      this.#detachParent()
    } catch (error) {
      settleError =
        settleError === noSettleError
          ? error
          : attachLifecycleSecondaryErrors(
              settleError,
              [error],
              LifecycleErrorText.provisionalCleanupFailed
            )
    }
    return settleError
  }

  /** Unsubscribes from the parent, then throws any listener-cleanup failure seen so far. */
  #detachParent(): void {
    this.#parentSubscription?.unsubscribe()
    if (this.#registrationErrors.length === 0) return
    throw attachLifecycleSecondaryErrors(
      createLifecycleFailure(
        LifecycleErrorCode.scopeDisposalFailed,
        LifecycleErrorText.provisionalCleanupFailed,
        this.#registrationErrors[0]
      ),
      this.#registrationErrors.slice(1),
      LifecycleErrorText.provisionalCleanupFailed
    )
  }

  /** Removes and returns every owned entry. */
  #takeEntries(): IEntry[] {
    /** Entries owned before settlement. */
    const entries = this.#entries
    this.#entries = []
    return entries
  }

  /** Throws PROVISIONAL_SETTLED once the scope has committed or rolled back. */
  #assertPending(): void {
    if (this.#state !== ProvisionalScopeState.pending) throw createSettledError()
  }
}

/** Sentinel meaning "abort and detach both succeeded"; distinct from any thrown value. */
const noSettleError: unique symbol = Symbol('no settle error')

/** Builds the PROVISIONAL_SETTLED error for use after commit or rollback. */
function createSettledError(): Error {
  return createLifecycleError(
    LifecycleErrorCode.provisionalSettled,
    LifecycleErrorText.provisionalSettled
  )
}

/** Builds the `signal.reason` for a scope settled by commit or rollback. */
function createSettleReason(settledBy: IProvisionalScopeState): Error {
  return createLifecycleError(
    LifecycleErrorCode.provisionalSettled,
    settledBy === ProvisionalScopeState.committed
      ? LifecycleErrorText.provisionalCommittedReason
      : LifecycleErrorText.provisionalRolledBackReason
  )
}

/**
 * Releases rollback entries under the `throw` policy, then rejects with the settle failure (with
 * any release failure attached) or with the release failure alone.
 */
async function releaseRollback(items: readonly IEntry[], settleError: unknown): Promise<void> {
  if (items.length > 0) {
    try {
      await releaseInPlanOrder(toAdmittedItems(items), LifecycleErrorPolicy.throw)
    } catch (cleanupError) {
      if (settleError === noSettleError) throw cleanupError
      throw attachLifecycleSecondaryErrors(
        settleError,
        [cleanupError],
        LifecycleErrorText.provisionalCleanupFailed
      )
    }
  }
  if (settleError !== noSettleError) throw settleError
}

/** Maps entries to release items carrying their admitted snapshot; one pass over the list. */
function toAdmittedItems(items: readonly IEntry[]): IAdmittedDisposeItem[] {
  /** Release items in the entries' order. */
  const admitted: IAdmittedDisposeItem[] = []
  for (const entry of items) admitted.push({ source: entry.source, descriptor: entry.admitted })
  return admitted
}

// Brand read by SyncLifecycleScope to reject async owners; shared through the prototype.
Object.defineProperty(ProvisionalScope.prototype, ASYNC_OWNER_BRAND, { value: true })

/**
 * Creates a temporary owner for multi-step initialisation: register what each step creates, then
 * either hand everything to the long-lived scope with `commitTo(parent)` or release it with
 * `rollback()` when a step fails — never both, never neither.
 *
 * `rollback()` releases in reverse order. If the parent refuses partway through `commitTo()`, what
 * was handed over stays with the parent and the rest is released and awaited before the error is
 * rethrown (wrapped as `PROVISIONAL_PARENT_CLOSED` when the parent was closing).
 */
export function createProvisionalScope(options: IProvisionalScopeOptions = {}): IProvisionalScope {
  return new ProvisionalScope(options) as unknown as IProvisionalScope
}

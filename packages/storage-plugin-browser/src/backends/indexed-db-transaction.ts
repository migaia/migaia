import {
  StorageContractError,
  StorageContractErrorCode,
  TransactionBeforeStage,
  TransactionObservedStage,
  type ITransactionScope,
  type ITransactionStageObserver,
  type IConcurrencyStageObserver,
  type IOperationContext
} from '@migaia/storage-contract'
import {
  type createTransactionOwner,
  reportCleanupError,
  type IStorageOperationRuntime,
  readAbortReason
} from '@migaia/storage-host/sdk'
import { raceWithAbort, type IAbortSignal } from '@migaia/utils/promise'
import { subscribeToAbort } from './errors.js'
import type { IStorageErrorFamily } from './errors.js'
import { StorageErrorCode, createStorageAggregateError } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import { StorageBackend } from '../constants.js'
import {
  installIdbRequestHandlers,
  installIdbTransactionHandlers,
  readIdbRequestError,
  readIdbTransactionError
} from '../utils/idb-request.js'

/** Observations borrow the host's existing registry and cannot alter native transaction results. */
export function observeIndexedDbStage(
  observer: ITransactionStageObserver | IConcurrencyStageObserver | undefined,
  action: Exclude<
    keyof ITransactionStageObserver | keyof IConcurrencyStageObserver,
    'kind' | 'forTransaction' | 'report'
  >,
  runtime: IStorageOperationRuntime,
  ...args: unknown[]
): void {
  if (observer === undefined) return
  try {
    /** Observation rejection is reported without yielding the native activity window. */
    const callbacks = observer as unknown as Record<
      string,
      ((...values: unknown[]) => unknown) | undefined
    >
    void Promise.resolve(callbacks[action]?.(...args)).catch((error) =>
      reportCleanupError(runtime.reporter, error)
    )
  } catch (cause) {
    reportCleanupError(runtime.reporter, cause)
  }
}

/** One adapter attempt borrows the original contract owner and one already-open native transaction. */

/**
 * One admitted native IndexedDB attempt owns callback draining, terminal choice and rollback
 * diagnostics.
 */
/** Exact native-attempt ports retain the existing transaction, journal and lifecycle owners. */
type IIndexedDbNativeAttemptInput<TValue, TResult, TScope> = {
  readonly transaction: IDBTransaction
  readonly guardStoreName: string
  readonly guardKey: IDBValidKey
  readonly owner: ReturnType<typeof createTransactionOwner<TValue>>
  readonly createScope: () => TScope
  readonly run: (scope: TScope) => TResult
  readonly signal?: IAbortSignal
  /** Borrow the original captured attempt context; the canonical owner adds no second budget. */
  readonly context?: IOperationContext
  readonly runtime: IStorageOperationRuntime
  readonly normalizeFailure: (error: unknown) => IStorageErrorFamily
  readonly beforeCommit?: (scope: TScope) => void | PromiseLike<void>
  readonly observer?: ITransactionStageObserver
  readonly waitPhysical: <T>(pending: Promise<T>) => Promise<T>
  readonly registerNative: (scope: TScope, abort: () => void) => () => void
  /** Private journal observers receive only the actual native complete/abort decision. */
  readonly onNativeEnd?: (committed: boolean) => void
  /** The same registered native view binds its commit bridge before the business callback. */
  readonly onRegistered?: (scope: TScope) => void
  /** Final synchronous native decision, after the owner's actual finalizers and observers. */
  readonly validateCommit?: () => void
  readonly changedKeys: () => number
  readonly afterCommit: () => void
}
type IIndexedDbAttemptContext<TValue, TResult, TScope> = {
  /** Original input is captured before native construction begins. */
  readonly input: IIndexedDbNativeAttemptInput<TValue, TResult, TScope>

  /** Attempt cancellation requests native rollback; accepted callbacks still drain before release. */
  abortController: AbortController

  /** The original callback remains owned even when cancellation wins its result race. */
  acceptedRun: Promise<Awaited<TResult>> | undefined

  /** An already-started finalizer round must settle before its native attempt releases locks. */
  acceptedFinalizers: Promise<void> | undefined

  /** The backend retains the first normalized failure and never replaces it during cleanup. */
  primary: IStorageErrorFamily | undefined

  /** A guard only keeps abort possible; it never invokes or queues a business request. */
  guardRunning: boolean

  /** Physical completion is distinct from callback completion and abort requests. */
  nativeEnded: boolean

  /** Commit is permitted only after callback activity and all original finalizers succeed. */
  commitChosen: boolean

  /** Native rollback is requested once even when several accepted requests fail together. */
  abortRequested: boolean

  /** Physical admission also stops when disposal or a native failure ends the pending attempt. */
  rejectAdmission: ((error: unknown) => void) | undefined

  /** Cleanup failures remain reachable with the primary failure first. */
  cleanupFailures: unknown[]

  /** The original owner registration is installed before any user callback can run. */
  registration:
    | ReturnType<IIndexedDbAttemptContext<TValue, TResult, TScope>['input']['owner']['register']>
    | undefined

  /** Native end is observed without a signal race that could release resources before onabort. */
  ended: Promise<void>

  /** Resolving this request marks actual native admission rather than logical key acquisition. */
  resolveAdmission: () => void

  /** Setup/request failure rejects physical admission with the same first failure. */
  /** A single first guard request distinguishes native scheduling from a user policy conflict. */
  admitted: Promise<void>

  /** The user view and all derived views use this same backend method factory. */
  scope: TScope

  /** The host observer binds immutable transaction facts while this real view is still admitted. */
  observer: ITransactionStageObserver | undefined

  /** Root disposal reaches this same native attempt, without creating a second resource owner. */
  unregisterNative: () => void

  /** Cancellation listener cleanup cannot replace the attempt's primary failure. */
  unsubscribeAbort: () => void
}
export async function runNativeIndexedDbTransaction<
  TValue,
  TResult,
  TScope extends ITransactionScope<TValue> = ITransactionScope<TValue>
>(input: IIndexedDbNativeAttemptInput<TValue, TResult, TScope>): Promise<Awaited<TResult>> {
  /** Initialize native facts in original construction order before publishing any port. */
  const attemptState = { input } as IIndexedDbAttemptContext<TValue, TResult, TScope>

  initializeIndexedDbAttempt(attemptState)

  try {
    registerIndexedDbAttempt(attemptState)
    continueGuard(attemptState)
    if (attemptState.primary !== undefined) throw attemptState.primary
    await attemptState.input.waitPhysical(attemptState.admitted)
    if (attemptState.primary !== undefined) throw attemptState.primary
    observeIndexedDbStage(
      attemptState.observer,
      TransactionObservedStage.onTransactionStart,
      attemptState.input.runtime
    )
    /** The race reports late rejection; the original Promise remains part of attempt cleanup. */
    const result = await raceWithAbort(
      () => {
        attemptState.acceptedRun = Promise.resolve(attemptState.input.run(attemptState.scope))
        return attemptState.acceptedRun
      },
      {
        signal: attemptState.abortController.signal,
        cleanupPolicy: 'report',
        report: attemptState.input.runtime.reporter
      }
    )
    /** No guard event is used to re-enter this callback's activity window. */
    assertNativeActive(attemptState)
    attemptState.registration!.stopAdmission()
    await raceWithAbort(
      () => {
        attemptState.acceptedFinalizers = attemptState.registration!.runFinalizers()
        return attemptState.acceptedFinalizers
      },
      {
        signal: attemptState.abortController.signal,
        cleanupPolicy: 'report',
        report: attemptState.input.runtime.reporter
      }
    )
    if (attemptState.primary !== undefined) throw attemptState.primary
    assertNativeActive(attemptState)
    attemptState.input.validateCommit?.()
    attemptState.commitChosen = true
    attemptState.guardRunning = false
    await attemptState.ended
    attemptState.input.afterCommit()
    observeIndexedDbStage(
      attemptState.observer,
      TransactionObservedStage.afterCommit,
      attemptState.input.runtime,
      attemptState.input.changedKeys()
    )
    return result
  } catch (cause) {
    fail(attemptState, attemptState.primary ?? cause)
    /** Late results retain their existing race observer; settlement only drains accepted work. */
    await Promise.allSettled([attemptState.acceptedRun, attemptState.acceptedFinalizers])
    try {
      await attemptState.registration?.closeIterators()
    } catch (error) {
      attemptState.cleanupFailures.push(error)
    }
    await attemptState.ended.catch(() => undefined)
    observeIndexedDbStage(
      attemptState.observer,
      TransactionObservedStage.afterRollback,
      attemptState.input.runtime,
      attemptState.primary?.code
    )
    if (attemptState.cleanupFailures.length > 0)
      throw createStorageAggregateError(
        StorageErrorCode.transactionFailed,
        attemptState.primary?.message ?? StorageErrorText.indexedDbTransactionEndedEarly,
        [attemptState.primary, ...attemptState.cleanupFailures]
      )
    throw attemptState.primary
  } finally {
    attemptState.guardRunning = false
    attemptState.registration?.stopAdmission()
    attemptState.unsubscribeAbort()
    attemptState.unregisterNative()
    attemptState.registration?.close()
    observeIndexedDbStage(
      attemptState.observer,
      TransactionObservedStage.onTransactionClose,
      attemptState.input.runtime
    )
  }
}

/** Stop new admission and the guard before requesting the real native rollback. */
function fail<TValue, TResult, TScope extends ITransactionScope<TValue>>(
  attemptState: IIndexedDbAttemptContext<TValue, TResult, TScope>,
  error: unknown
): void {
  if (attemptState.primary === undefined)
    attemptState.primary = attemptState.input.normalizeFailure(error)
  attemptState.guardRunning = false
  attemptState.registration?.stopAdmission()
  attemptState.rejectAdmission?.(attemptState.primary)
  if (!attemptState.abortController.signal.aborted)
    attemptState.abortController.abort(attemptState.primary)
  if (!attemptState.nativeEnded && !attemptState.abortRequested) {
    attemptState.abortRequested = true
    try {
      attemptState.input.transaction.abort()
    } catch (cause) {
      attemptState.cleanupFailures.push(cause)
    }
  }
}

/** Native end is observed without a signal race that could release resources before onabort. */
function createIndexedDbAttemptEnded<TValue, TResult, TScope extends ITransactionScope<TValue>>(
  attemptState: IIndexedDbAttemptContext<TValue, TResult, TScope>
): IIndexedDbAttemptContext<TValue, TResult, TScope>['ended'] {
  return new Promise<void>((resolve, reject) => {
    installIdbTransactionHandlers(
      attemptState.input.transaction,
      () => {
        attemptState.nativeEnded = true
        attemptState.input.onNativeEnd?.(true)
        if (!attemptState.commitChosen) {
          fail(attemptState, new Error(StorageErrorText.indexedDbTransactionEndedEarly))
          reject(attemptState.primary)
        } else resolve()
      },
      () => {
        /** Request rejection owns its original error; onabort observes the physical terminal. */
      },
      () => {
        attemptState.nativeEnded = true
        attemptState.input.onNativeEnd?.(false)
        attemptState.guardRunning = false
        fail(
          attemptState,
          attemptState.primary ?? readIdbTransactionError(attemptState.input.transaction)
        )
        reject(attemptState.primary)
      }
    )
  })
}

/** Issue only a read of the existing revision key from the current native request event. */
function continueGuard<TValue, TResult, TScope extends ITransactionScope<TValue>>(
  attemptState: IIndexedDbAttemptContext<TValue, TResult, TScope>
): void {
  if (!attemptState.guardRunning || attemptState.nativeEnded) return
  try {
    /** This pending request keeps the original transaction abortable until the commit decision. */
    const request = attemptState.input.transaction
      .objectStore(attemptState.input.guardStoreName)
      .get(attemptState.input.guardKey)
    installIdbRequestHandlers(
      request,
      () => {
        attemptState.resolveAdmission()
        continueGuard(attemptState)
      },
      () => {
        fail(attemptState, readIdbRequestError(request))
        attemptState.rejectAdmission?.(attemptState.primary)
      }
    )
  } catch (cause) {
    fail(attemptState, cause)
    attemptState.rejectAdmission?.(attemptState.primary)
  }
}

/** This probe runs in the callback's own context; guard success never authorizes its requests. */
function assertNativeActive<TValue, TResult, TScope extends ITransactionScope<TValue>>(
  attemptState: IIndexedDbAttemptContext<TValue, TResult, TScope>
): void {
  attemptState.input.transaction
    .objectStore(attemptState.input.guardStoreName)
    .get(attemptState.input.guardKey)
}

/** Initialize original native terminal observation before creating an authentic public scope. */
function initializeIndexedDbAttempt<TValue, TResult, TScope extends ITransactionScope<TValue>>(
  attemptState: IIndexedDbAttemptContext<TValue, TResult, TScope>
): void {
  /** Attempt cancellation requests native rollback; accepted callbacks still drain before release. */
  attemptState.abortController = new AbortController()

  /** A guard only keeps abort possible; it never invokes or queues a business request. */
  attemptState.guardRunning = true

  /** Physical completion is distinct from callback completion and abort requests. */
  attemptState.nativeEnded = false

  /** Commit is permitted only after callback activity and all original finalizers succeed. */
  attemptState.commitChosen = false

  /** Native rollback is requested once even when several accepted requests fail together. */
  attemptState.abortRequested = false

  /** Cleanup failures remain reachable with the primary failure first. */
  attemptState.cleanupFailures = []
  attemptState.ended = createIndexedDbAttemptEnded(attemptState)

  /** The same end is awaited below; early rejection must already have an observer. */
  void attemptState.ended.catch(() => undefined)

  /** Setup/request failure rejects physical admission with the same first failure. */
  /** A single first guard request distinguishes native scheduling from a user policy conflict. */
  attemptState.admitted = new Promise<void>((resolve, reject) => {
    attemptState.resolveAdmission = resolve
    attemptState.rejectAdmission = reject
  })

  if (attemptState.primary !== undefined) attemptState.rejectAdmission?.(attemptState.primary)

  /** Admission is also observed if an earlier setup failure prevents reaching its await. */
  void attemptState.admitted.catch(() => undefined)

  /** The user view and all derived views use this same backend method factory. */
  attemptState.scope = attemptState.input.createScope()

  /** Root disposal reaches this same native attempt, without creating a second resource owner. */
  attemptState.unregisterNative = (): void => {}

  /** Cancellation listener cleanup cannot replace the attempt's primary failure. */
  attemptState.unsubscribeAbort = (): void => {}
}
/**
 * Register the authentic view and its original cancellation/close ports without yielding native
 * activity.
 */
function registerIndexedDbAttempt<TValue, TResult, TScope extends ITransactionScope<TValue>>(
  attemptState: IIndexedDbAttemptContext<TValue, TResult, TScope>
): void {
  attemptState.registration = attemptState.input.owner.register(attemptState.scope, {
    context: attemptState.input.context,
    createScope: attemptState.input.createScope,
    onFailure: (error: unknown) => fail(attemptState, error),
    beforeCommit: async (view) => {
      await attemptState.input.beforeCommit?.(view)
      /**
       * The final observation binds the owner's dedicated live check view, never the closed
       * callback view.
       */
      let commitObserver: ITransactionStageObserver | undefined
      try {
        commitObserver = attemptState.input.observer?.forTransaction(view)
      } catch (cause) {
        reportCleanupError(attemptState.input.runtime.reporter, cause)
      }
      observeIndexedDbStage(
        commitObserver,
        TransactionBeforeStage.beforeCommit,
        attemptState.input.runtime
      )
    }
  })
  try {
    attemptState.observer = attemptState.input.observer?.forTransaction(attemptState.scope)
  } catch (cause) {
    reportCleanupError(attemptState.input.runtime.reporter, cause)
  }
  attemptState.unregisterNative = attemptState.input.registerNative(attemptState.scope, () =>
    fail(
      attemptState,
      new StorageContractError(StorageContractErrorCode.disposed, {
        backend: StorageBackend.indexedDb
      })
    )
  )
  attemptState.input.onRegistered?.(attemptState.scope)
  attemptState.unsubscribeAbort = subscribeToAbort(
    attemptState.input.signal,
    () =>
      fail(
        attemptState,
        new StorageContractError(StorageContractErrorCode.aborted, {
          backend: StorageBackend.indexedDb,
          cause: readAbortReason(attemptState.input.signal)
        })
      ),
    attemptState.input.runtime.reporter
  )
  observeIndexedDbStage(
    attemptState.observer,
    TransactionBeforeStage.beforeTransaction,
    attemptState.input.runtime
  )
}

import {
  StorageContractError,
  StorageContractErrorCode,
  TransactionBeforeStage,
  TransactionObservedStage,
  type createTransactionOwner,
  type ITransactionScope,
  type ITransactionStageObserver,
  type IConcurrencyStageObserver,
  type IOperationContext
} from '@migaia/storage-contract'
import { raceWithAbort, type IAbortSignal } from '@migaia/utils/promise'
import {
  reportCleanupError,
  type IStorageOperationRuntime
} from '@migaia/storage-host/authoring/backend'
import { readAbortReason } from '@migaia/storage-host/authoring/backend'
import { subscribeToAbort } from './errors.js'
import type { IStorageErrorFamily } from './errors.js'
import { StorageErrorCode, createStorageAggregateError } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import { StorageBackend } from '../constants.js'
import {
  installIdbRequestHandlers,
  installIdbTransactionHandlers,
  afterIdbTransactionAbort,
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
export async function runNativeIndexedDbTransaction<
  TValue,
  TResult,
  TScope extends ITransactionScope<TValue> = ITransactionScope<TValue>
>(input: {
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
}): Promise<Awaited<TResult>> {
  /** Attempt cancellation requests native rollback; accepted callbacks still drain before release. */
  const abortController = new AbortController()
  /** The original callback remains owned even when cancellation wins its result race. */
  let acceptedRun: Promise<Awaited<TResult>> | undefined
  /** An already-started finalizer round must settle before its native attempt releases locks. */
  let acceptedFinalizers: Promise<void> | undefined
  /** The backend retains the first normalized failure and never replaces it during cleanup. */
  let primary: IStorageErrorFamily | undefined
  /** A guard only keeps abort possible; it never invokes or queues a business request. */
  let guardRunning = true
  /** Physical completion is distinct from callback completion and abort requests. */
  let nativeEnded = false
  /** Commit is permitted only after callback activity and all original finalizers succeed. */
  let commitChosen = false
  /** Native rollback is requested once even when several accepted requests fail together. */
  let abortRequested = false
  /** Physical admission also stops when disposal or a native failure ends the pending attempt. */
  let rejectAdmission: ((error: unknown) => void) | undefined
  /** Cleanup failures remain reachable with the primary failure first. */
  const cleanupFailures: unknown[] = []
  /** The original owner registration is installed before any user callback can run. */
  let registration: ReturnType<typeof input.owner.register> | undefined

  /** Stop new admission and the guard before requesting the real native rollback. */
  const fail = (error: unknown): void => {
    if (primary === undefined) primary = input.normalizeFailure(error)
    guardRunning = false
    registration?.stopAdmission()
    rejectAdmission?.(primary)
    if (!abortController.signal.aborted) abortController.abort(primary)
    if (!nativeEnded && !abortRequested) {
      abortRequested = true
      try {
        input.transaction.abort()
      } catch (cause) {
        cleanupFailures.push(cause)
      }
    }
  }

  /** Native end is observed without a signal race that could release resources before onabort. */
  const ended = new Promise<void>((resolve, reject) => {
    try {
      installIdbTransactionHandlers(
        input.transaction,
        () => {
          nativeEnded = true
          input.onNativeEnd?.(true)
          if (!commitChosen) {
            fail(new Error(StorageErrorText.indexedDbTransactionEndedEarly))
            reject(primary)
          } else resolve()
        },
        () => {
          /** Request rejection owns its original error; onabort observes the physical terminal. */
        },
        () => {
          nativeEnded = true
          input.onNativeEnd?.(false)
          guardRunning = false
          fail(primary ?? readIdbTransactionError(input.transaction))
          reject(primary)
        }
      )
    } catch (cause) {
      /** The native EventTarget remains observable when a property setter rejected setup. */
      const aborted = afterIdbTransactionAbort(input.transaction)
      fail(cause)
      void aborted.then(
        () => {
          nativeEnded = true
          input.onNativeEnd?.(false)
          reject(primary)
        },
        (observationFailure) => {
          cleanupFailures.push(observationFailure)
          reject(primary)
        }
      )
    }
  })
  /** The same end is awaited below; early rejection must already have an observer. */
  void ended.catch(() => undefined)
  /** Resolving this request marks actual native admission rather than logical key acquisition. */
  let resolveAdmission!: () => void
  /** Setup/request failure rejects physical admission with the same first failure. */
  /** A single first guard request distinguishes native scheduling from a user policy conflict. */
  const admitted = new Promise<void>((resolve, reject) => {
    resolveAdmission = resolve
    rejectAdmission = reject
  })
  if (primary !== undefined) rejectAdmission?.(primary)
  /** Admission is also observed if an earlier setup failure prevents reaching its await. */
  void admitted.catch(() => undefined)

  /** Issue only a read of the existing revision key from the current native request event. */
  const continueGuard = (): void => {
    if (!guardRunning || nativeEnded) return
    try {
      /** This pending request keeps the original transaction abortable until the commit decision. */
      const request = input.transaction.objectStore(input.guardStoreName).get(input.guardKey)
      installIdbRequestHandlers(
        request,
        () => {
          resolveAdmission()
          continueGuard()
        },
        () => {
          fail(readIdbRequestError(request))
          rejectAdmission?.(primary)
        }
      )
    } catch (cause) {
      fail(cause)
      rejectAdmission?.(primary)
    }
  }

  /** This probe runs in the callback's own context; guard success never authorizes its requests. */
  const assertNativeActive = (): void => {
    input.transaction.objectStore(input.guardStoreName).get(input.guardKey)
  }
  /** The user view and all derived views use this same backend method factory. */
  const scope = input.createScope()
  /** The host observer binds immutable transaction facts while this real view is still admitted. */
  let observer: ITransactionStageObserver | undefined
  /** Root disposal reaches this same native attempt, without creating a second resource owner. */
  let unregisterNative = (): void => {}
  /** Cancellation listener cleanup cannot replace the attempt's primary failure. */
  let unsubscribeAbort = (): void => {}
  try {
    registration = input.owner.register(scope, {
      context: input.context,
      createScope: input.createScope,
      onFailure: fail,
      beforeCommit: async (view) => {
        await input.beforeCommit?.(view)
        /**
         * The final observation binds the owner's dedicated live check view, never the closed
         * callback view.
         */
        let commitObserver: ITransactionStageObserver | undefined
        try {
          commitObserver = input.observer?.forTransaction(view)
        } catch (cause) {
          reportCleanupError(input.runtime.reporter, cause)
        }
        observeIndexedDbStage(commitObserver, TransactionBeforeStage.beforeCommit, input.runtime)
      }
    })
    try {
      observer = input.observer?.forTransaction(scope)
    } catch (cause) {
      reportCleanupError(input.runtime.reporter, cause)
    }
    unregisterNative = input.registerNative(scope, () =>
      fail(
        new StorageContractError(StorageContractErrorCode.disposed, {
          backend: StorageBackend.indexedDb
        })
      )
    )
    input.onRegistered?.(scope)
    unsubscribeAbort = subscribeToAbort(
      input.signal,
      () =>
        fail(
          new StorageContractError(StorageContractErrorCode.aborted, {
            backend: StorageBackend.indexedDb,
            cause: readAbortReason(input.signal)
          })
        ),
      input.runtime.reporter
    )
    observeIndexedDbStage(observer, TransactionBeforeStage.beforeTransaction, input.runtime)
    continueGuard()
    if (primary !== undefined) throw primary
    await input.waitPhysical(admitted)
    if (primary !== undefined) throw primary
    observeIndexedDbStage(observer, TransactionObservedStage.onTransactionStart, input.runtime)
    /** The race reports late rejection; the original Promise remains part of attempt cleanup. */
    const result = await raceWithAbort(
      () => {
        acceptedRun = Promise.resolve(input.run(scope))
        return acceptedRun
      },
      {
        signal: abortController.signal,
        cleanupPolicy: 'report',
        report: input.runtime.reporter
      }
    )
    /** No guard event is used to re-enter this callback's activity window. */
    assertNativeActive()
    registration.stopAdmission()
    await raceWithAbort(
      () => {
        acceptedFinalizers = registration!.runFinalizers()
        return acceptedFinalizers
      },
      {
        signal: abortController.signal,
        cleanupPolicy: 'report',
        report: input.runtime.reporter
      }
    )
    if (primary !== undefined) throw primary
    assertNativeActive()
    input.validateCommit?.()
    commitChosen = true
    guardRunning = false
    await ended
    input.afterCommit()
    observeIndexedDbStage(
      observer,
      TransactionObservedStage.afterCommit,
      input.runtime,
      input.changedKeys()
    )
    return result
  } catch (cause) {
    fail(primary ?? cause)
    /** Late results retain their existing race observer; settlement only drains accepted work. */
    await Promise.allSettled([acceptedRun, acceptedFinalizers])
    try {
      await registration?.closeIterators()
    } catch (error) {
      cleanupFailures.push(error)
    }
    await ended.catch(() => undefined)
    observeIndexedDbStage(
      observer,
      TransactionObservedStage.afterRollback,
      input.runtime,
      primary?.code
    )
    if (cleanupFailures.length > 0)
      throw createStorageAggregateError(
        StorageErrorCode.transactionFailed,
        primary?.message ?? StorageErrorText.indexedDbTransactionEndedEarly,
        [primary, ...cleanupFailures]
      )
    throw primary
  } finally {
    guardRunning = false
    registration?.stopAdmission()
    unsubscribeAbort()
    unregisterNative()
    registration?.close()
    observeIndexedDbStage(observer, TransactionObservedStage.onTransactionClose, input.runtime)
  }
}

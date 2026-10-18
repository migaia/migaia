import { createMutationQueue } from '@migaia/lifecycle'
import { raceWithAbort, type IAbortSignal } from '@migaia/utils/promise'
import type { IBackendKind } from '@migaia/storage-contract'
import { ENTITY_UNIQUE_WRITE_LOCK, StorageOperation } from '../constants.js'
import { StorageErrorCode } from '../error-code.js'
import { normalizeError } from '../core/errors.js'
import { readAbortReason, subscribeToAbort, throwIfAborted } from '../core/operation.js'
import type { IStorageOperationRuntime } from '../core/operation-reporter.js'

/** Structural host seam keeps DOM declarations out of the entity/memory public type graph. */
type IHostLockManager = {
  request<T>(
    name: string,
    options: { readonly mode: 'exclusive'; readonly signal?: IAbortSignal },
    run: () => Promise<T>
  ): Promise<T>
}

/** Non-browser/injected ports share one existing FIFO owner; no private queue or watchdog protocol. */
const localWrites = createMutationQueue({
  queueAdmissionTimeoutMs: false,
  admissionDiagnosticMs: false
})

/** Serialize only snapshot verification and commit, after application schema/projection callbacks. */
export const withExclusiveEntityWrite = async <T>(
  run: () => Promise<T>,
  backend: IBackendKind,
  signal: IAbortSignal | undefined,
  runtime: IStorageOperationRuntime
): Promise<T> => {
  /** Host locks coordinate separate pages; the fallback queue owns isolated same-realm ports. */
  let removeAbort: (() => void) | undefined
  try {
    throwIfAborted(signal)
    /** Capture the actual host object once, retaining its native method receiver. */
    const locks = (globalThis as { readonly navigator?: { readonly locks?: IHostLockManager } })
      .navigator?.locks
    /** Both admission paths recheck cancellation before touching storage. */
    const commit = async (): Promise<T> => {
      throwIfAborted(signal)
      return run()
    }
    if (locks !== undefined) {
      /** Web Locks require a genuine native signal; the contract also admits structural signals. */
      const controller = signal === undefined ? undefined : new AbortController()
      if (controller !== undefined)
        removeAbort = subscribeToAbort(
          signal,
          () => controller.abort(readAbortReason(signal)),
          runtime.reporter
        )
      return await locks.request(
        ENTITY_UNIQUE_WRITE_LOCK,
        {
          mode: 'exclusive',
          ...(controller === undefined ? {} : { signal: controller.signal })
        },
        commit
      )
    }
    /** The canonical queue observes late cancellation without allowing the queued commit to run. */
    const queued = localWrites.enqueue(commit)
    return signal === undefined
      ? await queued
      : await raceWithAbort(() => queued, {
          signal,
          cleanupPolicy: 'report',
          report: runtime.reporter
        })
  } catch (cause) {
    throwIfAborted(signal)
    throw normalizeError(
      cause,
      backend,
      StorageErrorCode.transactionFailed,
      StorageOperation.entityUniqueWrite
    )
  } finally {
    removeAbort?.()
  }
}

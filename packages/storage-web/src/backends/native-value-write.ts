import type { IAbortSignal } from '@migaia/utils/promise'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IBackendKind
} from '@migaia/storage-contract'
import { ENTITY_UNIQUE_WRITE_LOCK, StorageOperation } from '../constants.js'
import { StorageErrorCode } from '../error-code.js'
import { normalizeError } from './errors.js'
import { readAbortReason, throwIfAborted } from '@migaia/storage-host/authoring/backend'
import { subscribeToAbort } from './errors.js'
import type { IStorageOperationRuntime } from '@migaia/storage-host/authoring/backend'

/** Structural host seam keeps DOM declarations out of the entity/memory public type graph. */
type IHostLockManager = {
  request<T>(
    name: string,
    options: { readonly mode: 'exclusive'; readonly signal?: IAbortSignal },
    run: () => Promise<T>
  ): Promise<T>
}

/** Serialize only snapshot verification and commit, after application schema/projection callbacks. */
const withPhysicalValueWrite = async <T>(
  run: () => Promise<T>,
  backend: IBackendKind,
  signal: IAbortSignal | undefined,
  runtime: IStorageOperationRuntime,
  closingSignal?: IAbortSignal,
  lockName = ENTITY_UNIQUE_WRITE_LOCK,
  preserveRunFailure = false
): Promise<T> => {
  /** Host locks coordinate separate pages; injected ports commit in the same synchronous turn. */
  let removeAbort: (() => void) | undefined
  let removeClosing: (() => void) | undefined
  /** Redo seals its controller on a possibly applied failure; that seal cannot replace its cause. */
  let entered = false
  /** The concrete member's existing closure cancels only this physical admission. */
  const assertAdmission = (): void => {
    throwIfAborted(signal)
    if (closingSignal?.aborted) throw readAbortReason(closingSignal)
  }
  try {
    assertAdmission()
    /** Capture the actual host object once, retaining its native method receiver. */
    const locks = (globalThis as { readonly navigator?: { readonly locks?: IHostLockManager } })
      .navigator?.locks
    /** Both admission paths recheck cancellation before touching storage. */
    const commit = async (): Promise<T> => {
      assertAdmission()
      entered = true
      return run()
    }
    if (locks !== undefined) {
      /** Web Locks require a genuine native signal; the contract also admits structural signals. */
      const controller =
        signal === undefined && closingSignal === undefined ? undefined : new AbortController()
      if (controller !== undefined)
        removeAbort = subscribeToAbort(
          signal,
          () => controller.abort(readAbortReason(signal)),
          runtime.reporter
        )
      if (controller !== undefined)
        removeClosing = subscribeToAbort(
          closingSignal,
          () => controller.abort(readAbortReason(closingSignal)),
          runtime.reporter
        )
      return await locks.request(
        lockName,
        {
          mode: 'exclusive',
          ...(controller === undefined ? {} : { signal: controller.signal })
        },
        commit
      )
    }
    return await commit()
  } catch (cause) {
    if (!preserveRunFailure || !entered) assertAdmission()
    throw normalizeError(
      cause,
      backend,
      StorageErrorCode.transactionFailed,
      StorageOperation.entityUniqueWrite
    )
  } finally {
    removeAbort?.()
    removeClosing?.()
  }
}

/** Native snapshot comparison and write share one turn; only a real Web Lock adds a cross-page gate. */
export const withNativeValueWrite = (
  run: () => void,
  backend: IBackendKind,
  signal: IAbortSignal | undefined,
  runtime: IStorageOperationRuntime,
  closingSignal: IAbortSignal
): Promise<void> =>
  withPhysicalValueWrite(async () => run(), backend, signal, runtime, closingSignal)

/** Text redo uses this original native lock path for its complete read/recover/apply interval. */
export const withNativeTextOperation = <R>(
  run: () => Promise<R>,
  backend: IBackendKind,
  runtime: IStorageOperationRuntime,
  closingSignal: IAbortSignal,
  lockName: string,
  signal?: IAbortSignal
): Promise<R> =>
  withPhysicalValueWrite(run, backend, signal, runtime, closingSignal, lockName, true)

/** Both native value backends compare the same complete prefix snapshot before their write. */
export const assertValueSnapshot = (
  actual: readonly (readonly [string, string])[],
  expected: readonly (readonly [string, string])[],
  backend: IBackendKind
): void => {
  /** This temporary lookup owns no persistent data, resource or retry state. */
  const values = new Map(expected)
  if (actual.length !== values.size || actual.some(([key, value]) => values.get(key) !== value))
    throw new StorageContractError(StorageContractErrorCode.writeConflict, { backend })
}

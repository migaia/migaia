import type { IOperationContext } from '@migaia/storage-contract'
import { tryReadProperty } from '@migaia/utils/error'
import {
  createAbortTimeoutSignal,
  type IAbortSignal,
  type INativeAbortSignal
} from '@migaia/utils/promise'
import {
  StorageContractError,
  StorageContractErrorCode,
  snapshotOperationContext,
  type IOperationContextSnapshot
} from '@migaia/storage-contract'
import { isStorageErrorFamily } from './error-family.js'
import {
  createStorageOperationRuntime,
  reportCleanupError,
  type IStorageOperationReporter,
  type IStorageOperationRuntime
} from './operation-reporter.js'

type IOperationValidationContext = IOperationContext & {
  readonly conflictPolicy?: unknown
}

/** Read mutable abort state without allowing a hostile getter to escape the storage protocol. */
const readSignalAborted = (signal: IAbortSignal | undefined): boolean => {
  if (signal === undefined) return false
  try {
    return signal.aborted
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
}

/** Treat an inaccessible abort reason as the cancellation cause instead of leaking its getter. */
export const readAbortReason = (signal: IAbortSignal | undefined): unknown => {
  if (signal === undefined) return undefined
  /** Storage operations use an inaccessible reason as the cancellation cause. */
  const read = tryReadProperty(signal, 'reason')
  return read.threw ? read.error : read.value
}

/** Subscribe once with race closure and return cleanup that cannot mask an operation result. */
export const subscribeToAbort = (
  signal: IAbortSignal | undefined,
  onAbort: () => void,
  reporter: IStorageOperationReporter,
  isBackendError?: (value: unknown) => value is Error
): (() => void) => {
  if (signal === undefined) return () => {}
  /** Prevents host cleanup from being re-entered by racing IDB and abort events. */
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    try {
      signal.removeEventListener('abort', handleAbort)
    } catch (cause) {
      reportCleanupError(reporter, cause)
    }
  }
  const handleAbort = (): void => {
    dispose()
    onAbort()
  }
  if (readSignalAborted(signal)) {
    handleAbort()
    return dispose
  }
  try {
    signal.addEventListener('abort', handleAbort, { once: true })
    if (readSignalAborted(signal)) handleAbort()
  } catch (cause) {
    dispose()
    if (isStorageErrorFamily(cause, isBackendError)) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  return dispose
}

/** Throw the stable storage error when an operation signal has already been cancelled. */
export const throwIfAborted = (signal: IAbortSignal | undefined): void => {
  if (readSignalAborted(signal))
    throw new StorageContractError(StorageContractErrorCode.aborted, {
      cause: readAbortReason(signal)
    })
}

/** Merge timeout and caller cancellation into one signal and expose deterministic cleanup. */
export const mergeSignals = (
  ctx: IOperationValidationContext | undefined,
  reporter: IStorageOperationReporter
): {
  readonly signal: INativeAbortSignal | undefined
  readonly dispose: () => void
  readonly context: IOperationContextSnapshot | undefined
} => {
  const context = snapshotOperationContext(ctx)
  const timeoutMs = context?.timeoutMs
  // Preserve the original native signal while neutral declarations borrow the shared signal type.
  const externalSignal = context?.signal as INativeAbortSignal | undefined
  if (timeoutMs === undefined) return { signal: externalSignal, dispose: () => {}, context }
  try {
    const merged = createAbortTimeoutSignal({
      signal: externalSignal as IAbortSignal | undefined,
      timeoutMs,
      timeoutReason: () => new StorageContractError(StorageContractErrorCode.aborted),
      report: (error) => reportCleanupError(reporter, error)
    })
    return {
      signal: merged.signal as INativeAbortSignal | undefined,
      context,
      dispose: merged.dispose
    }
  } catch (cause) {
    if (isStorageErrorFamily(cause)) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
}

/** Run an async operation with unified cancellation and guaranteed timer/listener cleanup. */
export const withAbort = async <T>(
  ctx: IOperationValidationContext | undefined,
  run: (
    signal: INativeAbortSignal | undefined,
    context: IOperationContextSnapshot | undefined,
    runtime: IStorageOperationRuntime
  ) => Promise<T>
): Promise<T> => {
  const runtime = createStorageOperationRuntime()
  const { signal, dispose, context } = mergeSignals(ctx, runtime.reporter)
  try {
    throwIfAborted(signal)
    return await run(signal, context, runtime)
  } finally {
    dispose()
  }
}

import type { IOperationContext } from '@migaia/storage-contract'
import {
  createAbortTimeoutSignal,
  type IAbortSignal,
  type INativeAbortSignal
} from '@migaia/utils/promise'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IOperationContextSnapshot
} from '@migaia/storage-contract'
import { snapshotOperationContext } from '../authoring/context.js'
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

/** Read the supported signal's current cancellation state. */
const readSignalAborted = (signal: IAbortSignal | undefined): boolean => signal?.aborted ?? false

/** Preserve the original native cancellation reason as the operation cause. */
export const readAbortReason = (signal: IAbortSignal | undefined): unknown => signal?.reason

/** One native abort subscription retains its stable listener and reports cleanup failure. */
class StorageAbortSubscription {
  /** Native signal identity must be shared by installation and removal. */
  readonly #signal: IAbortSignal
  /** The existing operation owner chooses the cancellation outcome. */
  readonly #onAbort: () => void
  /** Listener-removal failures retain the original cleanup reporting boundary. */
  readonly #reporter: IStorageOperationReporter
  /** Backend coded failures remain exact when listener installation fails. */
  readonly #isBackendError: ((value: unknown) => value is Error) | undefined
  /** Native abort and explicit cleanup can detach this listener only once. */
  #disposed = false

  /** Retain the original signal, callback and diagnostics without acquiring a new lifetime. */
  constructor(
    signal: IAbortSignal,
    onAbort: () => void,
    reporter: IStorageOperationReporter,
    isBackendError?: (value: unknown) => value is Error
  ) {
    this.#signal = signal
    this.#onAbort = onAbort
    this.#reporter = reporter
    this.#isBackendError = isBackendError
  }

  /** Close the initial-abort race using the same stable native listener on both sides. */
  start(): () => void {
    if (this.#signal.aborted) {
      this.#handleAbort()
      return this.dispose
    }
    try {
      this.#signal.addEventListener('abort', this.#handleAbort, { once: true })
      if (this.#signal.aborted) this.#handleAbort()
    } catch (cause) {
      this.dispose()
      if (isStorageErrorFamily(cause, this.#isBackendError)) throw cause
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
    }
    return this.dispose
  }

  /** Listener cleanup cannot replace the existing operation result. */
  readonly dispose = (): void => {
    if (this.#disposed) return
    this.#disposed = true
    try {
      this.#signal.removeEventListener('abort', this.#handleAbort)
    } catch (cause) {
      reportCleanupError(this.#reporter, cause)
    }
  }

  /** Detach before delivering cancellation so reentrant cleanup remains idempotent. */
  readonly #handleAbort = (): void => {
    this.dispose()
    this.#onAbort()
  }
}

/** Subscribe once and return the original subscription's idempotent cleanup port. */
export const subscribeToAbort = (
  signal: IAbortSignal | undefined,
  onAbort: () => void,
  reporter: IStorageOperationReporter,
  isBackendError?: (value: unknown) => value is Error
): (() => void) =>
  signal === undefined
    ? () => {}
    : new StorageAbortSubscription(signal, onAbort, reporter, isBackendError).start()

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

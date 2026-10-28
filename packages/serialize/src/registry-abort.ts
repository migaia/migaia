/** Public cancellation races observe detached parser tasks without changing their settlement. */
import type { IAbortSignal } from '@migaia/utils/promise'
import { observeThenableRejection } from '@migaia/utils/function'
import { SerializeCodecError, type ISerializePhase } from './types.ts'
import { createSerializeTypeError, SerializeErrorCode, SerializeErrorText } from './errors.ts'
import { isSerializeTaggedError } from './operation-support.ts'

/** Fixed diagnostic location for a parser task raced against its composed signal. */
type IAbortRaceDetails = {
  readonly type: string
  readonly phase: ISerializePhase
  readonly context: string
}

/** One race owns its listener until task settlement; late failures stay reported. */
export class SerializeAbortRace<T> {
  /** Task retains its independent lifecycle lease when public cancellation wins. */
  readonly #task: Promise<T>
  /** Composed snapshot is the only signal read after admission. */
  readonly #signal: IAbortSignal
  /** Error location is independent from parser-internal progress. */
  readonly #details: IAbortRaceDetails
  /** Detached rejection reporter uses the original registry option receiver. */
  readonly #report: (error: unknown) => void
  /** Public settlement occurs once even when listener installation reenters. */
  #settled = false
  /** Promise resolver is acquired synchronously before observing task settlement. */
  #resolve!: (value: T | PromiseLike<T>) => void
  /** Promise rejecter retains the first public failure. */
  #reject!: (error: unknown) => void
  /** Stable callback identity is used for both installation and removal. */
  readonly #onAbort = (): void => this.#abort()
  /** Public Promise has exactly the original task-race assimilation boundary. */
  readonly promise: Promise<T>

  /** Starts task observation before installing the cancellation listener. */
  constructor(
    task: Promise<T>,
    signal: IAbortSignal,
    details: IAbortRaceDetails,
    report: (error: unknown) => void
  ) {
    this.#task = task
    this.#signal = signal
    this.#details = details
    this.#report = report
    this.promise = new Promise<T>((resolve, reject) => this.#start(resolve, reject))
  }

  /** Installs the same task reactions and signal rechecks as the original race. */
  #start(resolve: (value: T | PromiseLike<T>) => void, reject: (error: unknown) => void): void {
    this.#resolve = resolve
    this.#reject = reject
    this.#task.then(
      (value) => this.#succeed(value),
      (error) => this.#fail(error)
    )
    try {
      if (this.#signal.aborted) return this.#abort()
      this.#signal.addEventListener('abort', this.#onAbort, { once: true })
      if (this.#signal.aborted) return this.#abort()
    } catch (error) {
      if (this.#settled) return
      this.#settled = true
      this.#reject(
        isSerializeTaggedError(error)
          ? error
          : createSerializeTypeError(
              SerializeErrorCode.invalidOption,
              SerializeErrorText.signalAccessorFailed,
              { cause: error }
            )
      )
    }
  }

  /** Cancellation preserves an admitted INVALID_OPTION reason or wraps the original reason. */
  #abort(): void {
    if (this.#settled) return
    this.#settled = true
    /** Reading the composed reason never revisits caller admission getters. */
    const reason = this.#signal.reason
    if (
      isSerializeTaggedError(reason) &&
      (reason as { readonly code?: unknown }).code === SerializeErrorCode.invalidOption
    ) {
      this.#reject(reason)
      return
    }
    this.#reject(
      new SerializeCodecError(SerializeErrorText.aborted, {
        ...this.#details,
        chunkIndex: 0,
        bytesConsumed: 0,
        code: SerializeErrorCode.aborted,
        cause: reason
      })
    )
  }

  /** Successful task settlement removes the listener before resolving the public race. */
  #succeed(value: T): void {
    if (this.#settled) return
    this.#settled = true
    this.#signal.removeEventListener('abort', this.#onAbort)
    this.#resolve(value)
  }

  /** Rejections after cancellation remain observed without replacing the public result. */
  #fail(error: unknown): void {
    if (this.#settled) {
      observeThenableRejection(undefined, { error }, this.#report)
      return
    }
    this.#settled = true
    this.#signal.removeEventListener('abort', this.#onAbort)
    this.#reject(error)
  }
}

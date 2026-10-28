/** Owns limiter mechanics; public API admission stays in promise.ts. */
import { PromiseOperation, PromiseDiagnosticPhase } from './promise-contract.ts'

import { ERROR_SOURCE, UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import { attachErrorIdentity, UtilsAbortError } from '../error.ts'

import { reportUnhandledError as hostRethrowReporter } from '../host-report.ts'
import type { IAbortSignal, IUtilsReporter, IConcurrencyLimiter } from './promise-contract.ts'
import { observeSingleAbort, reportDiagnostic } from './promise-abort.ts'

/** Cleared queue tombstones retain no caller callback or cancellation closure. */
export function concurrencyNoop(): void {}

/** A live admission owns callbacks only until its original terminal completion point. */
export type IConcurrencyEntry = {
  task: (context: { readonly signal?: IAbortSignal }) => unknown
  signal?: IAbortSignal
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  cancelled: boolean
  pending: boolean
  /** Keep removal ownership separate from task signal retirement and reentrant cancellation. */
  cleanupSignal: IAbortSignal | undefined
  /** Native removal must receive the exact callback registered for this admission. */
  onAbort: (() => void) | undefined
}

/** A cancellation snapshot retains removal ownership across reentrant signal reads. */
type IConcurrencyCleanup = Pick<IConcurrencyEntry, 'cleanupSignal' | 'onAbort'>

/** One limiter owns FIFO admission, active tasks and idempotent terminal cleanup. */
export class ConcurrencyLimiter implements IConcurrencyLimiter {
  /** The validated concurrency never changes after construction. */
  #concurrency: number
  /** Cleanup diagnostics use the same captured reporter as every queued admission. */
  #report: IUtilsReporter
  /** Scalar tombstones retain original cursor ordering until amortized compaction removes them. */
  #queue: IConcurrencyEntry[] = []
  /** The cursor avoids moving the remaining queue for each admitted task. */
  #queueHead = 0
  /** Running task count is independent of pending cancellation and terminal admission. */
  #active = 0
  /** Exact live queued count avoids rescanning the queue for every shared-signal cancellation. */
  #pending = 0
  /** Closing rejects queued and future work while already running tasks retain their own signals. */
  #closed = false
  /** Every rejected terminal admission observes the same original close reason. */
  #closeReason: unknown
  /** Concurrent idle waiters share this promise until all live work settles. */
  #idlePromise: Promise<void> | undefined
  /** Idle settlement releases only the currently published promise. */
  #idleResolve: (() => void) | undefined
  /** Repeated asynchronous disposal preserves its original promise identity. */
  #disposal: Promise<void> | undefined

  /** Capture options before validation, preserving existing getter order and native error identity. */
  constructor(options: { readonly concurrency: number; readonly report?: IUtilsReporter }) {
    this.#concurrency = options.concurrency
    this.#report = options.report ?? hostRethrowReporter
    if (!Number.isSafeInteger(this.#concurrency) || this.#concurrency < 1)
      throw attachErrorIdentity(
        new RangeError(
          UtilsErrorText.invalidArgument(
            'concurrency',
            UtilsErrorText.positiveSafeIntegerExpectation
          )
        ),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
  }

  /** Validate cancellation before allocating one admission; queued and active work remain distinct. */
  run = <T>(
    task: (context: { readonly signal?: IAbortSignal }) => T | PromiseLike<T>,
    options?: { readonly signal?: IAbortSignal }
  ): Promise<T> => this.#run(task, options)

  /** Own admission before creating the native Promise executor, keeping detached run callable. */
  #run<T>(
    task: (context: { readonly signal?: IAbortSignal }) => T | PromiseLike<T>,
    options?: { readonly signal?: IAbortSignal }
  ): Promise<T> {
    /** Read the caller's signal once before any observer can reenter admission. */
    const signal = options?.signal
    if (this.#closed) return Promise.reject(this.#closeReason)
    /** Both malformed signals and already aborted signals retain their original failure path. */
    const initial = observeSingleAbort(signal)
    if (initial.kind === 'failed') return Promise.reject(initial.error)
    if (initial.kind === 'aborted') return Promise.reject(initial.reason ?? new UtilsAbortError())
    return new Promise<T>((resolve, reject) => {
      this.#admit(task, signal, resolve as (value: unknown) => void, reject)
    })
  }

  /** Count actual running callbacks, not caller promises or queued entries. */
  get activeCount(): number {
    return this.#active
  }

  /** Cancelled queue slots no longer contribute to pending admission. */
  get pendingCount(): number {
    return this.#pending
  }

  /** Share one pending idle receipt; an already idle limiter returns a resolved native promise. */
  whenIdle = (): Promise<void> => {
    if (this.#active === 0 && this.#queueHead >= this.#queue.length) return Promise.resolve()
    this.#idlePromise ??= new Promise<void>(this.#captureIdle)
    return this.#idlePromise
  }

  /** Capture one native idle resolver without nesting a callback in the detached public method. */
  readonly #captureIdle = (resolve: () => void): void => {
    this.#idleResolve = resolve
  }

  /** Close admission once and reject queued tasks in original submission order. */
  close = (reason?: unknown): void => {
    if (this.#closed) return
    this.#closed = true
    this.#closeReason = reason ?? limiterClosedError()
    for (let index = this.#queueHead; index < this.#queue.length; index++) {
      /** This entry still owns a queued cancellation receipt until it is marked terminal. */
      const entry = this.#queue[index]
      if (entry.cancelled) continue
      entry.cancelled = true
      this.#releasePending(entry)
      this.#cleanup(entry)
      entry.reject(this.#closeReason)
      this.#releaseCallbacks(entry)
    }
    this.#queueHead = this.#queue.length
    this.#compact()
    this.#signalIdle()
  }

  /** Terminal cleanup retains one promise even when active work finishes after close. */
  dispose = (reason?: unknown): Promise<void> => {
    if (!this.#disposal) {
      this.close(reason)
      this.#disposal = this.whenIdle()
    }
    return this.#disposal
  }

  /** Install the native abort receipt before committing the entry to the FIFO. */
  #admit(
    task: IConcurrencyEntry['task'],
    signal: IAbortSignal | undefined,
    resolve: IConcurrencyEntry['resolve'],
    reject: IConcurrencyEntry['reject']
  ): void {
    /** An admission is not pending until it has actually entered the queue. */
    const entry: IConcurrencyEntry = {
      task,
      signal,
      resolve,
      reject,
      cancelled: false,
      pending: false,
      cleanupSignal: undefined,
      onAbort: undefined
    }
    try {
      installConcurrencyListener(entry, signal, () => this.#cancel(entry))
      /** A synchronous signal transition during listener registration wins queue admission. */
      const after = observeSingleAbort(signal)
      if (after.kind !== 'none') {
        entry.cancelled = true
        cleanupConcurrencyEntry(entry)
        reject(after.kind === 'failed' ? after.error : (after.reason ?? new UtilsAbortError()))
        this.#releaseCallbacks(entry)
        this.#signalIdle()
        return
      }
      if (this.#closed) {
        entry.cancelled = true
        cleanupConcurrencyEntry(entry)
        reject(this.#closeReason)
        this.#releaseCallbacks(entry)
        this.#signalIdle()
        return
      }
    } catch (error) {
      entry.cancelled = true
      this.#cleanup(entry)
      reject(error)
      this.#releaseCallbacks(entry)
      this.#signalIdle()
      return
    }
    this.#queue.push(entry)
    if (!entry.cancelled) {
      entry.pending = true
      this.#pending++
    } else this.#releaseCallbacks(entry)
    this.#drain()
  }

  /** Queued cancellation rejects only its own admission and does not cancel another running task. */
  #cancel(entry: IConcurrencyEntry): void {
    if (entry.cancelled) return
    /** A reason getter may close and clear this entry before this original callback resumes. */
    const { reject } = entry
    /** A reentrant close may retire entry fields before this cancellation resumes cleanup. */
    const cleanup: IConcurrencyCleanup = {
      cleanupSignal: entry.cleanupSignal,
      onAbort: entry.onAbort
    }
    /** Abort state is read before terminal marking, matching the original failure precedence. */
    const observation = observeSingleAbort(entry.signal)
    /** Registration and selected-entry cleanup may reenter before a task is actually queued. */
    const pending = entry.pending
    entry.cancelled = true
    this.#releasePending(entry)
    reject(
      observation.kind === 'failed'
        ? observation.error
        : observation.kind === 'aborted'
          ? (observation.reason ?? new UtilsAbortError())
          : new UtilsAbortError()
    )
    this.#cleanup(cleanup)
    if (pending) this.#releaseCallbacks(entry)
    this.#signalIdle()
  }

  /** Remove a committed pending count once; early abort before enqueue has no count to release. */
  #releasePending(entry: IConcurrencyEntry): void {
    if (!entry.pending) return
    entry.pending = false
    this.#pending--
  }

  /** Cleanup diagnostics never replace the original task/admission rejection. */
  #cleanup(cleanup: IConcurrencyCleanup): void {
    try {
      cleanupConcurrencyEntry(cleanup)
    } catch (error) {
      reportDiagnostic(this.#report, error, {
        operation: PromiseOperation['limiter'],
        phase: PromiseDiagnosticPhase['cleanup']
      })
    }
  }

  /** Retire references after original user callbacks; scalar queue and idle state stay unchanged. */
  #releaseCallbacks(entry: IConcurrencyEntry): void {
    entry.task = concurrencyNoop
    entry.signal = undefined
    entry.resolve = concurrencyNoop
    entry.reject = concurrencyNoop
    entry.cleanupSignal = undefined
    entry.onAbort = undefined
  }

  /** Admit callbacks in FIFO order; settlement releases capacity before starting the next member. */
  #drain(): void {
    while (
      !this.#closed &&
      this.#active < this.#concurrency &&
      this.#queueHead < this.#queue.length
    ) {
      /** The next slot may already have been cancelled by its own native signal. */
      const entry = this.#queue[this.#queueHead++]
      if (!entry || entry.cancelled) continue
      this.#releasePending(entry)
      this.#compact()
      this.#cleanup(entry)
      this.#active++
      Promise.resolve()
        .then(() => entry.task({ signal: entry.signal }))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.#active--
          this.#drain()
          this.#signalIdle()
          this.#releaseCallbacks(entry)
        })
    }
  }

  /**
   * Compact only after a fixed minimum and at least half consumption, giving amortized O(1)
   * dequeue.
   */
  #compact(): void {
    if (this.#queueHead < 64 || this.#queueHead * 2 < this.#queue.length) return
    /** Move the remaining suffix only after half consumption; total movement is amortized O(1). */
    const remaining = this.#queue.length - this.#queueHead
    for (let index = 0; index < remaining; index++)
      this.#queue[index] = this.#queue[this.#queueHead + index]
    this.#queue.length = remaining
    this.#queueHead = 0
  }

  /** Complete all current idle waiters in O(1), including shared-signal cancellation batches. */
  #signalIdle(): void {
    if (this.#active !== 0 || this.#pending !== 0) return
    /** Release the published receipt before user promise continuations run. */
    const resolve = this.#idleResolve
    this.#idleResolve = undefined
    this.#idlePromise = undefined
    resolve?.()
  }
}

/** Build the shared close reason once so queued and subsequent admissions retain one error identity. */
export function limiterClosedError(): Error {
  return attachErrorIdentity(new Error(UtilsErrorText.limiterClosed), {
    source: ERROR_SOURCE,
    code: UtilsErrorCode.limiterClosed
  })
}

/**
 * Store removal ownership before registration, preserving partial-registration rollback and
 * callback identity.
 */
function installConcurrencyListener(
  entry: IConcurrencyEntry,
  signal: IAbortSignal | undefined,
  onAbort: () => void
): void {
  entry.cleanupSignal = signal
  entry.onAbort = onAbort
  signal?.addEventListener('abort', onAbort, { once: true })
}

/** Remove the original native listener without allocating an admission-owned cleanup closure. */
function cleanupConcurrencyEntry(entry: IConcurrencyCleanup): void {
  if (entry.onAbort) entry.cleanupSignal?.removeEventListener('abort', entry.onAbort)
}

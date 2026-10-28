import { defaultLifecycleScheduler } from './scheduler.ts'
import { attachLifecycleSecondaryErrors } from './error-boundary.ts'
import { containAsyncRejection, createLifecycleError } from './errors.ts'
import { LifecycleErrorCode } from './error-code.ts'
import { LifecycleErrorText, LifecycleErrorTextFactory } from './error-text.ts'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { resolveSchedulerOption } from './scheduler.ts'

export type IMutationQueueOptions = {
  /**
   * Default per-task admission budget. `undefined` (default) means "diagnose only, never reject" —
   * the core never invents a domain timeout. `false` disables even diagnostics. A number is the
   * `plugin-host`-equivalent behavior: reject once a queued task has waited this long.
   */
  readonly queueAdmissionTimeoutMs?: number | false
  /**
   * Diagnostic-only threshold used while `queueAdmissionTimeoutMs` is `undefined`. `false` disables
   * the diagnostic timer.
   */
  readonly admissionDiagnosticMs?: number | false
  readonly onAdmissionDiagnostic?: (info: {
    readonly owner: string | undefined
    readonly waitedMs: number
  }) => void
  /**
   * Uses a runtime-neutral scheduler for watchdog timing and clock reads instead of host timers.
   * Defaults to `systemScheduler`.
   */
  readonly scheduler?: IScheduler
}

export type IEnqueueOptions = {
  readonly owner?: string
  /** Overrides the queue's default for this one task. */
  readonly queueAdmissionTimeoutMs?: number | false
}

export type IMutationQueue = {
  enqueue<T>(task: () => T | PromiseLike<T>, options?: IEnqueueOptions): Promise<T>
  readonly size: number
}

type IMutationRecord = {
  readonly task: () => unknown | PromiseLike<unknown>
  readonly owner: string | undefined
  readonly resolve: (value: unknown) => void
  readonly reject: (reason: unknown) => void
  admissionTimer: IScheduledTask | undefined
  admissionStartedAt: number | undefined
  admissionCancelAttempted: boolean
  timeoutError: unknown
  timeoutSettled: boolean
  queueIndex: number
}

/** Callback shape of `onAdmissionDiagnostic`, captured once at construction. */
type IAdmissionDiagnostic = IMutationQueueOptions['onAdmissionDiagnostic']

/** Consumed-prefix floor below which dequeue never compacts, keeping the splice amortized O(1). */
const compactionFloor = 1024

/** Cancels one admission task at most once and returns its raw failure for timeout attribution. */
function cancelAdmissionTask(record: IMutationRecord): unknown {
  /** Live admission timer, if still armed. */
  const timer = record.admissionTimer
  if (timer === undefined || record.admissionCancelAttempted) return undefined
  record.admissionCancelAttempted = true
  try {
    timer.cancel()
    return undefined
  } catch (error) {
    return error
  }
}

/** 校验 scheduler.schedule 返回句柄含可调用 cancel：非法句柄 fail-fast，不裸抛 undefined.cancel。 */
function validateScheduleHandle(handle: unknown): asserts handle is IScheduledTask {
  if (
    handle === null ||
    typeof handle !== 'object' ||
    typeof (handle as { cancel?: unknown }).cancel !== 'function'
  ) {
    throw createLifecycleError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerTaskInvalid
    )
  }
}

/** Builds the admission-timeout rejection, attaching a cancel failure when one occurred. */
function createTimeoutRejection(record: IMutationRecord, cancelError: unknown): unknown {
  return cancelError === undefined
    ? record.timeoutError
    : attachLifecycleSecondaryErrors(
        record.timeoutError,
        [cancelError],
        LifecycleErrorText.mutationAdmissionTimedOut,
        LifecycleErrorCode.queueAdmissionTimeout
      )
}

/**
 * Strictly single-flight FIFO queue. Options are read once at construction. Methods live on the
 * prototype and must be called on the queue (`queue.enqueue(...)`), not detached.
 */
class MutationQueue {
  /** Default per-task admission budget (`undefined` = diagnose only, `false` = off). */
  readonly #defaultAdmissionTimeoutMs: number | false | undefined
  /** Diagnostic threshold used while no admission budget applies; `false` disables it. */
  readonly #admissionDiagnosticMs: number | false
  /** Diagnostic sink captured at construction. */
  readonly #onAdmissionDiagnostic: IAdmissionDiagnostic
  /** Clock and timer domain for admission watchdogs. */
  readonly #scheduler: IScheduler
  /** FIFO records; dequeued and removed slots hold `undefined` until compaction. */
  readonly #queue: Array<IMutationRecord | undefined> = []
  /** Cursor of the first slot that may still hold a queued record. */
  #queueHead = 0
  /** Number of live queued records (excluding the running one). */
  #queuedCount = 0
  /** Whether a task is currently running. */
  #running = false
  /** Owner label of the running task, for the self-dependency check. */
  #runningOwner: string | undefined

  /** Reads the admission options in their documented order. */
  constructor(options: IMutationQueueOptions) {
    this.#defaultAdmissionTimeoutMs = options.queueAdmissionTimeoutMs
    this.#admissionDiagnosticMs = options.admissionDiagnosticMs ?? 1000
    this.#scheduler = resolveSchedulerOption(options, defaultLifecycleScheduler)
    this.#onAdmissionDiagnostic = options.onAdmissionDiagnostic
  }

  /** Running plus queued tasks. */
  get size(): number {
    return this.#queuedCount + (this.#running ? 1 : 0)
  }

  /**
   * Queues `task` behind all earlier tasks. A labelled task enqueued by a running task with the
   * same owner is rejected, since awaiting it would deadlock the single-flight queue.
   */
  enqueue<T>(task: () => T | PromiseLike<T>, enqueueOptions: IEnqueueOptions = {}): Promise<T> {
    /** Owner label used by diagnostics and the self-dependency check. */
    const owner = enqueueOptions.owner
    // A task awaiting a same-owner task it just enqueued cannot ever complete — the queue is FIFO
    // and won't run the new one until this one finishes. Unlabeled tasks are never flagged: without
    // a reliable owner, rejecting a legitimate task would be worse than missing this diagnostic.
    //
    // This is a partial guard, not a general one: a running task that `enqueue()`s a *different*
    // or unlabeled task and then `await`s it right there deadlocks the exact same way. That case
    // has no reliable signal to detect it by, so it isn't caught; the safe pattern for a running
    // task that wants to submit follow-up work is to enqueue it without awaiting its own successor.
    if (owner !== undefined && this.#running && this.#runningOwner === owner) {
      return Promise.reject(
        createLifecycleError(
          LifecycleErrorCode.queueSelfDependency,
          LifecycleErrorTextFactory.mutationSelfDependency(owner),
          { detail: { owner } }
        )
      )
    }
    return new Promise<T>((resolve, reject) =>
      this.#admit(
        task as () => unknown,
        owner,
        enqueueOptions,
        resolve as (value: unknown) => void,
        reject
      )
    )
  }

  /** Appends one record, arms its admission watchdog when it waits, and starts it when idle. */
  #admit(
    task: () => unknown,
    owner: string | undefined,
    enqueueOptions: IEnqueueOptions,
    resolve: (value: unknown) => void,
    reject: (reason: unknown) => void
  ): void {
    /** The queued task and its settlement and watchdog state. */
    const record: IMutationRecord = {
      task,
      owner,
      resolve,
      reject,
      admissionTimer: undefined,
      admissionStartedAt: undefined,
      admissionCancelAttempted: false,
      timeoutError: undefined,
      timeoutSettled: false,
      queueIndex: this.#queue.length
    }
    /** Only a task that has to wait needs an admission watchdog. */
    const queuedBehindWork = this.#running || this.#queuedCount > 0
    this.#queue.push(record)
    this.#queuedCount++
    if (queuedBehindWork) {
      try {
        this.#armAdmission(
          record,
          enqueueOptions.queueAdmissionTimeoutMs ?? this.#defaultAdmissionTimeoutMs
        )
      } catch (error) {
        // 排程失败不得留下幽灵任务：移除记录并 reject，后续任务不被阻塞、size 正确、原始错误可达。
        this.#removeQueued(record)
        reject(error)
        return
      }
    }
    this.#runNext()
  }

  /** Dequeues the next live record and runs it, unless a task is already running. */
  #runNext(): void {
    if (this.#running) return
    while (this.#queueHead < this.#queue.length && this.#queue[this.#queueHead] === undefined)
      this.#queueHead++
    /** Oldest live record, if any. */
    const next = this.#queue[this.#queueHead]
    if (next !== undefined) {
      this.#queue[this.#queueHead] = undefined
      next.queueIndex = -1
      this.#queueHead++
      this.#queuedCount--
    }
    this.#compactConsumedPrefix()
    if (!next) return
    this.#disarmAdmission(next)
    this.#running = true
    this.#runningOwner = next.owner
    void this.#run(next)
  }

  /** Runs one task to settlement, then starts the next one. */
  async #run(record: IMutationRecord): Promise<void> {
    try {
      record.resolve(await record.task())
    } catch (error) {
      record.reject(error)
    } finally {
      this.#running = false
      this.#runningOwner = undefined
      this.#runNext()
    }
  }

  /** Starts the admission watchdog: a diagnostic timer, a rejecting timeout, or nothing. */
  #armAdmission(record: IMutationRecord, timeoutMs: number | false | undefined): void {
    if (timeoutMs === false) return
    /** Clock reading the waiting time is measured from. */
    const startedAt = this.#scheduler.now()
    record.admissionStartedAt = startedAt
    if (timeoutMs === undefined) {
      // nothing to diagnose to, or the diagnostic timer is explicitly disabled — don't burn a timer.
      if (!this.#onAdmissionDiagnostic || this.#admissionDiagnosticMs === false) return
      /** Diagnostic-only timer; it never rejects the task. */
      const diagnosticTimer = this.#scheduler.schedule(
        () => this.#reportAdmissionDiagnostic(record, this.#scheduler.now() - startedAt),
        this.#admissionDiagnosticMs
      )
      validateScheduleHandle(diagnosticTimer)
      record.admissionTimer = diagnosticTimer
      return
    }
    /** Rejecting timeout timer. */
    const timer = this.#scheduler.schedule(
      () => this.#expireAdmission(record, startedAt, timeoutMs),
      timeoutMs
    )
    validateScheduleHandle(timer)
    record.admissionTimer = timer
    // A scheduler that fired the timeout synchronously recorded the error before the handle existed.
    if (record.timeoutError !== undefined && !record.timeoutSettled) {
      record.timeoutSettled = true
      record.reject(createTimeoutRejection(record, cancelAdmissionTask(record)))
    }
  }

  /** Timeout callback: removes a still-queued record and rejects it with the timeout error. */
  #expireAdmission(record: IMutationRecord, startedAt: number, timeoutMs: number): void {
    if (!this.#removeQueued(record)) return // already dequeued to run, or already settled
    /** How long the record waited, from the scheduler clock. */
    let waitedMs: number
    try {
      waitedMs = Math.max(0, this.#scheduler.now() - startedAt)
    } catch (error) {
      record.timeoutSettled = true
      record.admissionTimer = undefined
      record.reject(
        createLifecycleError(
          LifecycleErrorCode.queueAdmissionTimeout,
          LifecycleErrorText.mutationAdmissionTimedOut,
          { cause: error, detail: { owner: record.owner, phase: 'timeout-clock' } }
        )
      )
      return
    }
    record.timeoutError = createLifecycleError(
      LifecycleErrorCode.queueAdmissionTimeout,
      LifecycleErrorTextFactory.mutationAdmissionTimeout(timeoutMs),
      { detail: { owner: record.owner, waitedMs } }
    )
    if (record.admissionTimer !== undefined && !record.timeoutSettled) {
      record.timeoutSettled = true
      /** Cancel failure, attached to the timeout rejection. */
      const cancelError = cancelAdmissionTask(record)
      record.admissionTimer = undefined
      record.reject(createTimeoutRejection(record, cancelError))
    }
  }

  /** Cancels a dequeued record's watchdog; a cancel failure is reported as a diagnostic. */
  #disarmAdmission(record: IMutationRecord): void {
    if (record.admissionTimer === undefined) return
    /** Raw cancel failure, if the scheduler handle threw. */
    const cancelError = cancelAdmissionTask(record)
    record.admissionTimer = undefined
    if (cancelError === undefined) return
    /** Waiting time for the diagnostic; 0 when the clock itself fails. */
    let waitedMs = 0
    try {
      /** Watchdog start time recorded by `#armAdmission`. */
      const startedAt = record.admissionStartedAt
      waitedMs = startedAt === undefined ? 0 : Math.max(0, this.#scheduler.now() - startedAt)
    } catch {
      // A scheduler clock failure must not turn watchdog cleanup into a queue control-flow failure.
    }
    this.#reportAdmissionDiagnostic(
      record,
      waitedMs,
      createLifecycleError(
        LifecycleErrorCode.queueAdmissionTimeout,
        LifecycleErrorText.mutationAdmissionTimedOut,
        {
          cause: cancelError,
          detail: { owner: record.owner, phase: 'dequeue-disarm', waitedMs }
        }
      )
    )
  }

  /** 诊断回调隔离：同步抛/异步拒绝均被观测，不穿透 scheduler、不改变业务结果、不产生 unhandled rejection。 */
  #reportAdmissionDiagnostic(record: IMutationRecord, waitedMs: number, error?: unknown): void {
    try {
      /** Diagnostic sink result, observed for async rejection. */
      const result: unknown = this.#onAdmissionDiagnostic?.({
        owner: record.owner,
        waitedMs,
        ...(error === undefined ? {} : { error })
      })
      containAsyncRejection(result, () => {
        // 诊断异步失败无更低一层可上报，在边界终止。
      })
    } catch {
      // 诊断同步失败不得逃逸出 timer 回调。
    }
  }

  /**
   * Drops the consumed prefix once it dominates the backing array, re-indexing the live tail, so
   * the array stays bounded by live work instead of by the total number of tasks ever enqueued.
   */
  #compactConsumedPrefix(): void {
    if (this.#queueHead <= compactionFloor || this.#queueHead * 2 <= this.#queue.length) return
    this.#queue.splice(0, this.#queueHead)
    for (let index = 0; index < this.#queue.length; index++) {
      /** Live record or tombstone after the shift. */
      const entry = this.#queue[index]
      if (entry !== undefined) entry.queueIndex = index
    }
    this.#queueHead = 0
  }

  /** Removes a queued record in O(1), leaving a tombstone for the FIFO head scanner. */
  #removeQueued(record: IMutationRecord): boolean {
    /** The record's slot, or -1 once dequeued. */
    const index = record.queueIndex
    if (index < this.#queueHead || this.#queue[index] !== record) return false
    this.#queue[index] = undefined
    record.queueIndex = -1
    this.#queuedCount--
    this.#compactConsumedPrefix()
    return true
  }
}

/**
 * Creates a first-in-first-out queue that runs one task at a time, so changes such as saves or
 * configuration updates land in submission order even when an earlier one is slower.
 *
 * `enqueue()` resolves or rejects with the task's own result. An optional admission timeout rejects
 * a task that waited too long with `QUEUE_ADMISSION_TIMEOUT`; the watchdog disarms the moment a
 * task starts. Passing `{ owner }` makes a running owner that submits to the same queue fail at
 * once with `QUEUE_SELF_DEPENDENCY` instead of deadlocking.
 */
export function createMutationQueue(options: IMutationQueueOptions = {}): IMutationQueue {
  return new MutationQueue(options)
}

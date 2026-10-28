/**
 * Owns stream scheduler/task admission and one default frame-yield transaction. Captured host
 * methods keep their receivers; every admitted task and listener is released once.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IScheduler, IScheduledTask } from '@migaia/utils/scheduler'
import { attachSecondaryErrors } from '@migaia/utils/error'
import {
  createSerializeError,
  createSerializeRangeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText
} from './errors.ts'
import {
  hasSerializeErrorIdentity,
  isSerializeTaggedError,
  readSerializeSignalAborted,
  readSerializeSignalReason
} from './operation-support.ts'

/** Captured listener and scheduler methods require only receiver-preserving invocation. */
type IInvokable<TResult> = (...args: never[]) => TResult

/** Validates the clock result before it can influence adaptive slice arithmetic. */
function validateSchedulerNow(value: unknown): number {
  if (typeof value !== 'number') {
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.schedulerNowType
    )
  }
  if (!Number.isFinite(value)) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.schedulerNowRange
    )
  }
  return value
}

/** Captures exactly one task cancellation method and preserves its host receiver. */
class SerializeScheduledTask implements IScheduledTask {
  /** Host object retained only for the admitted task's cancellation lifetime. */
  #receiver: object
  /** Once-read cancellation method; subsequent host mutation cannot replace it. */
  #cancel: IInvokable<void>

  /** Admits one host task while preserving the original getter failure boundary. */
  constructor(value: unknown) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      throw createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.schedulerTaskInvalid
      )
    }
    /** Raw cancellation capability is read once before the task becomes owned. */
    let cancel: unknown
    try {
      cancel = (value as { cancel?: unknown }).cancel
    } catch (error) {
      throw createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.schedulerTaskCancelGetterFailed,
        { cause: error }
      )
    }
    if (typeof cancel !== 'function') {
      throw createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.schedulerTaskInvalid
      )
    }
    this.#receiver = value
    this.#cancel = cancel as IInvokable<void>
  }

  /** Invokes the captured task capability; the yield owner enforces exactly-once release. */
  cancel(): void {
    Reflect.apply(this.#cancel, this.#receiver, [])
  }
}

/** Admitted scheduler capability owns native method receivers and serialize error translation. */
class SerializeSchedulerSnapshot implements IScheduler {
  /** Source scheduler remains the receiver of both once-captured capabilities. */
  #receiver: object
  /** Clock capability captured before any frame work begins. */
  #now: IInvokable<unknown>
  /** Scheduling capability captured before any frame work begins. */
  #schedule: IInvokable<unknown>

  /** Stores already-admitted methods without rereading host properties. */
  constructor(receiver: object, now: IInvokable<unknown>, schedule: IInvokable<unknown>) {
    this.#receiver = receiver
    this.#now = now
    this.#schedule = schedule
  }

  /** Reads one finite clock value and retains native call failures as the exact cause. */
  now(): number {
    try {
      return validateSchedulerNow(Reflect.apply(this.#now, this.#receiver, []))
    } catch (error) {
      if (hasSerializeErrorIdentity(error, SerializeErrorCode.invalidOption)) throw error
      throw createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.schedulerNowType,
        { cause: error }
      )
    }
  }

  /** Admits a task handle only after validating its once-read cancellation capability. */
  schedule(callback: () => void, delayMs: number): IScheduledTask {
    try {
      return new SerializeScheduledTask(
        Reflect.apply(this.#schedule, this.#receiver, [callback, delayMs])
      )
    } catch (error) {
      if (hasSerializeErrorIdentity(error, SerializeErrorCode.invalidOption)) throw error
      throw createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.schedulerInvalid,
        { cause: error }
      )
    }
  }
}

/** Captures scheduler getters once; malformed shapes remain distinct from failing accessors. */
export function snapshotSerializeScheduler(value: unknown): IScheduler | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  /** Captured methods are validated before constructing their private receiver owner. */
  let now: unknown
  /** Scheduling is captured after the clock to retain public getter order. */
  let schedule: unknown
  try {
    now = (value as { now?: unknown }).now
    schedule = (value as { schedule?: unknown }).schedule
  } catch (error) {
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.schedulerAccessorFailed,
      { cause: error }
    )
  }
  if (typeof now !== 'function' || typeof schedule !== 'function') return undefined
  return new SerializeSchedulerSnapshot(
    value,
    now as IInvokable<unknown>,
    schedule as IInvokable<unknown>
  )
}

/**
 * Owns one default-yield Promise, scheduler task and attempted abort registration. Settlement waits
 * for the schedule return boundary, including callback-before-return reentrancy.
 */
export class OwnedStreamYield {
  /** Admitted scheduler creates exactly one task after cancellation admission. */
  #scheduler: IScheduler
  /** Structural caller signal remains owned until settlement cleanup removes its listener. */
  #signal: IAbortSignal | undefined
  /** Promise settlement slots are installed before any external callback can run. */
  #resolve!: () => void
  /** First failure rejects the same Promise after all synchronous cleanup has been attempted. */
  #reject!: (error: unknown) => void
  /** Task is retained until exactly-once cancellation, even after a synchronous callback. */
  #task: IScheduledTask | undefined
  /** Callback arrival is recorded independently from schedule return. */
  #callbackFired = false
  /** Schedule admission must finish before task cleanup or Promise settlement. */
  #scheduleSettled = false
  /** Undefined may be thrown, so failure presence has its own state. */
  #hasPrimary = false
  /** First observed failure remains primary as cleanup failures are attached. */
  #primaryError: unknown
  /** Cancellation attempts are terminal even when the host cancel method throws. */
  #cancelAttempted = false
  /** Settlement suppresses later callbacks and reentrant cancellation. */
  #settled = false
  /** Registration is accounted before calling an external addEventListener. */
  #listenerAttempted = false
  /** Removal is accounted before invoking the external removal capability. */
  #listenerRemoved = false
  /** Captured admission capability avoids repeated hostile signal getter reads. */
  #addAbortListener: IInvokable<void> | undefined
  /** Captured release capability preserves the original signal receiver. */
  #removeAbortListener: IInvokable<void> | undefined
  /** Stable callback identity is shared by registration and exactly-once removal. */
  #onAbort = (): void => this.#abort()
  /** Stable scheduler callback records success before crossing the schedule return boundary. */
  #onScheduled = (): void => this.#scheduled()

  /** Stores the already-admitted scheduler and signal without running either capability. */
  constructor(scheduler: IScheduler, signal: IAbortSignal | undefined) {
    this.#scheduler = scheduler
    this.#signal = signal
  }

  /** Admits cancellation and one scheduler task, retaining original synchronous callback order. */
  run(): Promise<void> {
    /** Promise identity remains stable across registration, scheduling, and final cleanup. */
    const promise = new Promise<void>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
    try {
      if (!this.#admitSignal()) return promise
      this.#task = this.#scheduler.schedule(this.#onScheduled, 0)
      this.#scheduleSettled = true
    } catch (error) {
      if (!this.#hasPrimary) {
        this.#primaryError = isSerializeTaggedError(error, SerializeErrorCode.invalidOption)
          ? error
          : createSerializeTypeError(
              SerializeErrorCode.invalidOption,
              SerializeErrorText.schedulerInvalid,
              { cause: error }
            )
        this.#hasPrimary = true
      } else this.#primaryError = attachSecondaryErrors(this.#primaryError, [error])
      this.#scheduleSettled = true
    }
    this.#finish()
    return promise
  }

  /** Installs one listener and rechecks live abort state before scheduler admission. */
  #admitSignal(): boolean {
    /** Source identity remains fixed across accessor and registration reentrancy. */
    const signal = this.#signal
    if (signal === undefined) return true
    if (readSerializeSignalAborted(signal)) {
      this.#abort()
      this.#scheduleSettled = true
      this.#finish()
      return false
    }
    /** Listener methods are captured in the original add-then-remove order. */
    const add = signal.addEventListener
    /** Removal capability must exist before listener admission starts. */
    const remove = signal.removeEventListener
    if (typeof add !== 'function' || typeof remove !== 'function') {
      throw new TypeError(SerializeErrorText.signalInvalid)
    }
    this.#addAbortListener = add as IInvokable<void>
    this.#removeAbortListener = remove as IInvokable<void>
    this.#listenerAttempted = true
    try {
      Reflect.apply(this.#addAbortListener, signal, ['abort', this.#onAbort, { once: true }])
    } catch (error) {
      /** Registration failure wins over synchronous callback/recheck activity by contract. */
      const registrationError = isSerializeTaggedError(error, SerializeErrorCode.invalidOption)
        ? error
        : createSerializeTypeError(
            SerializeErrorCode.invalidOption,
            SerializeErrorText.signalRegistrationFailed,
            { cause: error }
          )
      /** Recheck failure is secondary even when its thrown value is undefined. */
      let recheckFailed = false
      /** Exact hostile state getter failure is retained after the registration primary. */
      let recheckError: unknown
      try {
        this.#recheckAbort()
      } catch (error) {
        recheckFailed = true
        recheckError = error
      }
      this.#primaryError = registrationError
      this.#hasPrimary = true
      if (recheckFailed)
        this.#primaryError = attachSecondaryErrors(this.#primaryError, [recheckError])
      this.#scheduleSettled = true
      this.#finish()
      return false
    }
    this.#recheckAbort()
    if (!this.#hasPrimary) return true
    this.#scheduleSettled = true
    this.#finish()
    return false
  }

  /** Checks state only when no earlier callback has already recorded cancellation. */
  #recheckAbort(): void {
    if (this.#signal === undefined || this.#hasPrimary) return
    if (readSerializeSignalAborted(this.#signal)) this.#abort()
  }

  /** First cancellation records its reason and waits for safe task-handle release. */
  #abort(): void {
    if (this.#settled || this.#hasPrimary) return
    try {
      this.#primaryError = createSerializeError(
        SerializeErrorCode.aborted,
        SerializeErrorText.aborted,
        {
          cause: this.#signal === undefined ? undefined : readSerializeSignalReason(this.#signal)
        }
      )
    } catch (error) {
      this.#primaryError = error
    }
    this.#hasPrimary = true
    this.#finish()
  }

  /** Records callback arrival while retaining the returned task until schedule settles. */
  #scheduled(): void {
    this.#callbackFired = true
    this.#finish()
  }

  /** Projects a cleanup failure without replacing an earlier primary outcome. */
  #recordCleanupFailure(error: unknown): void {
    if (!this.#hasPrimary) {
      this.#primaryError = error
      this.#hasPrimary = true
    } else this.#primaryError = attachSecondaryErrors(this.#primaryError, [error])
  }

  /** Cancels the task and removes every attempted registration once, in established order. */
  #cleanup(): void {
    if (this.#task !== undefined && !this.#cancelAttempted) {
      this.#cancelAttempted = true
      try {
        this.#task.cancel()
      } catch (error) {
        this.#recordCleanupFailure(
          isSerializeTaggedError(error, SerializeErrorCode.invalidOption)
            ? error
            : createSerializeTypeError(
                SerializeErrorCode.invalidOption,
                SerializeErrorText.schedulerTaskCancelFailed,
                { cause: error }
              )
        )
      }
    }
    if (
      this.#signal !== undefined &&
      this.#addAbortListener !== undefined &&
      this.#removeAbortListener !== undefined &&
      this.#listenerAttempted &&
      !this.#listenerRemoved
    ) {
      this.#listenerRemoved = true
      try {
        Reflect.apply(this.#removeAbortListener, this.#signal, ['abort', this.#onAbort])
      } catch (error) {
        this.#recordCleanupFailure(
          isSerializeTaggedError(error, SerializeErrorCode.invalidOption)
            ? error
            : createSerializeTypeError(
                SerializeErrorCode.invalidOption,
                SerializeErrorText.signalAccessorFailed,
                { cause: error }
              )
        )
      }
    }
  }

  /** Settles once after every synchronous cleanup, preserving original Promise timing. */
  #finish(): void {
    if (this.#settled || !this.#scheduleSettled || (!this.#callbackFired && !this.#hasPrimary))
      return
    this.#cleanup()
    this.#settled = true
    if (this.#hasPrimary) this.#reject(this.#primaryError)
    else this.#resolve()
  }
}

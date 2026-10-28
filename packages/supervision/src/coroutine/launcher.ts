/** Owns cooperative execution and exposure; supervision policy remains in the core. */
import { ABORT_EVENT } from '../text.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import { createAbortController } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import { SupervisionErrorCode } from '../error-code.js'
import { SupervisionErrorText } from '../error-text.js'
import { createSupervisionError } from '../errors.js'
import type { IUnitLauncher } from '../types.js'
import { coroutineCapabilities, CoroutineOutcome } from './constants.js'
import { coroutineFingerprint, CoroutineField } from './contract.js'
import type {
  ICoroutineExitStatus,
  ICoroutineHandle,
  ICoroutineRunContext,
  ICoroutineSpec
} from './types.js'

/** Weak ownership preserves private termination authority without retaining handles. */
const termination = new WeakMap<ICoroutineHandle<unknown>, () => void>()

/** Terminates only handles launched by this module; repeated calls are harmless. */
export function terminateCoroutineHandle(handle: ICoroutineHandle<unknown>): void {
  termination.get(handle)?.()
}

/** Preserves the plain handle's original own properties and live heartbeat getter. */
function executionHandle<TPort>(
  execution: CoroutineExecution<TPort>,
  identity: number
): ICoroutineHandle<TPort> {
  return {
    identity: { fingerprint: coroutineFingerprint(identity) },
    exited: execution.exited,
    exposed: execution.exposed,
    get lastHeartbeatAt() {
      return execution.lastHeartbeatAt
    }
  }
}

/** Owns one task until actual settlement, including an outstanding generator next. */
class CoroutineExecution<TPort> {
  /** Task cancellation is separate from the attempt's signal. */
  #controller = createAbortController()
  /** Clock shared by explicit and yielded heartbeats. */
  #scheduler: IScheduler
  /** Original passive-error outlet observes return failures before actual exit. */
  #report: (error: unknown) => void
  /** Attempt signal whose listener is removed on actual exit. */
  #signal: IAbortSignal
  /** Exposure may publish one port only. */
  #didExpose = false
  /** Resolver keeps exposure promise identity unchanged. */
  #resolveExposed!: (port: TPort) => void
  /** Resolver publishes disappearance as data, never rejection. */
  #resolveExited!: (status: ICoroutineExitStatus) => void
  /** Latest task progress in scheduler time. */
  #heartbeatAt: number
  /** Guards duplicate exit publication. */
  #settled = false
  /** Makes abort and iterator return idempotent. */
  #stopped = false
  /** Iterator being consumed, absent for promise tasks. */
  #iterator: AsyncIterator<unknown> | undefined
  /** Observed return request, independent of outstanding next. */
  #returnTask: Promise<IteratorResult<unknown>> | undefined
  /** Same callback is used by the abort listener and private termination authority. */
  #stop = (): void => this.stop()
  /** Original single exposure promise held by the public handle. */
  readonly exposed: Promise<TPort>
  /** Original nonrejecting actual-exit promise held by the public handle. */
  readonly exited: Promise<ICoroutineExitStatus>
  /** Plain handle is created after synchronous task invocation. */
  readonly handle: ICoroutineHandle<TPort>

  /** Starts synchronously without adding a promise or asynchronous boundary. */
  constructor(
    spec: ICoroutineSpec<TPort>,
    signal: IAbortSignal,
    scheduler: IScheduler,
    report: (error: unknown) => void,
    launcher: CoroutineLauncher<TPort>
  ) {
    this.#scheduler = scheduler
    this.#report = report
    this.#signal = signal
    this.exposed = new Promise<TPort>((resolve) => {
      this.#resolveExposed = resolve
    })
    this.#heartbeatAt = scheduler.now()
    this.exited = new Promise<ICoroutineExitStatus>((resolve) => {
      this.#resolveExited = resolve
    })
    this.#run(spec)
    this.handle = executionHandle(this, launcher.nextIdentity())
    signal.addEventListener(ABORT_EVENT, this.#stop, { once: true })
    if (signal.aborted) this.stop()
    void this.exited.then(() => this.#removeListener())
    termination.set(this.handle, this.#stop)
  }

  /** Reads progress without copying it into the plain handle. */
  get lastHeartbeatAt(): number {
    return this.#heartbeatAt
  }

  /** Requests generator return once; failure does not settle outstanding next. */
  stop(): void {
    if (this.#stopped) return
    this.#stopped = true
    this.#controller.abort()
    if (this.#iterator?.return) {
      try {
        this.#returnTask = Promise.resolve(this.#iterator.return())
      } catch (error) {
        this.#returnTask = Promise.reject(error)
      }
      void this.#returnTask.then(
        () => undefined,
        (error) => this.#reportFailure(error)
      )
    }
  }

  /** Calls the original parameter callback without changing its undefined receiver. */
  #reportFailure(error: unknown): void {
    /** Passive error outlet retains its original invocation context. */
    const report = this.#report
    report(error)
  }

  /** Invokes the task before handle creation, preserving reentrant fingerprint order. */
  #run(spec: ICoroutineSpec<TPort>): void {
    /** Capability callbacks forward to the state owner. */
    const context: ICoroutineRunContext<TPort> = {
      signal: this.#controller.signal,
      expose: (port) => this.#expose(port),
      heartbeat: () => this.#heartbeat()
    }
    /** Task return selects its original promise or iterator settlement path. */
    let produced: PromiseLike<unknown> | AsyncIterable<unknown> | void
    try {
      produced = spec.task(context)
    } catch (error) {
      produced = Promise.reject(error)
    }
    if (produced !== null && typeof produced === 'object' && Symbol.asyncIterator in produced) {
      this.#startIterator(produced as AsyncIterable<unknown>)
    } else {
      void Promise.resolve(produced).then(
        () => this.#finish({ outcome: CoroutineOutcome.fulfilled }),
        (error) => this.#finish({ outcome: CoroutineOutcome.rejected, error })
      )
    }
  }

  /** Obtains the iterator and begins consumption in the original synchronous call. */
  #startIterator(produced: AsyncIterable<unknown>): void {
    try {
      this.#iterator = produced[Symbol.asyncIterator]()
      void this.#consume()
    } catch (error) {
      this.#finish({ outcome: CoroutineOutcome.rejected, error })
    }
  }

  /** Serial next consumption waits for both pending next and return on cancellation. */
  async #consume(): Promise<void> {
    try {
      while (true) {
        /** Settlement proves the outstanding iterator operation actually ended. */
        const step = await this.#iterator!.next()
        this.#heartbeat()
        if (this.#stopped) {
          await this.#returnTask
          this.#finish({ outcome: CoroutineOutcome.fulfilled })
          return
        }
        if (step.done) {
          this.#finish({ outcome: CoroutineOutcome.fulfilled })
          return
        }
      }
    } catch (error) {
      this.#finish({ outcome: CoroutineOutcome.rejected, error })
    }
  }

  /** Enforces single publication with the original native option error. */
  #expose(port: TPort): void {
    if (this.#didExpose)
      throw createSupervisionError(
        TypeError,
        SupervisionErrorCode.invalidOption,
        SupervisionErrorText.invalidOption,
        { detail: { field: CoroutineField.expose } }
      )
    this.#didExpose = true
    this.#resolveExposed(port)
  }

  /** Records explicit task progress and iterator yields on the injected clock. */
  #heartbeat(): void {
    this.#heartbeatAt = this.#scheduler.now()
  }

  /** Publishes original settlement once, retaining task rejection identity as data. */
  #finish(status: ICoroutineExitStatus): void {
    if (this.#settled) return
    this.#settled = true
    this.#resolveExited(status)
  }

  /** Actual exit removes the attempt listener; the WeakMap does not retain a dead handle. */
  #removeListener(): void {
    this.#signal.removeEventListener(ABORT_EVENT, this.#stop)
  }
}

/** Owns launch ordinals and allocates executions only when launch is requested. */
class CoroutineLauncher<TPort> {
  /** Sequence advances after task invocation, preserving nested launch ordering. */
  #nextIdentity = 0
  /** Clock shared with each execution. */
  #scheduler: IScheduler
  /** Caller-owned passive error outlet. */
  #report: (error: unknown) => void

  /** Captures configuration without creating task resources. */
  constructor(scheduler: IScheduler, report: (error: unknown) => void) {
    this.#scheduler = scheduler
    this.#report = report
  }

  /** Assigns fingerprints at the original post-invocation point. */
  nextIdentity(): number {
    return ++this.#nextIdentity
  }

  /** Retains the original plain launcher object and detachable launch method. */
  port(): IUnitLauncher<ICoroutineSpec<TPort>, ICoroutineHandle<TPort>> {
    return {
      capabilities: coroutineCapabilities,
      launch: async (spec, context) => this.#launch(spec, context.signal)
    }
  }

  /** Rejects an aborted attempt before invoking task code. */
  #launch(spec: ICoroutineSpec<TPort>, signal: IAbortSignal): ICoroutineHandle<TPort> {
    if (signal.aborted) throw signal.reason
    return new CoroutineExecution(spec, signal, this.#scheduler, this.#report, this).handle
  }
}

/** Constructs a cooperative launcher whose exited promises never reject. */
export function createCoroutineLauncher<TPort>(
  scheduler: IScheduler,
  report: (error: unknown) => void
): IUnitLauncher<ICoroutineSpec<TPort>, ICoroutineHandle<TPort>> {
  return new CoroutineLauncher<TPort>(scheduler, report).port()
}

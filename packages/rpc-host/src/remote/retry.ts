import { createRpcAbortError, createRpcTimeoutError } from '../core/errors.js'
import { createAbortController } from '@migaia/lifecycle'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import type { IRpcPortableValue } from '@migaia/rpc-contract'

import { isForwardedOperation } from '../core/internal/outbound-envelope.js'
import { createProviderGenerationRetired } from '../core/internal/provider.js'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { reportDiagnostic } from '../core/internal/diagnostic-reporter.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import type { IRemoteGenerationEvents, IRemoteRetryDispatch, IRemoteRetryPort } from './types.js'

/** Existing generation owner inputs shared by ordinary and forwarded logical dispatch. */
type IRemoteRetryOwnerOptions = Readonly<{
  events: IRemoteGenerationEvents
  scheduler: IScheduler
  report(error: unknown): void
}>

/**
 * Create an opt-in request retry policy with at most two physical sends. Only an idempotent request
 * can replay after generation departure, retaining any supplied key; readiness waiting consumes the
 * original deadline. Unreconcilable departure rejects REMOTE_RESULT_UNKNOWN rather than silently
 * rerunning side effects.
 */
export function createRemoteRetryPort(options: IRemoteRetryOwnerOptions): IRemoteRetryPort {
  return Object.freeze({
    dispatch: (input: IRemoteRetryDispatch) => dispatchRemoteRetry(options, input)
  })
}

/** Use the original dispatch owner for forwarded work without constructing a second retry port. */
export function dispatchRemoteRetry(
  options: IRemoteRetryOwnerOptions,
  input: IRemoteRetryDispatch
): Promise<IRpcPortableValue> {
  return new RemoteRetryDispatch(options, input).promise
}

/** One physical attempt retains its original send/departure facts under the logical dispatch owner. */
type IRemoteRetryAttempt = { generation: number; sent: boolean; departed: boolean }

/** One logical retry transaction owns its original native Promise, deadline and single replay. */
class RemoteRetryDispatch {
  /** Genuine generation events and scheduler remain owned by the original native binding. */
  readonly #options: IRemoteRetryOwnerOptions
  /** Caller options, signal and sendOnce retain their original object identity and receiver. */
  readonly #input: IRemoteRetryDispatch
  /** Only actual replay creates the original cancelable readiness waiter. */
  #controller: ReturnType<typeof createAbortController> | undefined
  /** Current original generation departure receipt is removed by bare invocation. */
  #unsubscribe: () => void = () => undefined
  /** One original timer covers both sends and all replacement readiness waiting. */
  #timer: IScheduledTask | undefined
  /** Terminal state prevents late sends or readiness outcomes from publishing twice. */
  #settled = false
  /** Original departure reason remains the primary cause of an unknown result. */
  #leaveReason: unknown
  /** Only the original generation may trigger one replay; a second departure is terminal. */
  #replayed = false
  /** Successful settlement resolves this exact original native Promise. */
  #resolve!: (value: IRpcPortableValue) => void
  /** Failure settlement rejects that same Promise without wrapping its original error. */
  #reject!: (reason: unknown) => void
  /** Dispatch callers receive this single native Promise, created before synchronous first send. */
  readonly promise: Promise<IRpcPortableValue>

  /**
   * Start inside the same native Promise executor, preserving synchronous send and thrown
   * rejection.
   */
  constructor(options: IRemoteRetryOwnerOptions, input: IRemoteRetryDispatch) {
    this.#options = options
    this.#input = input
    this.promise = new Promise<IRpcPortableValue>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#start()
    })
  }
  /** Terminal cleanup retains original unsubscribe/timer/abort order before native settlement. */
  #finish(result: IRpcPortableValue | unknown, success: boolean): void {
    if (this.#settled) return
    this.#settled = true
    ;(0, this.#unsubscribe)()
    this.#timer?.cancel()
    this.#input.signal?.removeEventListener('abort', this.#onAbort)
    this.#controller?.abort()
    if (success) (0, this.#resolve)(result as IRpcPortableValue)
    else (0, this.#reject)(result)
  }
  /** Package error construction retains the exact original departure reason and supplied metadata. */
  #unknownResult(generation: number, reason?: unknown): Error {
    return createRemoteLayerError(RpcRemoteLayerErrorCode.resultUnknown, this.#leaveReason, {
      method: this.#input.method,
      generation,
      ...(reason === undefined ? {} : { reason })
    })
  }
  /** Caller cancellation keeps its original signal reason and the same cached listener identity. */
  readonly #onAbort = (): void => {
    this.#finish(
      createRpcAbortError(undefined, undefined, resolveAbortReason(this.#input.signal!)),
      false
    )
  }
  /** Read the remaining original logical budget without restarting its deadline for replay. */
  #remaining(): number | undefined {
    return this.#input.deadlineAt === undefined
      ? undefined
      : Math.max(0, this.#input.deadlineAt - this.#options.scheduler.now())
  }
  /** Departures advance only this attempt's original facts and the one allowed replay transition. */
  #leave(attempt: IRemoteRetryAttempt, reason: unknown): void {
    if (this.#settled) return
    attempt.departed = true
    this.#leaveReason = reason
    ;(0, this.#unsubscribe)()
    if (!attempt.sent) {
      this.#finish(
        createRemoteLayerError(RpcRemoteLayerErrorCode.closed, reason, {
          generation: attempt.generation
        }),
        false
      )
      return
    }
    if (isForwardedOperation(this.#input)) {
      this.#finish(createProviderGenerationRetired(reason), false)
      return
    }
    if (!this.#input.idempotent || this.#replayed) {
      this.#finish(this.#unknownResult(attempt.generation), false)
      return
    }
    this.#replayed = true
    this.#controller = createAbortController()
    void this.#options.events.whenReady(attempt.generation, this.#controller.signal).then(
      (next) => {
        if (!this.#settled) this.#send(next)
      },
      (error: unknown) => {
        if (!this.#settled) this.#finish(this.#unknownResult(attempt.generation, error), false)
      }
    )
  }
  /** Observe one original generation before synchronously invoking its genuine physical sendOnce. */
  #send(generation: number): void {
    if (this.#settled) return
    /** Genuine binding state is checked before any departure subscription or frame admission. */
    const current = this.#options.events.current()
    if (!current.active || current.generation !== generation) {
      this.#finish(
        this.#replayed
          ? this.#unknownResult(generation)
          : createRemoteLayerError(RpcRemoteLayerErrorCode.closed, this.#leaveReason, {
              generation
            }),
        false
      )
      return
    }
    /**
     * Explicit attempt context belongs only to this original physical send and its outcome
     * callbacks.
     */
    const attempt: IRemoteRetryAttempt = { generation, sent: false, departed: false }
    this.#unsubscribe = this.#options.events.onLeave(generation, (reason) =>
      this.#leave(attempt, reason)
    )
    if (this.#settled || attempt.departed) {
      ;(0, this.#unsubscribe)()
      return
    }
    /** Readiness waiting has already consumed its share of the same original deadline. */
    const budget = this.#remaining()
    if (budget === 0) {
      this.#finish(createRpcTimeoutError(), false)
      return
    }
    attempt.sent = true
    try {
      void this.#input
        .sendOnce({ expectedGeneration: generation, key: this.#input.key, remainingMs: budget })
        .then(
          (value) => {
            if (!attempt.departed) this.#finish(value, true)
          },
          (error: unknown) => {
            if (attempt.departed) reportDiagnostic(this.#options.report, error)
            else this.#finish(error, false)
          }
        )
    } catch (error) {
      if (attempt.departed) reportDiagnostic(this.#options.report, error)
      else this.#finish(error, false)
    }
  }
  /** Install the original caller abort listener and deadline before the same synchronous first send. */
  #start(): void {
    if (this.#input.signal?.aborted) {
      this.#onAbort()
      return
    }
    this.#input.signal?.addEventListener('abort', this.#onAbort, { once: true })
    /** Zero budget fails before frame admission exactly as on the original executor. */
    const budget = this.#remaining()
    if (budget === 0) {
      this.#finish(createRpcTimeoutError(), false)
      return
    }
    if (budget !== undefined)
      this.#timer = this.#options.scheduler.schedule(
        () => this.#finish(createRpcTimeoutError(), false),
        budget
      )
    this.#send(this.#input.generation)
  }
}

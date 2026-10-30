/** The original generation retry transaction now belongs to the executing origin feature. */
import { createAbortController } from '@migaia/lifecycle'
import { sleep, type IAbortSignal } from '@migaia/utils/promise'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import {
  type IRpcAttempt,
  type IRpcAttemptAvailability,
  type IRpcAvailableAttempt,
  type IRpcRetryFeature,
  type IRpcRetryExecution,
  type IRetryFeatureOptions
} from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode, RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import { safeRead } from '@migaia/rpc-contract/errors'
import { createRpcAbortError, createRpcError, createRpcTimeoutError } from '../host/error-owner.ts'
import { createRemoteLayerError } from '../host/remote-error-owner.ts'
import { defaultRpcId } from '../host/identity.ts'
import { defaultRpcReporter, reportDiagnostic } from '../host/report.ts'
import { resolveAbortReason } from '../host/abort-reason.ts'
import { HostErrorText } from '../host/error-text.ts'
import { localErrorWireSummary } from '../host/error-wire-metadata.ts'
import { defineFeature } from '@migaia/plugin-host'
import { registerRpcFeature, RpcCallFeatureRole } from '../sdk/metadata.ts'
export type { IRetryFeatureOptions } from '@migaia/rpc-contract/interfaces'

/** Captured policy is shared while every logical dispatch owns independent live resources. */
type IRetryPolicy = Readonly<{
  attempts: number
  backoff: IRetryFeatureOptions['backoff']
  keyFactory(): string
  scheduler: IScheduler
  report(error: unknown): void
}>
/** Physical handoff is explicit and cannot be inferred from mutable public error diagnostics. */
type IRetrySend = {
  available: IRpcAvailableAttempt | undefined
  sent: boolean
  departed: boolean
  reason?: unknown
}

/** The empty receipt owns no subscription and permits unconditional terminal cleanup. */
function noSubscription(): void {}

/** One original Promise owns departure, readiness, inherited budget and a bounded replay count. */
class RetryInvocation<T> {
  /** Native supervision and clock remain borrowed from the actual installing carrier. */
  readonly #policy: IRetryPolicy
  /** Settlement releases the originating port rather than retaining payload through late work. */
  #input: IRpcAttempt<T> | undefined
  /** Real accepted/native availability authorizes replay without fabricating a generation. */
  #availability: IRpcAttemptAvailability | undefined
  /** The admitted method supplies original unknown-result detail without retaining its directory. */
  readonly #method: string | undefined
  /** Only the actual accepted declaration grants replay after physical departure. */
  readonly #idempotent: boolean
  /** One logical key is generated once and remains identical across physical generations. */
  readonly #key: string | undefined
  /** Caller cancellation stays active through replacement readiness and backoff. */
  readonly #signal: IAbortSignal
  /** The inherited deadline is created once, never renewed by readiness or later attempts. */
  readonly #deadline: number | undefined
  /** Only actual replacement acquires this canonical cancelable readiness scope. */
  #controller: ReturnType<typeof createAbortController> | undefined
  /** Each generation's original leave receipt is removed before terminal settlement. */
  #unsubscribe: () => void = noSubscription
  /** One inherited deadline timer covers every physical send and readiness/backoff wait. */
  #timer: IScheduledTask | undefined
  /** First terminal prevents late attempts or native events from publishing twice. */
  #settled = false
  /** Original physical departure remains the primary cause of an unknown result. */
  #leaveReason: unknown
  /** The configured total limit counts actual invoke admissions, including the first attempt. */
  #count = 0
  /** Native settlement functions preserve the original public Promise. */
  #resolve!: (value: T) => void
  /** Native rejection preserves original business or domain failure identity. */
  #reject!: (reason: unknown) => void
  /** Construction starts the original first attempt synchronously inside this one Promise. */
  readonly promise: Promise<T>

  /** Capture admitted facts and one key before registering original cancellation/departure work. */
  constructor(policy: IRetryPolicy, input: IRpcAttempt<T>) {
    this.#policy = policy
    this.#input = input
    this.#availability = input.facts?.availability
    this.#method = input.facts?.method
    this.#idempotent = input.facts?.idempotent ?? false
    this.#key =
      input.facts?.idempotencyKey ?? (this.#idempotent ? (0, policy.keyFactory)() : undefined)
    this.#signal = input.signal
    this.#deadline =
      input.remainingMs === undefined ? undefined : policy.scheduler.now() + input.remainingMs
    this.promise = new Promise<T>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      try {
        this.#start()
      } catch (error) {
        this.#finish(error, false)
      }
    })
  }

  /** Preserve unsubscribe, timer, caller-listener, readiness-abort order before native settlement. */
  #finish(value: unknown, success: boolean): void {
    if (this.#settled) return
    this.#settled = true
    this.#removeLeave()
    try {
      this.#timer?.cancel()
    } catch (error) {
      this.#report(error)
    }
    this.#timer = undefined
    try {
      this.#signal.removeEventListener('abort', this.#onAbort)
    } catch (error) {
      this.#report(error)
    }
    try {
      this.#controller?.abort()
    } catch (error) {
      this.#report(error)
    }
    this.#input = undefined
    this.#availability = undefined
    if (success) (0, this.#resolve)(value as T)
    else (0, this.#reject)(value)
  }

  /** The original exact receipt is invoked bare once, even when leave reenters subscription setup. */
  #removeLeave(): void {
    /** Reset before invocation so a reentrant close cannot consume the receipt again. */
    const remove = this.#unsubscribe
    this.#unsubscribe = noSubscription
    try {
      remove()
    } catch (error) {
      this.#report(error)
    }
  }

  /** Native departure and failed replacement retain the original method/generation diagnostics. */
  #unknown(generation: number | undefined, reason?: unknown): Error {
    return createRemoteLayerError(RpcRemoteLayerErrorCode.resultUnknown, this.#leaveReason, {
      method: this.#method,
      generation,
      ...(reason === undefined ? {} : { reason })
    })
  }

  /** Caller abort keeps the original reason through readiness and backoff. */
  readonly #onAbort = (): void => {
    this.#finish(createRpcAbortError(undefined, undefined, resolveAbortReason(this.#signal)), false)
  }

  /** Read the original logical deadline without resetting it for a new generation. */
  #remaining(): number | undefined {
    return this.#deadline === undefined
      ? undefined
      : Math.max(0, this.#deadline - this.#policy.scheduler.now())
  }

  /** Only a genuine native leave may replay a physically written, declared-idempotent origin. */
  #leave(send: IRetrySend, reason: unknown): void {
    if (this.#settled) return
    send.departed = true
    send.reason = reason
    this.#leaveReason = reason
    this.#removeLeave()
    if (!send.sent) {
      this.#finish(
        createRemoteLayerError(RpcRemoteLayerErrorCode.closed, reason, {
          generation: send.available?.generation
        }),
        false
      )
    } else if (!this.#idempotent || this.#count >= this.#policy.attempts)
      this.#finish(this.#unknown(send.available?.generation), false)
    else {
      this.#controller ??= createAbortController()
      void this.#replace(send.available!)
    }
  }

  /** Replacement waits on original native readiness and consumes the same inherited deadline. */
  async #replace(available: IRpcAvailableAttempt): Promise<void> {
    try {
      /** Actual accepted readiness, rather than supervision state alone, authorizes the next send. */
      const next = await available.whenReady(this.#controller!.signal)
      if (this.#settled) return
      /** Backoff uses utils' timer/abort owner; zero preserves the original immediate replay path. */
      const backoff = this.#policy.backoff
      /** Failure callbacks receive the same actual native cancellation scope as the wait. */
      const delay =
        typeof backoff === 'function'
          ? backoff(this.#leaveReason, {
              attempt: this.#count,
              maxAttempts: this.#policy.attempts,
              signal: this.#controller!.signal
            })
          : (backoff ?? 0)
      if (delay !== 0)
        await sleep(delay, {
          signal: this.#controller!.signal,
          scheduler: this.#policy.scheduler
        })
      if (!this.#settled) this.#send(next)
    } catch (error) {
      if (!this.#settled) this.#finish(this.#unknown(available.generation, error), false)
    }
  }

  /** Subscribe before invoking; true physical onWriteStart supplies the original sent fact. */
  #send(available: IRpcAvailableAttempt | undefined): void {
    if (this.#settled) return
    /** Native admission can reject before subscribing or admitting any physical frame. */
    const current = this.#availability?.current()
    if (
      this.#availability &&
      (!current ||
        current.carrierId !== available?.carrierId ||
        current.generation !== available?.generation)
    ) {
      this.#finish(
        this.#count > 0
          ? this.#unknown(available?.generation)
          : createRemoteLayerError(RpcRemoteLayerErrorCode.closed, this.#leaveReason, {
              generation: available?.generation
            }),
        false
      )
      return
    }
    /** One attempt's callbacks retain compact facts only, never a frame or native Session. */
    const send: IRetrySend = { available, sent: false, departed: false }
    if (available) this.#unsubscribe = available.onLeave((reason) => this.#leave(send, reason))
    if (this.#settled || send.departed) {
      this.#removeLeave()
      return
    }
    /** Waiting and backoff have already consumed time from the same inherited deadline. */
    const budget = this.#remaining()
    if (budget === 0) {
      this.#finish(createRpcTimeoutError(), false)
      return
    }
    this.#count += 1
    try {
      void this.#input!
        .invoke(this.#signal, budget, {
          expectedCarrierId: available?.carrierId,
          expectedGeneration: available?.generation,
          idempotencyKey: this.#key,
          onWriteStart: () => {
            send.sent = true
          }
        })
        .then(
          (value) => {
            if (!send.departed) this.#finish(value, true)
          },
          (error: unknown) => {
            if (send.departed) this.#reportDeparted(send, error)
            else this.#finish(error, false)
          }
        )
    } catch (error) {
      if (send.departed) this.#reportDeparted(send, error)
      else this.#finish(error, false)
    }
  }

  /** Install original cancellation and deadline before the same synchronous first send. */
  #start(): void {
    if (this.#signal.aborted) {
      this.#onAbort()
      return
    }
    this.#signal.addEventListener('abort', this.#onAbort, { once: true })
    /** Zero inherited budget fails before any frame or departure subscription is admitted. */
    const budget = this.#remaining()
    if (budget === 0) {
      this.#finish(createRpcTimeoutError(), false)
      return
    }
    if (budget !== undefined)
      this.#timer = this.#policy.scheduler.schedule(
        () => this.#finish(createRpcTimeoutError(), false),
        budget
      )
    this.#send(this.#availability?.current())
  }

  /** Only the original departure or its locally minted closed/unknown wrapper is expected retry. */
  #reportDeparted(send: IRetrySend, error: unknown): void {
    /** The owner receipt survives public code mutation and cannot be forged by a business error. */
    const code = localErrorWireSummary(error)?.code
    if (
      error === send.reason ||
      ((code === RpcRemoteLayerErrorCode.closed ||
        code === RpcRemoteLayerErrorCode.resultUnknown) &&
        safeRead(error, 'cause') === send.reason)
    )
      return
    this.#report(error)
  }

  /** Genuine late retired failures and secondary cleanup retain the original diagnostic owner. */
  #report(error: unknown): void {
    reportDiagnostic(this.#policy.report, error)
  }
}

/** Capture supported retry fields once; construction owns configuration, never a logical call. */
function snapshotRetry(options: IRetryFeatureOptions): IRetryPolicy {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw createRpcError(RpcCoreErrorCode.invalidConfig, HostErrorText.callFeatureInvalid)
  /** No native acquisition or call registry is created by policy construction. */
  const policy = {
    attempts: options.attempts ?? 2,
    backoff: options.backoff,
    keyFactory: options.keyFactory ?? defaultRpcId,
    scheduler: options.scheduler ?? systemScheduler,
    report: options.report ?? defaultRpcReporter
  }
  if (
    !Number.isSafeInteger(policy.attempts) ||
    policy.attempts < 1 ||
    (policy.backoff !== undefined &&
      typeof policy.backoff !== 'function' &&
      (!Number.isFinite(policy.backoff) || policy.backoff < 0))
  )
    throw createRpcError(RpcCoreErrorCode.invalidConfig, HostErrorText.callFeatureInvalid)
  return Object.freeze(policy)
}

/** A complete strategy owns execution while FeatureScope alone owns precedence and composition. */
class RetryExecution implements IRpcRetryExecution {
  /** Cold options cannot change an already originating call. */
  readonly #policy: IRetryPolicy

  /** Preserve the original one-replay default and snapshot the supported strategy controls. */
  constructor(options: IRetryFeatureOptions) {
    this.#policy = snapshotRetry(options)
  }

  /** Generation-capable origins replay; ordinary ungoverned sources preserve one send and identity. */
  run<T>(attempt: IRpcAttempt<T>): Promise<T> {
    try {
      return new RetryInvocation(this.#policy, attempt).promise
    } catch (error) {
      return Promise.reject(error)
    }
  }
}

/** Execute plain retry parameters through the same origin strategy used by native installations. */
export function createRpcRetryExecution(options: IRetryFeatureOptions = {}): IRpcRetryExecution {
  return Object.freeze(new RetryExecution(options))
}

/** Define a cold origin strategy whose execution owner belongs to the declaring registration. */
export function retryFeature(options: IRetryFeatureOptions = {}): IRpcRetryFeature {
  /** Snapshot and validate now, without creating any logical invocation or native resource. */
  const policy = snapshotRetry(options)
  /** Installation creates the actual independent owner; the token exposes no execution methods. */
  const feature = defineFeature({ install: () => createRpcRetryExecution(policy) })
  registerRpcFeature(feature, { role: RpcCallFeatureRole.retry })
  return feature
}

export default retryFeature

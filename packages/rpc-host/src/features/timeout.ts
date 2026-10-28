/** An executing timeout owns one attempt deadline; Host selects the complete instance only. */
import {
  createAbortTimeoutSignal,
  raceWithAbort,
  type IAbortTimeoutSignal,
  type INativeAbortSignal
} from '@migaia/utils/promise'
import { UtilsAbortError } from '@migaia/utils/error'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import {
  RpcCallFeatureKind,
  type IRpcAttempt,
  type IRpcTimeoutFeature
} from '@migaia/rpc-contract/interfaces'
import { RpcAbortError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  createRpcAbortError,
  createRpcError,
  createRpcTimeoutError,
  isLocalRpcError
} from '../host/error-owner.ts'
import { defaultRpcReporter, reportDiagnostic } from '../host/report.ts'
import { RpcTimeoutFeatureText } from './timeout-text.ts'

/** Clock and reporting are explicit policy resources, independent from host call selection. */
export type ITimeoutFeatureOptions = Readonly<{
  ms: number
  scheduler?: IScheduler
  report?(error: unknown): void
}>
/** One factory snapshot prevents option getters from changing later attempts. */
type ITimeoutPolicy = Readonly<{
  ms: number
  scheduler: IScheduler
  report(error: unknown): void
}>

/** Capture getters once and retain their original failure as the established configuration cause. */
function snapshotTimeout(options: ITimeoutFeatureOptions): ITimeoutPolicy {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcTimeoutFeatureText.descriptorInvalid)
  /** Only property acquisition is categorized as an unreadable descriptor. */
  let policy: ITimeoutPolicy
  try {
    policy = {
      ms: options.ms,
      scheduler: options.scheduler ?? systemScheduler,
      report: options.report ?? defaultRpcReporter
    }
  } catch (cause) {
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcTimeoutFeatureText.descriptorUnreadable,
      cause
    )
  }
  if (!Number.isFinite(policy.ms) || policy.ms < 0)
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcTimeoutFeatureText.durationInvalid)
  return Object.freeze(policy)
}

/** One run owns domain error selection while utils owns its actual timer and abort subscriptions. */
class TimeoutAttempt<T> {
  /** Immutable policy is shared; each attempt independently owns its resources. */
  readonly #policy: ITimeoutPolicy
  /** The invocation owns payload and physical work; this policy borrows only its attempt port. */
  #attempt: IRpcAttempt<T> | undefined
  /** A selected timeout can shorten, never renew, the inherited remaining deadline. */
  readonly #budget: number
  /** Canonical merged signal disposal removes its timer and outside abort registration. */
  #control: IAbortTimeoutSignal | undefined
  /** Exact locally minted deadline identity distinguishes timer expiry from business failures. */
  #deadlineError: ReturnType<typeof createRpcTimeoutError> | undefined
  /** A business-thrown utility error must cross unchanged rather than be reclassified. */
  #failure: unknown

  /** Capture one logical attempt before any zero deadline or pre-abort can run. */
  constructor(policy: ITimeoutPolicy, attempt: IRpcAttempt<T>) {
    this.#policy = policy
    this.#attempt = attempt
    this.#budget =
      attempt.remainingMs === undefined ? policy.ms : Math.min(policy.ms, attempt.remainingMs)
  }

  /** Settle even an uncooperative attempt while disposing every actual timer and listener. */
  async run(): Promise<T> {
    this.#control = createAbortTimeoutSignal({
      signal: this.#attempt!.signal,
      timeoutMs: this.#budget,
      timeoutReason: this.#deadline,
      scheduler: this.#policy.scheduler,
      report: this.#report
    })
    try {
      return await raceWithAbort(this.#invoke, {
        signal: this.#control.signal,
        report: this.#report,
        cleanupPolicy: 'report'
      })
    } catch (error) {
      if (error === this.#failure) throw error
      if (error instanceof UtilsAbortError) {
        if (this.#deadlineError && error.cause === this.#deadlineError) throw this.#deadlineError
        throw createRpcAbortError(undefined, undefined, error.cause)
      }
      throw error
    } finally {
      this.#control.dispose()
      this.#attempt = undefined
    }
  }

  /** The domain deadline error is created only when the owned timer actually expires. */
  readonly #deadline = (): unknown => (this.#deadlineError = createRpcTimeoutError())

  /** Preserve any original business failure by exact identity before utils observes settlement. */
  readonly #invoke = ({ signal }: { signal: INativeAbortSignal }): Promise<T> => {
    try {
      return this.#attempt!.invoke(signal, this.#budget).catch(this.#rejected)
    } catch (error) {
      return this.#rejected(error)
    }
  }

  /** The rejected operation preserves the exact original error before outer control settlement. */
  readonly #rejected = (error: unknown): never => {
    this.#failure = error
    throw error
  }

  /** Native call cancellation acknowledgement is contained; genuine late failures are reported. */
  readonly #report = (error: unknown): void => {
    /** Only a real abort can authorize suppressing its matching local acknowledgement. */
    const signal = this.#control?.signal
    if (signal?.aborted && isLocalRpcError(error, RpcAbortError) && error.cause === signal.reason)
      return
    reportDiagnostic(this.#policy.report, error)
  }
}

/** Complete executing policy; it contributes no numeric defaults or host configuration. */
class TimeoutFeature implements IRpcTimeoutFeature {
  /** The canonical interface discriminant participates in FeatureScope's sole selection rule. */
  readonly kind = RpcCallFeatureKind.timeout
  /** Factory-captured configuration stays stable across originating attempts. */
  readonly #policy: ITimeoutPolicy

  /** Snapshot only this feature's policy; no host or physical source is acquired. */
  constructor(options: ITimeoutFeatureOptions) {
    this.#policy = snapshotTimeout(options)
  }

  /** Each retry attempt gets its own timer constrained by the same inherited deadline. */
  run<T>(attempt: IRpcAttempt<T>): Promise<T> {
    return new TimeoutAttempt(this.#policy, attempt).run()
  }
}

/** Create a complete finite non-negative timeout policy, including a zero pre-send deadline. */
export function timeout(options: ITimeoutFeatureOptions): IRpcTimeoutFeature {
  return Object.freeze(new TimeoutFeature(options))
}

export default timeout

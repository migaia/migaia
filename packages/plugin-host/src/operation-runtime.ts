import type { IAbortSignal } from '@migaia/utils/promise'
import { boundedWait, createGenerationController, type IGenerationRequest } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import ERROR_TEXT, { PluginHostError } from './error-text.ts'
import { PluginHostErrorCode } from './error-code.ts'

type IPluginHostOperationRegistration = {
  operation?: IGenerationRequest
  operationDeadlineAt?: number
}

type IPluginHostOperationRuntimeOptions = Readonly<{
  readonly parentSignal: IAbortSignal
  readonly scheduler: IScheduler
  readonly timeoutMs: number | false
  readonly isHostOpen: () => boolean
  readonly diagnostic: (message: string) => void
}>

/** Owns lifecycle-hook generation authority, deadlines, and timeout supersession. */
export class PluginHostOperationRuntime {
  /** Monotonic generation controller for install/update hook authority. */
  readonly #controller
  /** Immutable scheduler, timeout policy, and terminal-state observer. */
  readonly #options: IPluginHostOperationRuntimeOptions

  constructor(options: IPluginHostOperationRuntimeOptions) {
    this.#options = options
    this.#controller = createGenerationController({
      parentSignal: options.parentSignal,
      scheduler: options.scheduler
    })
  }

  /** Starts one generation and records its single absolute deadline. */
  begin<TRegistration extends IPluginHostOperationRegistration>(
    registration: TRegistration
  ): IGenerationRequest {
    const request = this.#controller.begin()
    registration.operation = request
    registration.operationDeadlineAt =
      this.#options.timeoutMs === false
        ? undefined
        : this.#options.scheduler.now() + this.#options.timeoutMs
    return request
  }

  /** Waits for a hook result and supersedes its generation when the deadline wins. */
  async await<T>(
    result: T | PromiseLike<T>,
    registration: IPluginHostOperationRegistration
  ): Promise<T> {
    const request = registration.operation
    const deadlineAt = registration.operationDeadlineAt
    if (!request || this.#options.timeoutMs === false || deadlineAt === undefined)
      return await result
    /** One normalization owns a legal thenable's side effects throughout this operation. */
    const observed = Promise.resolve(result)
    const settled = await boundedWait(observed, deadlineAt, {
      scheduler: this.#options.scheduler
    })
    if (settled) return await observed
    const timeout = this.#createTimeoutError()
    try {
      this.#controller.supersede(timeout)
    } catch (secondary) {
      // The timeout primary stays authoritative; the supersession failure travels with it.
      Object.defineProperty(timeout, 'errors', {
        value: Object.freeze([secondary]),
        enumerable: true,
        configurable: true
      })
    }
    throw timeout
  }

  /** Rejects a settled hook that no longer owns current commit authority. */
  assertCurrent(registration: IPluginHostOperationRegistration): void {
    const operation = registration.operation
    if (this.#options.isHostOpen() && operation && this.#controller.isCurrent(operation.token))
      return
    if (!this.#options.isHostOpen())
      throw new PluginHostError(PluginHostErrorCode.hostDisposing, ERROR_TEXT.HOST_DISPOSING)
    throw this.#createTimeoutError()
  }

  /** Tests exact generation authority for install-time core access. */
  isCurrent(request: IGenerationRequest | undefined): boolean {
    return request !== undefined && this.#controller.isCurrent(request.token)
  }

  /** Creates the stable timeout boundary using the configured execution budget. */
  #createTimeoutError(): PluginHostError {
    return new PluginHostError(
      PluginHostErrorCode.mutationExecutionTimeout,
      ERROR_TEXT.MUTATION_EXECUTION_TIMEOUT(this.#options.timeoutMs as number)
    )
  }
}

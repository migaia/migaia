/**
 * Owns one callback's exact lease, cancellation bridge and deferred self mutations; Host owns
 * changes.
 */
import { createAbortController } from '@migaia/lifecycle'
import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { systemScheduler } from '@migaia/utils/scheduler'
import { TrayErrorCode } from '../error-code.ts'
import { TRAY_SOURCE, attachTrayError, createTrayError } from '../errors.ts'
import type { IRuntimeBridge } from '../host/internal-capability.ts'
import type {
  IRuntimeRunContext,
  IRuntimeRunOptions,
  IRuntimeSelfMutation,
  IRuntimeSelfMutationTicket
} from './typing.ts'

/** Non-exported brand distinguishes Runtime tickets without exposing mutation authority. */
const runtimeSelfMutationTicketBrand = Symbol('migaia.tray.runtime.self-mutation-ticket')

/** Runtime-owned tables and bridge shared explicitly with each admitted callback. */
export type IRuntimeRunOwner = Readonly<{
  readonly bridge: IRuntimeBridge
  readonly active: Map<number, ReturnType<typeof createAbortController>>
  readonly inFlight: Set<Promise<unknown>>
  readonly report: (error: unknown) => void
}>

/** One ticket keeps its completion resolvers until the canonical mutation settles. */
type ISelfMutationState = {
  readonly commit: () => Promise<unknown>
  readonly reject: (error: unknown) => void
  readonly resolve: (value: unknown) => void
  settled: boolean
}

/** Commit one ticket after callback settlement, preserving the original async resolution boundary. */
async function settleSelfMutation(state: ISelfMutationState): Promise<void> {
  if (state.settled) return
  state.settled = true
  try {
    state.resolve(await state.commit())
  } catch (error) {
    state.reject(error)
  }
}

/** Keep already classified Tray callback failures intact before attaching a fallback classification. */
function rejectRun(error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    (error as { readonly source?: unknown }).source === TRAY_SOURCE &&
    typeof (error as { readonly code?: unknown }).code === 'string'
  )
    throw error
  throw attachTrayError(error, TrayErrorCode.runtimeExecutionFailed)
}

/** Explicit per-run owner keeps the original synchronous invocation and Promise settlement order. */
export class RuntimeRun {
  /** Shared Runtime tables remain authoritative for admission, shutdown and reporting. */
  readonly #owner: IRuntimeRunOwner
  /** Target name binds the lease and every self mutation to the same plugin. */
  readonly #name: string
  /** Caller options remain live only for the original signal reads and bridge removal. */
  readonly #options: IRuntimeRunOptions
  /** Monotonic identity belongs to the creating Runtime. */
  readonly #id: number
  /** Cooperative controller never settles or releases the callback by itself. */
  readonly #controller: ReturnType<typeof createAbortController>
  /** Scheduler-clock deadline is captured before caller cancellation is bridged. */
  readonly #deadlineAt: number | undefined
  /** The sole deadline task is cancelled on failed admission or real callback settlement. */
  readonly #timeoutTask: ReturnType<typeof systemScheduler.schedule> | undefined
  /** Exact generation lease is held through the callback's actual settlement. */
  #leased!: ReturnType<IRuntimeBridge['acquire']>
  /** The generation is read once while the callback context is assembled, as in the original path. */
  #generation!: object
  /** Deferred self mutations retain their original registration order. */
  readonly #selfStates: ISelfMutationState[] = []
  /**
   * Ticket completion stays guarded until synchronous failure or async finally settles the
   * callback.
   */
  #callbackSettled = false
  /** The exact returned Promise is removed from the Runtime table by its original observer. */
  #completion: Promise<unknown> | undefined

  /** Capture one run's original deadline and caller listener before attempting its generation lease. */
  constructor(
    owner: IRuntimeRunOwner,
    name: string,
    options: IRuntimeRunOptions,
    controller: ReturnType<typeof createAbortController>,
    id: number
  ) {
    this.#owner = owner
    this.#name = name
    this.#options = options
    this.#controller = controller
    this.#id = id
    this.#deadlineAt =
      options.timeoutMs === false ? undefined : systemScheduler.now() + options.timeoutMs
    this.#timeoutTask =
      options.timeoutMs === false
        ? undefined
        : systemScheduler.schedule(() => this.#controller.abort(), options.timeoutMs)
    options.signal?.addEventListener('abort', this.#onAbort, { once: true })
    if (options.signal?.aborted) this.#onAbort()
  }

  /** Forward the caller's current reason only while its original listener remains registered. */
  #onAbort = (): void => this.#controller.abort(this.#options.signal?.reason)

  /** Invoke once under the exact lease; retain the original then/finally/observer Promise chain. */
  run<TResult>(
    execute: (context: IRuntimeRunContext) => TResult | PromiseLike<TResult>
  ): Promise<TResult> {
    try {
      this.#leased = this.#owner.bridge.acquire(this.#name)
    } catch (error) {
      this.#timeoutTask?.cancel()
      this.#owner.report(error)
      this.#options.signal?.removeEventListener('abort', this.#onAbort)
      return Promise.reject(attachTrayError(error, TrayErrorCode.runtimeAborted) as Error)
    }
    this.#owner.active.set(this.#id, this.#controller)
    this.#owner.bridge.beginRun?.(this.#name)
    /** Preserve callback return identity until the single thenable probe. */
    let result: TResult | PromiseLike<TResult>
    this.#owner.bridge.enterCallback?.(this.#name)
    try {
      result = execute({
        runId: this.#id,
        plugin: this.#name,
        extensions: this.#leased.extensions,
        signal: this.#controller.signal,
        deadlineAt: this.#deadlineAt,
        self: this.#selfCapability()
      })
    } catch (error) {
      this.#owner.bridge.exitCallback?.(this.#name)
      this.#callbackSettled = true
      this.#release()
      return Promise.reject(attachTrayError(error, TrayErrorCode.runtimeExecutionFailed) as Error)
    }
    /** Capture a foreign then method once before exiting the synchronous callback fence. */
    const probe = probeThenable(result)
    this.#owner.bridge.exitCallback?.(this.#name)
    /** Every supported callback completion follows the same original assimilation path. */
    const settled =
      probe.kind === ThenableProbeKind.thenable
        ? assimilateCapturedThen<TResult>(probe.thenFn, result)
        : probe.kind === ThenableProbeKind.failed
          ? Promise.reject(probe.error)
          : Promise.resolve(result)
    /** Keep the exact Promise returned to the caller and registered for strict drain. */
    const completion = settled.then((value) => value, rejectRun).finally(() => this.#release())
    this.#completion = completion
    this.#owner.inFlight.add(completion)
    void completion.then(
      () => this.#forgetCompletion(),
      () => this.#forgetCompletion()
    )
    return completion
  }

  /**
   * Release the exact lease before starting queued self mutations, retaining original cleanup
   * order.
   */
  #release(): void {
    this.#timeoutTask?.cancel()
    this.#callbackSettled = true
    this.#leased.release()
    this.#owner.bridge.endRun?.(this.#name)
    this.#owner.active.delete(this.#id)
    this.#options.signal?.removeEventListener('abort', this.#onAbort)
    for (const ticket of this.#selfStates) void settleSelfMutation(ticket)
  }

  /** Both completion observers remove the same identity; neither changes the returned Promise. */
  #forgetCompletion(): boolean {
    return this.#owner.inFlight.delete(this.#completion!)
  }

  /** Publish only exact-run self mutation methods with their original frozen own-property shape. */
  #selfCapability(): IRuntimeSelfMutation {
    this.#generation = this.#leased.generation
    return Object.freeze({
      unUse: () => this.#ticket(false),
      replace: (plugin) => this.#ticket(true, plugin as object)
    })
  }

  /** Delegate an admitted self-removal to the authenticated Host bridge only after lease release. */
  #commitRemoval(): Promise<unknown> {
    return this.#owner.bridge.selfUnUse
      ? this.#owner.bridge.selfUnUse(this.#name, this.#generation, this.#id)
      : Promise.reject(createTrayError(TrayErrorCode.runtimeContractInvalid))
  }

  /** Delegate the exact replacement proposal without changing canonical Host admission behavior. */
  #commitReplacement(plugin: object): Promise<unknown> {
    return this.#owner.bridge.selfReplace
      ? this.#owner.bridge.selfReplace(this.#name, this.#generation, plugin, this.#id)
      : Promise.reject(createTrayError(TrayErrorCode.runtimeContractInvalid))
  }

  /** Create a removal or replacement ticket, retaining its exact proposal until mutation settlement. */
  #ticket(replace: boolean, plugin?: object): IRuntimeSelfMutationTicket {
    /** The deferred completion is settled only by its matching self-mutation record. */
    let resolveCompletion!: (value: unknown) => void
    /** Mutation failure rejects the same completion Promise instead of an additional wrapper. */
    let rejectCompletion!: (error: unknown) => void
    /** Promise creation remains synchronous with ticket creation. */
    const completion = new Promise<unknown>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = reject
    })
    /** Ordered record is visited only after this run releases its exact lease. */
    const state: ISelfMutationState = {
      commit: replace ? () => this.#commitReplacement(plugin!) : () => this.#commitRemoval(),
      resolve: resolveCompletion,
      reject: rejectCompletion,
      settled: false
    }
    this.#selfStates.push(state)
    return RuntimeRun.#ticketSurface(this, completion)
  }

  /** Construct the original branded frozen ticket with an explicit run and its exact Promise. */
  static #ticketSurface(
    owner: RuntimeRun,
    completion: Promise<unknown>
  ): IRuntimeSelfMutationTicket {
    /** Ticket retains its original getter, brand descriptor and frozen state. */
    const ticketValue = {
      get completion() {
        if (!owner.#callbackSettled)
          return Promise.reject(createTrayError(TrayErrorCode.runtimeContractInvalid))
        return completion
      }
    }
    Object.defineProperty(ticketValue, runtimeSelfMutationTicketBrand, { value: true })
    return Object.freeze(ticketValue)
  }
}

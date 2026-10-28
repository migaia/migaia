import { TrayShutdownMode } from '../state-constants.ts'
import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { createAbortController } from '@migaia/lifecycle'
import { systemScheduler } from '@migaia/utils/scheduler'
import { TrayErrorCode } from '../error-code.ts'
import { TRAY_SOURCE, attachTrayError, createTrayError } from '../errors.ts'
import { readRuntimeBridge } from '../host/internal-capability.ts'
import type {
  ITrayHost,
  ITrayHostTypeInfo,
  ITrayHostReadyPlugins,
  ITrayHostSourceOf
} from '../host/typing.ts'
import type {
  IRuntime,
  IRuntimeDisposalResult,
  IRuntimeRunContext,
  IRuntimeRunOptions,
  IRuntimeSelfMutation,
  IRuntimeSelfMutationTicket,
  IRuntimeShutdownOptions
} from './typing.ts'

/** Non-exported brand distinguishing Runtime tickets from caller-shaped lookalikes. */
const runtimeSelfMutationTicketBrand = Symbol('migaia.tray.runtime.self-mutation-ticket')

/** Internal completion state for one callback-created self-mutation ticket. */
type ISelfMutationState = {
  readonly commit: () => Promise<unknown>
  readonly reject: (error: unknown) => void
  readonly resolve: (value: unknown) => void
  settled: boolean
}

/** Commits one queued self mutation after its originating callback has settled. */
async function settleSelfMutation(state: ISelfMutationState): Promise<void> {
  if (state.settled) return
  state.settled = true
  try {
    state.resolve(await state.commit())
  } catch (error) {
    state.reject(error)
  }
}

/** Creates one callback-scoped capability without exposing Host or Graph internals. */
function createSelfMutationCapability(
  runId: number,
  name: string,
  generation: object,
  bridge: ReturnType<typeof readRuntimeBridge>,
  states: ISelfMutationState[],
  isCallbackSettled: () => boolean
): IRuntimeSelfMutation {
  const ticket = (commit: () => Promise<unknown>): IRuntimeSelfMutationTicket => {
    let resolveCompletion!: (value: unknown) => void
    let rejectCompletion!: (error: unknown) => void
    const completion = new Promise<unknown>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = reject
    })
    const state: ISelfMutationState = {
      commit,
      resolve: resolveCompletion,
      reject: rejectCompletion,
      settled: false
    }
    states.push(state)
    const ticketValue = {
      get completion() {
        if (!isCallbackSettled())
          return Promise.reject(createTrayError(TrayErrorCode.runtimeContractInvalid))
        return completion
      }
    }
    Object.defineProperty(ticketValue, runtimeSelfMutationTicketBrand, { value: true })
    return Object.freeze(ticketValue)
  }
  return Object.freeze({
    unUse: () =>
      ticket(() =>
        bridge?.selfUnUse
          ? bridge.selfUnUse(name, generation, runId)
          : Promise.reject(createTrayError(TrayErrorCode.runtimeContractInvalid))
      ),
    replace: (plugin) =>
      ticket(() =>
        bridge?.selfReplace
          ? bridge.selfReplace(name, generation, plugin as object, runId)
          : Promise.reject(createTrayError(TrayErrorCode.runtimeContractInvalid))
      )
  })
}

/**
 * Borrows a managed Host for exact-generation callback execution. options defaults to an empty
 * object, shutdown.mode to strict-drain, and report to no observer. A foreign Host rejects with
 * RUNTIME_CONTRACT_INVALID. run() retains its lease until real callback settlement; cancellation
 * only aborts the context signal. Disposing this Runtime closes its admission without disposing
 * Host.
 */
export function createRuntime<
  THost extends ITrayHostTypeInfo & Pick<ITrayHost<any, any, any>, 'on'>
>(
  host: THost,
  options: Readonly<{
    readonly shutdown?: IRuntimeShutdownOptions
    readonly report?: (error: unknown) => void
  }> = {}
): IRuntime<ITrayHostReadyPlugins<THost>, ITrayHostSourceOf<THost>> {
  return new RuntimeOwner(host, options).runtime as IRuntime<
    ITrayHostReadyPlugins<THost>,
    ITrayHostSourceOf<THost>
  >
}
/** Exact-generation run owner borrows Host leases and never duplicates Host lifecycle. */
class RuntimeOwner {
  /** Original managed Host is borrowed, never disposed by Runtime. */
  readonly #host: Pick<ITrayHost<any, any, any>, 'on'>
  /** Cold shutdown/report policy remains unchanged for this Runtime. */
  readonly #options: Readonly<{
    shutdown?: IRuntimeShutdownOptions
    report?: (error: unknown) => void
  }>
  /** Authenticated internal bridge retains exact generation and callback admission authority. */
  #bridge: NonNullable<ReturnType<typeof readRuntimeBridge>>
  /** Selected shutdown policy controls only this Runtime's wait behavior. */
  #shutdown: IRuntimeShutdownOptions
  /** Cooperative abort controllers track admitted callbacks until true settlement. */
  #active: Map<number, ReturnType<typeof createAbortController>>
  /** Strict drain joins the original completion Promises without recreating them. */
  #inFlight: Set<Promise<unknown>>
  /** Runtime admission closes independently of the borrowed Host's lifetime. */
  #state: 'active' | 'closing' | 'terminal'
  /** Every admitted callback consumes one monotonic run identity. */
  #runId: number
  /** Concurrent dispose callers share exactly one original Promise. */
  #disposal: Promise<IRuntimeDisposalResult> | undefined
  /** Original Host lifecycle observer is released when Runtime ends. */
  #unsubscribe: () => void
  /** Public object keeps its original own getters and bound methods. */
  #runtime: IRuntime
  /** Validate original Host provenance before registering any observer or accepting work. */
  constructor(
    host: Pick<ITrayHost<any, any, any>, 'on'>,
    options: Readonly<{ shutdown?: IRuntimeShutdownOptions; report?: (error: unknown) => void }>
  ) {
    this.#host = host
    this.#options = options
    if (!this.#host || typeof this.#host !== 'object')
      throw createTrayError(TrayErrorCode.runtimeContractInvalid)
    this.#bridge = readRuntimeBridge(this.#host as object)!
    if (!this.#bridge) throw createTrayError(TrayErrorCode.runtimeContractInvalid)
    this.#shutdown = this.#options.shutdown ?? { mode: TrayShutdownMode['strict-drain'] }
    this.#active = new Map<number, ReturnType<typeof createAbortController>>()
    this.#inFlight = new Set<Promise<unknown>>()
    this.#state = 'active'
    this.#runId = 0
    this.#disposal = undefined
    this.#unsubscribe = this.#host.on('disposing', () => {
      this.#state = this.#state === 'active' ? 'closing' : this.#state
      for (const controller of this.#active.values()) controller.abort()
    })
    this.#runtime = this.#surface() as unknown as IRuntime
  }
  /** Reporter failures remain observer-only, preserving the original containment boundary. */
  #report = (error: unknown): void => {
    try {
      this.#options.report?.(error)
    } catch {
      // Reporter failures remain observer-only.
    }
  }
  /** Acquire one exact generation lease and retain it until real callback settlement. */
  #runEntry = <TName extends string, TResult>(
    name: TName,
    runOptions: IRuntimeRunOptions,
    execute: (context: IRuntimeRunContext) => TResult | PromiseLike<TResult>
  ): Promise<TResult> => {
    if (this.#state !== 'active')
      return Promise.reject(createTrayError(TrayErrorCode.runtimeDisposed))
    if (
      !runOptions ||
      (runOptions.timeoutMs !== false &&
        (typeof runOptions.timeoutMs !== 'number' ||
          !Number.isFinite(runOptions.timeoutMs) ||
          runOptions.timeoutMs < 0)) ||
      typeof execute !== 'function'
    )
      return Promise.reject(createTrayError(TrayErrorCode.runtimeContractInvalid))
    const controller = createAbortController()
    const id = ++this.#runId
    const deadlineAt =
      runOptions.timeoutMs === false ? undefined : systemScheduler.now() + runOptions.timeoutMs
    const timeoutTask =
      runOptions.timeoutMs === false
        ? undefined
        : systemScheduler.schedule(() => controller.abort(), runOptions.timeoutMs)
    const onAbort = (): void => controller.abort(runOptions.signal?.reason)
    runOptions.signal?.addEventListener('abort', onAbort, { once: true })
    if (runOptions.signal?.aborted) onAbort()
    let leased: ReturnType<NonNullable<ReturnType<typeof readRuntimeBridge>>['acquire']>
    try {
      leased = this.#bridge.acquire(name)
    } catch (error) {
      timeoutTask?.cancel()
      this.#report(error)
      runOptions.signal?.removeEventListener('abort', onAbort)
      return Promise.reject(attachTrayError(error, TrayErrorCode.runtimeAborted) as Error)
    }
    this.#active.set(id, controller)
    this.#bridge.beginRun?.(name)
    let result: TResult | PromiseLike<TResult>
    const selfStates: ISelfMutationState[] = []
    let callbackSettled = false
    this.#bridge.enterCallback?.(name)
    try {
      result = execute({
        runId: id,
        plugin: name,
        extensions: leased.extensions,
        signal: controller.signal,
        deadlineAt,
        self: createSelfMutationCapability(
          id,
          name,
          leased.generation,
          this.#bridge,
          selfStates,
          () => callbackSettled
        )
      })
    } catch (error) {
      this.#bridge.exitCallback?.(name)
      callbackSettled = true
      timeoutTask?.cancel()
      leased.release()
      this.#bridge.endRun?.(name)
      this.#active.delete(id)
      runOptions.signal?.removeEventListener('abort', onAbort)
      for (const ticket of selfStates) void settleSelfMutation(ticket)
      return Promise.reject(attachTrayError(error, TrayErrorCode.runtimeExecutionFailed) as Error)
    }
    const probe = probeThenable(result)
    this.#bridge.exitCallback?.(name)
    const settled =
      probe.kind === ThenableProbeKind.thenable
        ? assimilateCapturedThen<TResult>(probe.thenFn, result)
        : probe.kind === ThenableProbeKind.failed
          ? Promise.reject(probe.error)
          : Promise.resolve(result)
    const completion = settled
      .then(
        (value) => value,
        (error) => {
          if (
            error &&
            typeof error === 'object' &&
            (error as { readonly source?: unknown }).source === TRAY_SOURCE &&
            typeof (error as { readonly code?: unknown }).code === 'string'
          )
            throw error
          throw attachTrayError(error, TrayErrorCode.runtimeExecutionFailed)
        }
      )
      .finally(() => {
        timeoutTask?.cancel()
        callbackSettled = true
        leased.release()
        this.#bridge.endRun?.(name)
        this.#active.delete(id)
        runOptions.signal?.removeEventListener('abort', onAbort)
        for (const ticket of selfStates) void settleSelfMutation(ticket)
      })
    this.#inFlight.add(completion)
    void completion.then(
      () => this.#inFlight.delete(completion),
      () => this.#inFlight.delete(completion)
    )
    return completion
  }
  /** Close Runtime admission once, abort cooperative signals and join strict-drain callbacks. */
  #disposeEntry = (): Promise<IRuntimeDisposalResult> => {
    if (this.#disposal) return this.#disposal
    this.#state = 'closing'
    for (const controller of this.#active.values()) controller.abort()
    this.#disposal = (async () => {
      try {
        if (this.#shutdown.mode === TrayShutdownMode['strict-drain']) {
          await Promise.all(
            [...this.#inFlight].map(async (pending) => {
              try {
                await pending
              } catch (error) {
                this.#report(error)
              }
            })
          )
        }
        return Object.freeze({
          state: 'terminal' as const,
          cleanupComplete: this.#active.size === 0
        })
      } finally {
        this.#unsubscribe()
        this.#state = 'terminal'
      }
    })()
    return this.#disposal
  }
  /** Await the shared Runtime disposal result while discarding its observation value. */
  #asyncDisposeEntry = () => {
    return this.#runtime.dispose().then(() => undefined)
  }
  /** Assemble the original callable surface while all mutable state remains explicit. */
  #surface() {
    const readState = () => this.#state
    const readActiveRuns = () => this.#active.size
    return {
      get state() {
        return readState()
      },
      get activeRuns() {
        return readActiveRuns()
      },
      run: this.#runEntry,
      dispose: this.#disposeEntry,
      [Symbol.asyncDispose]: this.#asyncDisposeEntry
    }
  }
  /** Public facade never exposes the borrowed Host or internal bridge. */
  get runtime() {
    return this.#runtime
  }
}

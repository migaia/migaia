/** Owns Runtime admission, shared disposal and public projection; individual runs own their leases. */
import { RuntimeState, TrayShutdownMode } from '../state-constants.ts'
import { createAbortController } from '@migaia/lifecycle'
import { TrayErrorCode } from '../error-code.ts'
import { createTrayError } from '../errors.ts'
import { readRuntimeBridge } from '../host/internal-capability.ts'
import { ManagedHostEvent } from '../host/constants.ts'
import { RuntimeRun, type IRuntimeRunOwner } from './run.ts'
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
  IRuntimeShutdownOptions
} from './typing.ts'

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
  /** Explicit shared context keeps individual runs on this Runtime's original admission tables. */
  #runOwner: IRuntimeRunOwner
  /** Runtime admission closes independently of the borrowed Host's lifetime. */
  #state: RuntimeState
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
    this.#runOwner = {
      bridge: this.#bridge,
      active: this.#active,
      inFlight: this.#inFlight,
      report: this.#report
    }
    this.#state = RuntimeState.active
    this.#runId = 0
    this.#disposal = undefined
    this.#unsubscribe = this.#host.on(ManagedHostEvent.disposing, () => {
      this.#state = this.#state === RuntimeState.active ? RuntimeState.closing : this.#state
      for (const controller of this.#active.values()) controller.abort()
    })
    this.#runtime = RuntimeOwner.#surface(this) as unknown as IRuntime
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
    if (this.#state !== RuntimeState.active)
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
    /** Controller creation precedes consuming the monotonic run identity as before. */
    const controller = createAbortController()
    /** Admission failures still consume the same run identity. */
    const id = ++this.#runId
    return new RuntimeRun(this.#runOwner, name, runOptions, controller, id).run(execute)
  }
  /** Close Runtime admission once, abort cooperative signals and join strict-drain callbacks. */
  #disposeEntry = (): Promise<IRuntimeDisposalResult> => {
    if (this.#disposal) return this.#disposal
    this.#state = RuntimeState.closing
    for (const controller of this.#active.values()) controller.abort()
    this.#disposal = this.#disposeRuns()
    return this.#disposal
  }
  /** Preserve the original async drain boundary and report failures before terminal projection. */
  async #disposeRuns(): Promise<IRuntimeDisposalResult> {
    try {
      if (this.#shutdown.mode === TrayShutdownMode['strict-drain']) {
        await Promise.all([...this.#inFlight].map((pending) => this.#drainRun(pending)))
      }
      return Object.freeze({
        state: RuntimeState.terminal,
        cleanupComplete: this.#active.size === 0
      })
    } finally {
      this.#unsubscribe()
      this.#state = RuntimeState.terminal
    }
  }
  /** Observe one pending callback with the original async catch-and-report settlement shape. */
  async #drainRun(pending: Promise<unknown>): Promise<void> {
    try {
      await pending
    } catch (error) {
      this.#report(error)
    }
  }
  /** Await the shared Runtime disposal result while discarding its observation value. */
  #asyncDisposeEntry = () => {
    return this.#runtime.dispose().then(() => undefined)
  }
  /** Assemble the original own-property surface from its explicit owner without aliasing this. */
  static #surface(owner: RuntimeOwner) {
    return {
      get state() {
        return owner.#state
      },
      get activeRuns() {
        return owner.#active.size
      },
      run: owner.#runEntry,
      dispose: owner.#disposeEntry,
      [Symbol.asyncDispose]: owner.#asyncDisposeEntry
    }
  }
  /** Public facade never exposes the borrowed Host or internal bridge. */
  get runtime() {
    return this.#runtime
  }
}

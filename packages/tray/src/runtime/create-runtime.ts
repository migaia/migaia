import {
  assimilateCapturedThen,
  createAbortController,
  probeThenable,
  systemScheduler,
  ThenableProbeKind
} from '@migaia/lifecycle'
import { TrayErrorCode } from '../error-code.js'
import { attachTrayError, createTrayError } from '../errors.js'
import { readRuntimeBridge } from '../host/internal-capability.js'
import type { ITrayHost, ITrayPluginConstraint } from '../host/typing.js'
import type { PluginHost } from '@migaia/plugin-host'
import type {
  IRuntime,
  IRuntimeDisposalResult,
  IRuntimeRunContext,
  IRuntimeRunOptions,
  IRuntimeSelfMutation,
  IRuntimeSelfMutationTicket,
  IRuntimeShutdownOptions
} from './typing.js'

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

/** Creates an exact-generation Runtime that never owns or disposes the managed Host. */
export function createRuntime<
  THost extends PluginHost<any, any, any>,
  TDefinitions extends readonly ITrayPluginConstraint<THost>[],
  TReady extends readonly ITrayPluginConstraint<THost>[]
>(
  host: ITrayHost<THost, TDefinitions, TReady>,
  options: Readonly<{
    readonly shutdown?: IRuntimeShutdownOptions
    readonly report?: (error: unknown) => void
  }> = {}
): IRuntime<TReady> {
  if (!host || typeof host !== 'object') throw createTrayError(TrayErrorCode.runtimeContractInvalid)
  const bridge = readRuntimeBridge(host as object)
  if (!bridge) throw createTrayError(TrayErrorCode.runtimeContractInvalid)
  const shutdown = options.shutdown ?? { mode: 'strict-drain' as const }
  const active = new Map<number, ReturnType<typeof createAbortController>>()
  const inFlight = new Set<Promise<unknown>>()
  let state: 'active' | 'closing' | 'terminal' = 'active'
  let runId = 0
  let disposal: Promise<IRuntimeDisposalResult> | undefined
  const report = (error: unknown): void => {
    try {
      options.report?.(error)
    } catch {
      // Reporter failures remain observer-only.
    }
  }
  const unsubscribe = host.on('disposing', () => {
    state = state === 'active' ? 'closing' : state
    for (const controller of active.values()) controller.abort()
  })
  const runtime = {
    get state() {
      return state
    },
    get activeRuns() {
      return active.size
    },
    run<TName extends string, TResult>(
      name: TName,
      runOptions: IRuntimeRunOptions,
      execute: (context: IRuntimeRunContext) => TResult | PromiseLike<TResult>
    ): Promise<TResult> {
      if (state !== 'active') return Promise.reject(createTrayError(TrayErrorCode.runtimeDisposed))
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
      const id = ++runId
      const deadlineAt =
        runOptions.timeoutMs === false ? undefined : systemScheduler.now() + runOptions.timeoutMs
      const timeoutTask =
        runOptions.timeoutMs === false
          ? undefined
          : systemScheduler.schedule(() => controller.abort(), runOptions.timeoutMs)
      const onAbort = (): void => controller.abort(runOptions.signal?.reason)
      runOptions.signal?.addEventListener('abort', onAbort, { once: true })
      if (runOptions.signal?.aborted) onAbort()
      let leased: ReturnType<typeof bridge.acquire>
      try {
        leased = bridge.acquire(name)
      } catch (error) {
        report(error)
        runOptions.signal?.removeEventListener('abort', onAbort)
        return Promise.reject(attachTrayError(error, TrayErrorCode.runtimeAborted) as Error)
      }
      active.set(id, controller)
      bridge.beginRun?.(name)
      let result: TResult | PromiseLike<TResult>
      const selfStates: ISelfMutationState[] = []
      let callbackSettled = false
      bridge.enterCallback?.(name)
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
            bridge,
            selfStates,
            () => callbackSettled
          )
        })
      } catch (error) {
        bridge.exitCallback?.(name)
        callbackSettled = true
        timeoutTask?.cancel()
        leased.release()
        bridge.endRun?.(name)
        active.delete(id)
        runOptions.signal?.removeEventListener('abort', onAbort)
        for (const ticket of selfStates) void settleSelfMutation(ticket)
        return Promise.reject(attachTrayError(error, TrayErrorCode.runtimeExecutionFailed) as Error)
      }
      const probe = probeThenable(result)
      bridge.exitCallback?.(name)
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
              (error as { readonly source?: unknown }).source === '@migaia/tray' &&
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
          bridge.endRun?.(name)
          active.delete(id)
          runOptions.signal?.removeEventListener('abort', onAbort)
          for (const ticket of selfStates) void settleSelfMutation(ticket)
        })
      inFlight.add(completion)
      void completion.then(
        () => inFlight.delete(completion),
        () => inFlight.delete(completion)
      )
      return completion
    },
    dispose(): Promise<IRuntimeDisposalResult> {
      if (disposal) return disposal
      state = 'closing'
      for (const controller of active.values()) controller.abort()
      disposal = (async () => {
        try {
          if (shutdown.mode === 'strict-drain') {
            await Promise.all(
              [...inFlight].map(async (pending) => {
                try {
                  await pending
                } catch (error) {
                  report(error)
                }
              })
            )
          }
          return Object.freeze({ state: 'terminal' as const, cleanupComplete: active.size === 0 })
        } finally {
          unsubscribe()
          state = 'terminal'
        }
      })()
      return disposal
    },
    [Symbol.asyncDispose]() {
      return runtime.dispose().then(() => undefined)
    }
  }
  return runtime as unknown as IRuntime<TReady>
}

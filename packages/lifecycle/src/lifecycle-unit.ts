import type { ILifecycleState, IUnitState } from './types.js'
import {
  assimilateCapturedThen,
  containAsyncRejection,
  createLifecycleError,
  probeThenable
} from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { createTerminalController } from './terminal-controller.js'
import { LifecycleState, LifecycleUnitState, ThenableProbeKind } from './state-constants.js'
import { createGenerationController } from './generation-controller.js'

export type ILifecycleUnitOptions = {
  /**
   * Diagnostic channel for a failed `start()`, tagged `UNIT_START_FAILED` with the original failure
   * on `cause`. `unit.error` itself always stays the caller's raw, untagged value — this is a side
   * channel for callers that want a `(source, code)`-bearing signal without losing that identity.
   */
  readonly report?: (error: unknown) => void
}

export type ILifecycleUnit<T> = {
  readonly state: IUnitState
  /**
   * The container-survival axis for the unit itself (separate from `state`) — `close()`/`dispose()`
   * move this one.
   */
  readonly lifecycle: ILifecycleState
  readonly value: T | undefined
  readonly error: unknown
  /**
   * Runtime-probes `factory()`'s return: a synchronous non-thenable value commits to `loaded`
   * immediately, without ever passing through `loading` (L-T5, D-2). A thenable commits to
   * `loading` and transitions on settle — but only if this call's generation is still current; a
   * superseded generation's late result is discarded silently (§4.2, L-T34).
   */
  start(factory: () => T | PromiseLike<T>): void
  /** Alias for `start()` — same behavior, named for the "retry after `failed`" call site (L-T34). */
  restart(factory: () => T | PromiseLike<T>): void
  close(): void
  /** Synchronous — a unit owns no user resource to await releasing, only its own bookkeeping. */
  dispose(): void
}

export function createLifecycleUnit<T>(options: ILifecycleUnitOptions = {}): ILifecycleUnit<T> {
  const terminal = createTerminalController()
  const generations = createGenerationController()
  let state: IUnitState = LifecycleUnitState.idle
  let value: T | undefined
  let error: unknown

  const reportStartFailed = (rawError: unknown): void => {
    if (!options.report) return
    const tagged = createLifecycleError(
      LifecycleErrorCode.unitStartFailed,
      '[lifecycle] start() failed',
      {
        cause: rawError
      }
    )
    try {
      const result: unknown = options.report(tagged)
      containAsyncRejection(result, () => {
        // No lower layer to escalate a reporter's own async failure to.
      })
    } catch {
      // The reporter is the last error boundary for its own synchronous failures too.
    }
  }

  const assertOpen = (): void => {
    if (terminal.lifecycle === LifecycleState.terminal) {
      throw createLifecycleError(LifecycleErrorCode.scopeTerminal, '[lifecycle] unit is terminal')
    }
    if (terminal.lifecycle === LifecycleState.closing) {
      throw createLifecycleError(LifecycleErrorCode.scopeClosed, '[lifecycle] unit is closing')
    }
  }

  const start = (factory: () => T | PromiseLike<T>): void => {
    assertOpen()
    const request = generations.begin()
    let result: T | PromiseLike<T>
    try {
      result = factory()
    } catch (thrown) {
      // Nothing could have superseded this generation yet — it just began, synchronously, on this
      // same call stack — so committing unconditionally is correct.
      state = LifecycleUnitState.failed
      error = thrown
      value = undefined
      reportStartFailed(thrown)
      return
    }
    // Single `.then` probe: a hostile/stateful getter must be read exactly once (L-T5 / §3). The
    // captured `then` is applied directly, so we never hand the value back to `Promise.resolve()` to
    // read `.then` a second time.
    const probe = probeThenable(result)
    if (probe.kind === 'not-thenable') {
      state = 'loaded'
      value = result as T
      error = undefined
      return
    }
    if (probe.kind === ThenableProbeKind.failed) {
      state = LifecycleUnitState.failed
      error = probe.error
      value = undefined
      reportStartFailed(probe.error)
      return
    }
    state = LifecycleUnitState.loading
    assimilateCapturedThen<T>(probe.thenFn, result).then(
      (settled) => {
        if (!generations.isCurrent(request.token)) return // superseded — discard (L-T34)
        state = LifecycleUnitState.loaded
        value = settled
        error = undefined
      },
      (rejected: unknown) => {
        if (!generations.isCurrent(request.token)) return
        state = LifecycleUnitState.failed
        error = rejected
        value = undefined
        reportStartFailed(rejected)
      }
    )
  }

  return {
    get state() {
      return state
    },
    get lifecycle() {
      return terminal.lifecycle
    },
    get value() {
      return value
    },
    get error() {
      return error
    },
    start,
    restart: start,
    close() {
      terminal.close()
    },
    dispose() {
      if (terminal.lifecycle === LifecycleState.terminal) return
      terminal.close()
      generations.dispose('unit disposed')
      terminal.forceTerminal()
    }
  }
}

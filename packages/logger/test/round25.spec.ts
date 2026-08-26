import { describe, expect, it, vi } from 'vitest'
import { Logger } from '../src/index.js'
import { LoggerErrorCode, LOGGER_SOURCE } from '../src/errors.js'
import { http } from '../src/plugins/http.js'
import { setLoggerRuntimeManager } from '../src/runtime-manager.js'

type IAbortRegistrationMode =
  | 'stored-then-throw'
  | 'callback-then-throw'
  | 'already-aborted'
  | 'wait-stored-then-throw'

type IAbortHarness = {
  readonly Controller: typeof AbortController
  readonly state: {
    readonly adds: number
    readonly aborts: number
    readonly liveListeners: ReadonlySet<() => void>
    readonly removes: number
  }
  readonly restore: () => void
}

/**
 * Installs a hostile shutdown AbortController whose registration can partially commit before
 * throwing. The harness exposes listener ownership and request-controller abort state without
 * changing native error identity.
 */
function installAbortHarness(
  mode: IAbortRegistrationMode,
  registrationError: Error,
  removalError?: Error
): IAbortHarness {
  const originalAbortController = globalThis.AbortController
  const state = {
    adds: 0,
    aborts: 0,
    liveListeners: new Set<() => void>(),
    removes: 0
  }
  const controllers: unknown[] = []

  class HostileAbortController {
    /** Mutable signal state shared by the exposed signal and controller abort method. */
    #signalState: { aborted: boolean; reason: unknown }
    #listeners = new Set<() => void>()
    readonly signal: AbortSignal

    /** Creates one shutdown or request controller with the selected hostile registration mode. */
    constructor() {
      const signalState = {
        aborted: mode === 'already-aborted' && controllers.length === 0,
        reason:
          mode === 'already-aborted' && controllers.length === 0
            ? new Error('round25-already-aborted')
            : undefined
      }
      this.#signalState = signalState
      controllers.push(this)
      this.signal = {
        get aborted(): boolean {
          return signalState.aborted
        },
        get reason(): unknown {
          return signalState.reason
        },
        addEventListener: (
          _type: string,
          listener: EventListenerOrEventListenerObject,
          _options?: AddEventListenerOptions | boolean
        ): void => {
          const callback = listener as () => void
          state.adds += 1
          this.#listeners.add(callback)
          state.liveListeners.add(callback)
          if (controllers[0] !== this) return
          if (mode === 'stored-then-throw') throw registrationError
          if (mode === 'wait-stored-then-throw' && state.adds === 2) throw registrationError
          if (mode === 'callback-then-throw') {
            callback()
            throw registrationError
          }
        },
        removeEventListener: (
          _type: string,
          listener: EventListenerOrEventListenerObject,
          _options?: EventListenerOptions | boolean
        ): void => {
          state.removes += 1
          state.liveListeners.delete(listener as () => void)
          this.#listeners.delete(listener as () => void)
          if (removalError) throw removalError
        }
      } as AbortSignal
    }

    /** Aborts this controller and records every request-controller abort attempt. */
    abort(reason?: unknown): void {
      state.aborts += 1
      if (this.#signalState.aborted) return
      this.#signalState.aborted = true
      this.#signalState.reason = reason
      for (const listener of this.#listeners) listener()
    }
  }

  vi.stubGlobal('AbortController', HostileAbortController)
  return {
    Controller: HostileAbortController,
    state,
    restore: () => vi.stubGlobal('AbortController', originalAbortController)
  }
}

/** Builds a logger scheduler that records accidental request timer admission. */
function createScheduler(): {
  readonly schedule: ReturnType<
    typeof vi.fn<(callback: () => void, delayMs: number) => { cancel: () => void }>
  >
  readonly now: () => number
} {
  const schedule = vi.fn((_callback: () => void, _delayMs: number): { cancel: () => void } => ({
    cancel: () => undefined
  }))
  return { now: () => 0, schedule }
}

/** Runs one hostile registration scenario through both flush and shutdown settlement. */
async function runScenario(
  mode: IAbortRegistrationMode,
  registrationError: Error,
  removalError?: Error,
  rejectFetch = false
): Promise<{
  readonly failures: readonly unknown[]
  readonly fetch: ReturnType<typeof vi.fn>
  readonly harness: IAbortHarness
  readonly scheduler: ReturnType<typeof createScheduler>
  readonly unhandled: readonly unknown[]
}> {
  const harness = installAbortHarness(mode, registrationError, removalError)
  const scheduler = createScheduler()
  const fetch = vi.fn(async () => {
    if (rejectFetch) throw new Error('round25-backoff-transport')
    return { ok: true, status: 200, headers: { get: () => null } }
  })
  const failures: unknown[] = []
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }
  const restoreRuntime = setLoggerRuntimeManager({
    randomUUID: () => `round25-${mode}`,
    defer: (task) => {
      task()
    },
    write: () => undefined,
    fetch
  })
  process.on('unhandledRejection', onUnhandled)

  try {
    const logger = new Logger({
      scheduler,
      plugins: [http({ url: 'https://example.test/logs', retries: 2 })]
    })
    logger.onFailure(({ error }) => failures.push(error))
    logger.log('info', `round25-${mode}`)
    const flush = logger.flush()
    await expect(flush).resolves.toBeUndefined()
    const shutdown = logger.shutdown('manual')
    await expect(shutdown).resolves.toBeUndefined()
  } finally {
    await Promise.resolve()
    process.off('unhandledRejection', onUnhandled)
    restoreRuntime()
    harness.restore()
  }
  return { failures, fetch, harness, scheduler, unhandled }
}

describe('Round25 HTTP abort-listener partial registration', () => {
  it('LG-T32 cleans a stored listener when registration throws before callback', async () => {
    const registrationError = new Error('round25-stored-registration')
    const result = await runScenario('stored-then-throw', registrationError)

    expect(result.fetch).not.toHaveBeenCalled()
    expect(result.scheduler.schedule).not.toHaveBeenCalledWith(expect.any(Function), 10000)
    expect(result.harness.state).toMatchObject({ adds: 1, removes: 1 })
    expect(result.harness.state.liveListeners).toHaveLength(0)
    expect(result.harness.state.aborts).toBeGreaterThanOrEqual(1)
    expect(result.failures[0]).toMatchObject({
      source: LOGGER_SOURCE,
      code: LoggerErrorCode.deliveryFailed,
      cause: registrationError
    })
    expect(result.unhandled).toEqual([])
  })

  it('LG-T33 preserves callback-then-throw registration failure and removes once', async () => {
    const registrationError = new Error('round25-callback-registration')
    const result = await runScenario('callback-then-throw', registrationError)

    expect(result.fetch).not.toHaveBeenCalled()
    expect(result.scheduler.schedule).not.toHaveBeenCalledWith(expect.any(Function), 10000)
    expect(result.harness.state).toMatchObject({ adds: 1, removes: 1 })
    expect(result.harness.state.liveListeners).toHaveLength(0)
    expect(result.failures[0]).toMatchObject({
      source: LOGGER_SOURCE,
      code: LoggerErrorCode.deliveryFailed,
      cause: registrationError
    })
    expect(result.unhandled).toEqual([])
  })

  it('LG-T34 retains registration primary when listener removal throws', async () => {
    const registrationError = new Error('round25-registration-primary')
    const removalError = new Error('round25-removal-cleanup')
    const result = await runScenario('stored-then-throw', registrationError, removalError)
    const failure = result.failures[0] as AggregateError & { readonly code?: string }

    expect(result.fetch).not.toHaveBeenCalled()
    expect(result.harness.state).toMatchObject({ adds: 1, removes: 1 })
    expect(result.harness.state.liveListeners).toHaveLength(0)
    expect(failure).toMatchObject({ source: LOGGER_SOURCE, code: LoggerErrorCode.deliveryFailed })
    expect(failure.errors).toEqual([registrationError, removalError])
    expect(result.unhandled).toEqual([])
  })

  it('LG-T35 aborts fresh request state when shutdown signal is already aborted', async () => {
    const registrationError = new Error('unused-round25-registration-error')
    const result = await runScenario('already-aborted', registrationError)

    expect(result.fetch).not.toHaveBeenCalled()
    expect(result.scheduler.schedule).not.toHaveBeenCalledWith(expect.any(Function), 10000)
    expect(result.harness.state).toMatchObject({ adds: 1, removes: 1 })
    expect(result.harness.state.liveListeners).toHaveLength(0)
    expect(result.harness.state.aborts).toBeGreaterThanOrEqual(1)
    expect(result.unhandled).toEqual([])
  })

  it('LG-T36 cleans every listener across repeat sends without retrying POST', async () => {
    const registrationError = new Error('round25-repeat-registration')
    const harness = installAbortHarness('stored-then-throw', registrationError)
    const scheduler = createScheduler()
    const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }))
    const failures: unknown[] = []
    const restoreRuntime = setLoggerRuntimeManager({
      randomUUID: () => 'round25-repeat',
      defer: (task) => {
        task()
      },
      write: () => undefined,
      fetch
    })
    try {
      const logger = new Logger({
        scheduler,
        plugins: [http({ url: 'https://example.test/logs', retries: 2 })]
      })
      logger.onFailure(({ error }) => failures.push(error))
      logger.log('info', 'round25-repeat-one')
      logger.log('info', 'round25-repeat-two')
      await expect(logger.flush()).resolves.toBeUndefined()
      await expect(logger.shutdown('manual')).resolves.toBeUndefined()
    } finally {
      restoreRuntime()
      harness.restore()
    }

    expect(fetch).not.toHaveBeenCalled()
    expect(scheduler.schedule).not.toHaveBeenCalledWith(expect.any(Function), 10000)
    expect(harness.state).toMatchObject({ adds: 2, removes: 2 })
    expect(harness.state.liveListeners).toHaveLength(0)
    expect(failures).toHaveLength(2)
  })

  it('LG-T37 cleans a partially registered backoff listener before retry can continue', async () => {
    const registrationError = new Error('round25-backoff-registration')
    const result = await runScenario('wait-stored-then-throw', registrationError, undefined, true)

    expect(result.fetch).toHaveBeenCalledOnce()
    expect(result.harness.state).toMatchObject({ adds: 2, removes: 2 })
    expect(result.harness.state.liveListeners).toHaveLength(0)
    expect(result.failures[0]).toMatchObject({
      source: LOGGER_SOURCE,
      code: LoggerErrorCode.deliveryFailed,
      cause: registrationError
    })
    expect(result.unhandled).toEqual([])
  })
})

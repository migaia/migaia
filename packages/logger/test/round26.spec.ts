import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Logger } from '../src/index.js'
import { batch } from '../src/plugins/batch.js'
import { http } from '../src/plugins/http.js'
import { process as processPlugin } from '../src/plugins/process.js'
import { LoggerErrorCode, LOGGER_SOURCE } from '../src/errors.js'
import { setLoggerRuntimeManager } from '../src/runtime-manager.js'
import { installSilentLoggerReporter } from './helpers/silent-runtime.js'

/** Restores the reporter layer installed for the currently running scheduler case. */
let restoreSilentReporter: (() => void) | undefined

beforeEach(() => {
  restoreSilentReporter = installSilentLoggerReporter()
})

afterEach(() => {
  restoreSilentReporter?.()
  restoreSilentReporter = undefined
})

type ITask = { cancel(): void }

type IHttpFetch = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    signal?: AbortSignal
  }
) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null } }>

type ISyncSchedulerOptions = {
  readonly onSchedule?: (callback: () => void, delayMs: number) => void
  readonly task?: ITask | ((delayMs: number) => ITask)
}

/** Builds a scheduler that can fire before returning its independently armed task. */
function createSyncScheduler(options: ISyncSchedulerOptions = {}) {
  const schedules: Array<{ readonly delayMs: number; readonly task: ITask }> = []
  const schedule = vi.fn((callback: () => void, delayMs: number): ITask => {
    options.onSchedule?.(callback, delayMs)
    const task =
      typeof options.task === 'function'
        ? options.task(delayMs)
        : (options.task ?? { cancel: vi.fn(() => undefined) })
    schedules.push({ delayMs, task })
    return task
  })
  return { now: () => 0, schedule, schedules }
}

/** Runs one HTTP sink through logger failure containment and returns observed state. */
async function runHttp(
  scheduler: ReturnType<typeof createSyncScheduler>,
  fetch: IHttpFetch,
  retries = 0
) {
  const failures: unknown[] = []
  const restore = setLoggerRuntimeManager({
    randomUUID: () => 'round26-http',
    defer: (task) => task(),
    write: () => undefined,
    fetch
  })
  try {
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      scheduler,
      plugins: [http({ url: 'https://example.test/logs', retries })]
    })
    logger.onFailure(({ error }) => failures.push(error))
    logger.log('info', 'round26')
    await expect(logger.flush()).resolves.toBeUndefined()
    return { failures, logger }
  } finally {
    restore()
  }
}

describe('Round26 HTTP scheduler callback ownership', () => {
  it('LG-T38 retains and cancels a synchronous request-timeout task after callback return', async () => {
    const scheduler = createSyncScheduler({ onSchedule: (callback) => callback() })
    const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }))

    const result = await runHttp(scheduler, fetch as IHttpFetch, 1)

    expect(fetch).not.toHaveBeenCalled()
    expect(scheduler.schedules.filter(({ delayMs }) => delayMs === 10000)).toHaveLength(1)
    expect(scheduler.schedules[0]?.task.cancel).toHaveBeenCalledOnce()
    expect(result.failures[0]).toMatchObject({
      source: LOGGER_SOURCE,
      code: LoggerErrorCode.deliveryFailed
    })
  })

  it('LG-T39 retains and cancels a synchronous retry-backoff task while allowing the next POST', async () => {
    const scheduler = createSyncScheduler({
      onSchedule: (callback, delayMs) => {
        if (delayMs !== 10000) callback()
      }
    })
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('round26-transport'))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } })

    const result = await runHttp(scheduler, fetch as IHttpFetch, 1)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(scheduler.schedules.filter(({ delayMs }) => delayMs === 200)).toHaveLength(1)
    expect(
      scheduler.schedules.find(({ delayMs }) => delayMs === 200)?.task.cancel
    ).toHaveBeenCalledOnce()
    expect(result.failures).toEqual([])
  })

  it('LG-T40 keeps request callback failure primary and still cancels the returned task once', async () => {
    const callbackFailure = new Error('round26-abort-callback')
    const originalAbortController = globalThis.AbortController
    class CallbackFailureAbortController {
      readonly signal = {
        aborted: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      } as unknown as AbortSignal

      abort(): void {
        throw callbackFailure
      }
    }
    vi.stubGlobal('AbortController', CallbackFailureAbortController)
    const scheduler = createSyncScheduler({ onSchedule: (callback) => callback() })
    const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }))

    try {
      const result = await runHttp(scheduler, fetch as IHttpFetch)

      expect(fetch).not.toHaveBeenCalled()
      expect(scheduler.schedules[0]?.task.cancel).toHaveBeenCalledOnce()
      expect(result.failures[0]).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.deliveryFailed,
        cause: callbackFailure
      })
    } finally {
      vi.stubGlobal('AbortController', originalAbortController)
    }
  })

  it('LG-T41 keeps backoff cancel failure observable and prevents a second POST', async () => {
    const cancelFailure = new Error('round26-backoff-cancel')
    const scheduler = createSyncScheduler({
      onSchedule: (callback, delayMs) => {
        if (delayMs !== 10000) callback()
      },
      task: (delayMs) =>
        delayMs === 200
          ? {
              cancel: () => {
                throw cancelFailure
              }
            }
          : { cancel: () => undefined }
    })
    const fetch = vi.fn().mockRejectedValue(new Error('round26-transport'))

    const result = await runHttp(scheduler, fetch as IHttpFetch, 1)

    expect(fetch).toHaveBeenCalledOnce()
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: LOGGER_SOURCE,
          code: LoggerErrorCode.deliveryFailed
        })
      ])
    )
    expect(result.failures[0]).toBeInstanceOf(AggregateError)
    expect((result.failures[0] as AggregateError).errors).toHaveLength(2)
    expect((result.failures[0] as AggregateError).errors[1]).toMatchObject({
      cause: cancelFailure
    })
  })

  it('LG-T42 keeps schedule throw primary when callback already ran and no handle was returned', async () => {
    const callbackScheduleFailure = new Error('round26-schedule-after-callback')
    const scheduler = createSyncScheduler({
      onSchedule: (callback) => {
        callback()
        throw callbackScheduleFailure
      }
    })
    const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }))

    const result = await runHttp(scheduler, fetch as IHttpFetch, 1)

    expect(fetch).not.toHaveBeenCalled()
    expect(scheduler.schedule).toHaveBeenCalledWith(expect.any(Function), 10000)
    expect(scheduler.schedules).toHaveLength(0)
    expect(result.failures[0]).toMatchObject({
      source: LOGGER_SOURCE,
      code: LoggerErrorCode.deliveryFailed,
      cause: callbackScheduleFailure
    })
  })

  it('LG-T43 contains a task cancel getter failure without leaving the delivery pending', async () => {
    const getterFailure = new Error('round26-cancel-getter')
    const task = {
      get cancel(): never {
        throw getterFailure
      }
    } as unknown as ITask
    const scheduler = createSyncScheduler({
      onSchedule: (callback) => callback(),
      task
    })
    const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }))

    const result = await runHttp(scheduler, fetch as IHttpFetch)

    expect(fetch).not.toHaveBeenCalled()
    expect(result.failures[0]).toMatchObject({
      source: LOGGER_SOURCE,
      code: LoggerErrorCode.deliveryFailed,
      cause: expect.objectContaining({ cause: getterFailure })
    })
  })

  it('LG-T44 rolls back a ProcessPlugin listener stored before runtimeProcess.on throws', async () => {
    const primary = new Error('round26-process-on')
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    let failBeforeExit = true
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void): void => {
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
        if (event === 'beforeExit' && failBeforeExit) {
          failBeforeExit = false
          throw primary
        }
      },
      removeListener: (event: string, listener: (...args: any[]) => void): void => {
        listeners.get(event)?.delete(listener)
      },
      exit: (() => undefined as never) as (code?: number) => never
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'round26-process',
      defer: (task) => task(),
      write: () => undefined
    })

    try {
      let failure: unknown
      try {
        new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          plugins: [processPlugin()]
        })
      } catch (error) {
        failure = error
      }
      expect((failure as Error & { cause?: unknown }).cause).toBe(primary)
      expect([...listeners.values()].every((group) => group.size === 0)).toBe(true)

      const reinstall: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [processPlugin()]
      })
      await reinstall.unUse('process')
      expect([...listeners.values()].every((group) => group.size === 0)).toBe(true)
    } finally {
      restore()
    }
  })

  it('LG-T45 preserves ProcessPlugin install primary plus rollback failure and resets for reinstall', async () => {
    const primary = new Error('round26-process-primary')
    const rollback = new Error('round26-process-rollback')
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    let failBeforeExit = true
    let failRollback = true
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void): void => {
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
        if (event === 'beforeExit' && failBeforeExit) {
          failBeforeExit = false
          throw primary
        }
      },
      removeListener: (event: string, listener: (...args: any[]) => void): void => {
        listeners.get(event)?.delete(listener)
        if (event === 'SIGTERM' && failRollback) {
          failRollback = false
          throw rollback
        }
      },
      exit: (() => undefined as never) as (code?: number) => never
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'round26-process-aggregate',
      defer: (task) => task(),
      write: () => undefined
    })

    try {
      let failure: unknown
      try {
        new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          plugins: [processPlugin()]
        })
      } catch (error) {
        failure = error
      }
      const installFailure = (failure as Error & { cause?: unknown }).cause
      expect(installFailure).toMatchObject({
        source: LOGGER_SOURCE,
        code: 'PROCESS_INSTALL_ROLLBACK_FAILED'
      })
      expect((installFailure as AggregateError).errors).toEqual([primary, rollback])
      expect([...listeners.values()].every((group) => group.size === 0)).toBe(true)

      const reinstall: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [processPlugin()]
      })
      await reinstall.unUse('process')
      expect([...listeners.values()].every((group) => group.size === 0)).toBe(true)
    } finally {
      restore()
    }
  })

  it('LG-T46 cancels a synchronous ProcessPlugin timeout handle after callback return', async () => {
    const scheduler = createSyncScheduler({ onSchedule: (callback) => callback() })
    const listeners = new Map<string, (...args: any[]) => void>()
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void): void => {
        listeners.set(event, listener)
      },
      removeListener: (event: string): void => {
        listeners.delete(event)
      },
      exit: (() => undefined as never) as (code?: number) => never
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'round26-process-timer',
      defer: (task) => task(),
      write: () => undefined
    })

    try {
      const logger: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler,
        plugins: [processPlugin({ shutdownTimeoutMs: 10 })]
      })
      listeners.get('beforeExit')?.()
      await Promise.resolve()
      await Promise.resolve()
      await logger.unUse('process')
      const timeoutTask = scheduler.schedules.find(({ delayMs }) => delayMs === 10)?.task
      expect(timeoutTask?.cancel).toHaveBeenCalledOnce()
    } finally {
      restore()
    }
  })

  it('LG-T47 cancels a synchronous BatchPlugin debounce handle after callback return', async () => {
    const scheduler = createSyncScheduler({ onSchedule: (callback) => callback() })
    const batches: string[][] = []
    const logger: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      scheduler,
      plugins: [batch()]
    })
    const batcher = logger.getShared('createBatcher')(
      { maxSize: 10, maxWaitMs: 5 },
      (items: string[]) => {
        batches.push(items)
      }
    )

    batcher.push('round26-batch')
    await logger.flush()

    expect(batches).toEqual([['round26-batch']])
    const debounceTask = scheduler.schedules.find(({ delayMs }) => delayMs === 5)?.task
    expect(debounceTask?.cancel).toHaveBeenCalledOnce()
    await logger.shutdown('manual')
  })
})

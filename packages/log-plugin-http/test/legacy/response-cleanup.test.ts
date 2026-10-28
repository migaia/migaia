import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { retryFeature, timeoutFeature } from '@migaia/log-host/features'
import type { IScheduler } from '@migaia/utils/scheduler'
import { httpPlugin } from '../../src/index.ts'

/** Preserve the real native signal behavior while making only listener removal hostile. */
const NativeAbortController = globalThis.AbortController

/** Native controllers retain abort/reason semantics and expose one controlled removal failure. */
class RemovalFailureController extends NativeAbortController {
  /** One file-local failure belongs to the currently executing legacy scenario. */
  static failure: Error
  /** The status scenario fails alternating listener removals like its original fixture. */
  static oddOnly = false
  /** The full cleanup call order remains observable without modifying production state. */
  static calls = 0
  /** The original native function must receive its original signal receiver. */
  #remove: AbortSignal['removeEventListener']
  /** Capture a genuine native signal before installing the hostile cleanup boundary. */
  constructor() {
    super()
    this.#remove = this.signal.removeEventListener
    Object.defineProperty(this.signal, 'removeEventListener', {
      configurable: true,
      value: (...args: Parameters<AbortSignal['removeEventListener']>) => this.remove(...args)
    })
  }
  /** Remove the original registration before reporting the exact injected failure. */
  remove(...args: Parameters<AbortSignal['removeEventListener']>): void {
    Reflect.apply(this.#remove, this.signal, args)
    RemovalFailureController.calls++
    if (!RemovalFailureController.oddOnly || RemovalFailureController.calls % 2 === 1)
      throw RemovalFailureController.failure
  }
}

/** Public scheduler injection can fail attempt timer cancellation without changing POST results. */
class CleanupScheduler implements IScheduler {
  /** One exact cancellation failure is supplied to the attempt timeout receipts. */
  #failure: Error
  /** Capture the original cancellation failure for every current request receipt. */
  constructor(failure: Error) {
    this.#failure = failure
  }
  /** The original fixture uses one fixed scheduler clock. */
  now(): number {
    return 0
  }
  /** Retry callbacks run only after receipt publication; attempt receipts fail on cancellation. */
  schedule(callback: () => void, delay: number): CleanupTask {
    if (delay <= 400) queueMicrotask(callback)
    return new CleanupTask(delay === 10000 ? this.#failure : undefined)
  }
}

/** Each canonical receipt is cancelled at most once by its real policy owner. */
class CleanupTask {
  /** Only the selected request-timeout task owns a failure. */
  #failure: Error | undefined
  /** Retain the chosen failure without converting it into another code or type. */
  constructor(failure: Error | undefined) {
    this.#failure = failure
  }
  /** Original cancellation failure is the independent cleanup oracle. */
  cancel(): void {
    if (this.#failure) throw this.#failure
  }
}

/** Each scenario independently observes whether a cleanup rejection escapes into the native host. */
class UnhandledCapture {
  /** Original rejection values remain untouched for the final empty-list assertion. */
  readonly reasons: unknown[] = []
  /** One stable listener identity is removed even when another assertion fails. */
  readonly #listener = (reason: unknown): void => {
    this.reasons.push(reason)
  }
  /** Register only for this case's bounded operation. */
  constructor() {
    process.on('unhandledRejection', this.#listener)
  }
  /** Restore the native event surface before returning control to the runner. */
  close(): void {
    process.off('unhandledRejection', this.#listener)
  }
}

/** A successful response cannot become another POST when its cleanup fails afterward. */
async function successfulCleanup(): Promise<void> {
  /** Native request timeout cleanup fails after the successful response is committed. */
  const cancelError = new Error('timer-cancel')
  /** Independent listener cleanup must remain reachable after the first error. */
  const removeError = new Error('listener-remove')
  /** The memory transport succeeds and records the exact POST count. */
  const fetch = vi.fn(async () => new Response(null, { status: 200 }))
  /** The old single final failure is preserved as an explicit assertion. */
  const failures: unknown[] = []
  /** No cleanup failure may escape as an unhandled host rejection. */
  const unhandled = new UnhandledCapture()
  /** No retry or timeout behavior is reimplemented inside HTTP. */
  const logger = createLogHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    scheduler: new CleanupScheduler(cancelError),
    plugins: [
      httpPlugin({
        url: 'https://example.test/logs',
        fetcher: fetch,
        features: [retryFeature({ attempts: 3, backoff: 200 }), timeoutFeature({ ms: 10000 })]
      })
    ]
  })
  logger.onFailure((failure) => {
    failures.push(failure.error)
  })
  RemovalFailureController.failure = removeError
  RemovalFailureController.oddOnly = false
  RemovalFailureController.calls = 0
  vi.stubGlobal('AbortController', RemovalFailureController)
  try {
    logger.log('info', 'success')
    await expect(logger.flush()).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledOnce()
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ source: 'logging', code: 'DELIVERY_FAILED' })
    /** Host cleanup keeps the two original resource failures in timer/listener order. */
    const cleanup = (failures[0] as Error).cause as AggregateError
    expect(cleanup).toBeInstanceOf(AggregateError)
    expect(cleanup.errors).toEqual([cancelError, removeError])
  } finally {
    vi.unstubAllGlobals()
    await logger.shutdown('manual')
    unhandled.close()
  }
  expect(unhandled.reasons).toEqual([])
}
it('does not retry a successful POST when timer and listener cleanup both fail', successfulCleanup)

/** A failed status retains its retry count, HTTP primary and ordered cleanup failures. */
async function statusCleanup(): Promise<void> {
  /** The original timer cleanup failure remains a secondary error after HTTP 503. */
  const cancelError = new Error('status-timer-cancel')
  /** The original removal cleanup failure remains after timer cancellation. */
  const removeError = new Error('status-listener-remove')
  /** An actual header value selects zero wait without changing the 503 primary. */
  const fetch = vi.fn(
    async () => new Response(null, { status: 503, headers: { 'Retry-After': '0' } })
  )
  /** Preserve the old one-final-failure assertion instead of silently changing report count. */
  const failures: unknown[] = []
  /** Rejected status cleanup remains contained through all attempts. */
  const unhandled = new UnhandledCapture()
  /** The two-attempt policy is the exact replacement for one old internal HTTP retry. */
  const logger = createLogHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    scheduler: new CleanupScheduler(cancelError),
    plugins: [
      httpPlugin({
        url: 'https://example.test/logs',
        fetcher: fetch,
        features: [retryFeature({ attempts: 2, backoff: 200 }), timeoutFeature({ ms: 10000 })]
      })
    ]
  })
  logger.onFailure((failure) => {
    failures.push(failure.error)
  })
  RemovalFailureController.failure = removeError
  RemovalFailureController.oddOnly = true
  RemovalFailureController.calls = 0
  vi.stubGlobal('AbortController', RemovalFailureController)
  try {
    logger.log('info', 'status')
    await expect(logger.flush()).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(failures).toHaveLength(1)
    /** The original HTTP primary must remain ahead of all cleanup secondaries. */
    const failure = failures[0] as Error
    expect(failure).toMatchObject({ source: 'logging', code: 'DELIVERY_FAILED' })
    /** The wrapper preserves the original aggregate instead of recreating a transport error. */
    const cleanup = failure.cause as AggregateError
    expect(cleanup).toBeInstanceOf(AggregateError)
    expect(cleanup.errors[0]).toMatchObject({
      source: 'logging.http',
      code: 'DELIVERY_FAILED',
      message: '日志推送失败: HTTP 503'
    })
    expect(cleanup.errors.slice(1)).toEqual([cancelError, removeError])
  } finally {
    vi.unstubAllGlobals()
    await logger.shutdown('manual')
    unhandled.close()
  }
  expect(unhandled.reasons).toEqual([])
}
it('keeps status retry count while retaining 503 primary and cleanup errors', statusCleanup)

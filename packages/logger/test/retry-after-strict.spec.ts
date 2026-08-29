import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler, type ILifecycleScheduler } from '@migaia/lifecycle'
import { Logger } from '../src/index.js'
import { http } from '../src/plugins/http.js'
import { setLoggerRuntimeManager } from '../src/runtime-manager.js'

type IHttpResponse = {
  readonly ok: boolean
  readonly status: number
  readonly headers: { get(name: string): string | null }
}

type IRetrySchedule = {
  readonly delayMs: number
  readonly cancel: ReturnType<typeof vi.fn>
}

type IRetryOutcome = {
  readonly fetch: ReturnType<typeof vi.fn>
  readonly schedules: readonly IRetrySchedule[]
  readonly logger: { flush(): Promise<void>; shutdown(reason: string): Promise<unknown> }
  readonly restore: () => void
  readonly scheduler: ReturnType<typeof createManualScheduler>
}

/** Creates a deterministic scheduler facade that exposes each retry delay and cancellation. */
function createObservedScheduler(): {
  readonly scheduler: ILifecycleScheduler
  readonly manual: ReturnType<typeof createManualScheduler>
  readonly schedules: IRetrySchedule[]
} {
  const manual = createManualScheduler()
  const schedules: IRetrySchedule[] = []
  const scheduler: ILifecycleScheduler = {
    now: () => manual.now(),
    schedule: (callback, delayMs) => {
      const task = manual.schedule(callback, delayMs)
      const cancel = vi.spyOn(task, 'cancel')
      schedules.push({ delayMs, cancel })
      return task
    }
  }
  return { scheduler, manual, schedules }
}

/** Starts one 429 retry flow and leaves its manual retry timer available for the test oracle. */
async function startRetryAfter(
  header: string | null,
  maxRetryAfterMs?: number
): Promise<IRetryOutcome> {
  const observed = createObservedScheduler()
  const fetch = vi
    .fn<() => Promise<IHttpResponse>>()
    .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => header } })
    .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } })
  const restore = setLoggerRuntimeManager({
    randomUUID: () => 'strict-retry-after',
    defer: (task) => task(),
    write: () => undefined,
    fetch
  })
  const logger = new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    scheduler: observed.scheduler,
    plugins: [http({ url: 'https://example.test/logs', retries: 1, maxRetryAfterMs })]
  })
  logger.log('info', 'retry-after')
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
  return {
    fetch,
    schedules: observed.schedules,
    logger,
    restore,
    scheduler: observed.manual
  }
}

/** Completes one deterministic retry flow and returns the observed retry delay. */
async function observeRetryDelay(header: string | null, maxRetryAfterMs?: number): Promise<number> {
  const outcome = await startRetryAfter(header, maxRetryAfterMs)
  const retry = outcome.schedules.find(({ delayMs }) => delayMs !== 10000)
  expect(retry).toBeDefined()
  outcome.scheduler.advance(retry!.delayMs)
  await outcome.logger.flush()
  outcome.restore()
  expect(outcome.fetch).toHaveBeenCalledTimes(2)
  return retry!.delayMs
}

describe('strict Retry-After HTTP-date admission', () => {
  it.each([
    ['delta zero', '0', 0],
    ['delta bounded', '30', 30000],
    ['delta excess clamps', '31', 30000],
    ['delta overflow clamps', '999999999999999999999999999999', 30000],
    ['IMF-fixdate future', 'Sat, 29 Aug 2026 00:00:05 GMT', 5000],
    ['RFC 850 future', 'Saturday, 29-Aug-26 00:00:05 GMT', 5000],
    ['asctime future', 'Sat Aug 29 00:00:05 2026', 5000],
    ['past HTTP-date is zero', 'Fri, 28 Aug 2026 23:59:59 GMT', 0],
    ['HTTP-date excess clamps', 'Sat, 29 Aug 2026 00:10:00 GMT', 30000]
  ])('accepts %s with the exact bounded delay', async (_name, header, expectedDelay) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
    try {
      await expect(observeRetryDelay(header, undefined)).resolves.toBe(expectedDelay)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['ISO date-only', '2026-08-29'],
    ['localized date', 'August 29, 2026 00:00:05 GMT'],
    ['wrong weekday', 'Fri, 29 Aug 2026 00:00:05 GMT'],
    ['impossible calendar day', 'Sat, 29 Feb 2026 00:00:05 GMT'],
    ['invalid timezone', 'Sat, 29 Aug 2026 00:00:05 UTC'],
    ['trailing whitespace', 'Sat, 29 Aug 2026 00:00:05 GMT '],
    ['extra internal whitespace', 'Sat, 29 Aug 2026  00:00:05 GMT'],
    ['invalid hour', 'Sat, 29 Aug 2026 24:00:00 GMT'],
    ['invalid RFC 850 month', 'Saturday, 29-Foo-26 00:00:05 GMT'],
    ['invalid asctime day spacing', 'Sat Aug  29 00:00:05 2026']
  ])('uses normal backoff for %s instead of permissive Date.parse', async (_name, header) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
    try {
      await expect(observeRetryDelay(header, undefined)).resolves.toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clamps a valid HTTP-date to a caller-owned lower bound', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
    try {
      await expect(observeRetryDelay('Sat, 29 Aug 2026 00:00:10 GMT', 7000)).resolves.toBe(7000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a scheduled Retry-After wait during shutdown without a second request', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
    try {
      const outcome = await startRetryAfter('Sat, 29 Aug 2026 00:00:05 GMT')
      const retry = outcome.schedules.find(({ delayMs }) => delayMs === 5000)
      expect(retry).toBeDefined()
      await outcome.logger.shutdown('manual')
      expect(retry!.cancel).toHaveBeenCalledOnce()
      expect(outcome.fetch).toHaveBeenCalledTimes(1)
      outcome.restore()
    } finally {
      vi.useRealTimers()
    }
  })
})

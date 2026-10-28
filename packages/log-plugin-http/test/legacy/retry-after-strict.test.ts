import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { retryFeature, timeoutFeature } from '@migaia/log-host/features'
import type { IScheduler, IScheduledTask } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { httpPlugin } from '../../src/index.ts'

/** One observed scheduler task retains its delay and exact native cancellation spy. */
type IRetrySchedule = { readonly delayMs: number; readonly cancel: ReturnType<typeof vi.fn> }

/** A deterministic scheduler records only public scheduling and cancellation behavior. */
class ObservedScheduler implements IScheduler {
  /** The canonical manual scheduler is the only clock and pending-task owner. */
  readonly manual = createManualScheduler()
  /** Timers are observed in admission order, before any manual advancement. */
  readonly schedules: IRetrySchedule[] = []
  /** Read the canonical manual clock without a second timing domain. */
  now(): number {
    return this.manual.now()
  }
  /** Retain the real task and observe cancellation without replacing timer semantics. */
  schedule(callback: () => void, delayMs: number): IScheduledTask {
    /** The returned canonical task is the exact receipt the host owns. */
    const task = this.manual.schedule(callback, delayMs)
    /** A spy records whether cancellation happened exactly once. */
    const cancel = vi.spyOn(task, 'cancel')
    this.schedules.push({ delayMs, cancel })
    return task
  }
}

/** Preserve raw header strings so strict grammar fixtures cannot be normalized by native Headers. */
class RetryResponse {
  /** HTTP success controls only whether this response needs a retry. */
  readonly ok: boolean
  /** The first response retains the original retryable 429 status. */
  readonly status: number
  /** The exact untrimmed header value belongs to this fixture response. */
  #header: string | null
  /** The injectable response contract borrows one ordinary header reader. */
  readonly headers = { get: (_name: string): string | null => this.#header }
  /** Capture response classification without coercing the header. */
  constructor(ok: boolean, header: string | null) {
    this.ok = ok
    this.status = ok ? 200 : 429
    this.#header = header
  }
}

/** One transport attempts 429 once, then accepts the next identical public delivery. */
class RetryTransport {
  /** Header grammar is tested only by production HTTP code. */
  #header: string | null
  /** The shared observed scheduler records actual request times. */
  #scheduler: ObservedScheduler
  /** Request count remains independent from timer count. */
  calls = 0
  /** Zero delay is observed as zero elapsed scheduler time, even when utils needs no zero timer. */
  readonly times: number[] = []
  /** Capture the exact source header and clock. */
  constructor(header: string | null, scheduler: ObservedScheduler) {
    this.#header = header
    this.#scheduler = scheduler
  }
  /** A stable callback preserves the standalone injected function contract. */
  readonly fetch = (): Promise<RetryResponse> => this.send()
  /** Record one memory-only POST and return a raw-header response. */
  async send(): Promise<RetryResponse> {
    this.calls++
    this.times.push(this.#scheduler.now())
    return new RetryResponse(this.calls > 1, this.calls > 1 ? null : this.#header)
  }
}

/** The migrated fixture uses public host retry/timeout features instead of removed HTTP options. */
async function startRetryAfter(header: string | null, maxRetryAfterMs?: number) {
  /** One source owns all host, request and backoff time. */
  const scheduler = new ObservedScheduler()
  /** The transport retains the legacy 429-then-success behavior. */
  const transport = new RetryTransport(header, scheduler)
  /** The original single retry and request timeout are expressed through their canonical owners. */
  const logger = createLogHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    scheduler,
    report: ignore,
    plugins: [
      httpPlugin({
        url: 'https://example.test/logs',
        fetcher: transport.fetch,
        maxRetryAfterMs,
        features: [retryFeature({ attempts: 2, backoff: 200 }), timeoutFeature({ ms: 10000 })]
      })
    ]
  })
  logger.log('info', 'retry-after')
  await microtasks()
  return { scheduler, transport, logger }
}

/** Expected deadline degradation stays in memory instead of writing diagnostics during this fixture. */
function ignore(): void {}

/**
 * Fixed microtask progress adapts the old immediate-delivery fixture to asynchronous host
 * admission.
 */
async function microtasks(): Promise<void> {
  for (let index = 0; index < 64; index++) await Promise.resolve()
}

/** Select only a retry delay; request attempt timeouts retain their separate 10000ms contract. */
function retryTimer(task: IRetrySchedule): boolean {
  return task.delayMs !== 10000
}

/** Observe the exact bounded delay through public request timing and any canonical retry timer. */
async function observeRetryDelay(header: string | null, maxRetryAfterMs?: number): Promise<number> {
  /** The first attempt has already reached its retry decision. */
  const outcome = await startRetryAfter(header, maxRetryAfterMs)
  /** A positive canonical backoff always owns a scheduler task. */
  const retry = outcome.scheduler.schedules.find(retryTimer)
  if (retry) outcome.scheduler.manual.advance(retry.delayMs)
  else expect(outcome.transport.calls).toBe(2)
  await outcome.logger.flush()
  expect(outcome.transport.calls).toBe(2)
  /** The elapsed delay independently proves even the utils zero-delay branch. */
  const elapsed = outcome.transport.times[1] - outcome.transport.times[0]
  if (retry) expect(elapsed).toBe(retry.delayMs)
  else expect(elapsed).toBe(0)
  await outcome.logger.shutdown('manual')
  return elapsed
}

/** Valid Retry-After values retain all original exact delay and clamping assertions. */
async function validHeader(_name: string, header: string, expectedDelay: number): Promise<void> {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
  try {
    await expect(observeRetryDelay(header, undefined)).resolves.toBe(expectedDelay)
  } finally {
    vi.useRealTimers()
  }
}
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
] as const)('accepts %s with the exact bounded delay', validHeader)

/** Invalid HTTP-date forms retain the original normal-backoff assertion. */
async function invalidHeader(_name: string, header: string): Promise<void> {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
  try {
    await expect(observeRetryDelay(header, undefined)).resolves.toBe(200)
  } finally {
    vi.useRealTimers()
  }
}
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
] as const)('uses normal backoff for %s instead of permissive Date.parse', invalidHeader)

/** Caller-owned lower bounds retain the original absolute-date clamping behavior. */
async function lowerBound(): Promise<void> {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
  try {
    await expect(observeRetryDelay('Sat, 29 Aug 2026 00:00:10 GMT', 7000)).resolves.toBe(7000)
  } finally {
    vi.useRealTimers()
  }
}
it('clamps a valid HTTP-date to a caller-owned lower bound', lowerBound)

/** Shutdown drains to its old deadline, then cancels delayed retry without issuing another POST. */
async function shutdownRetry(): Promise<void> {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
  try {
    /** The original five-second server advice extends beyond the host's shutdown budget. */
    const outcome = await startRetryAfter('Sat, 29 Aug 2026 00:00:05 GMT')
    /** Exact cancellation remains observable on the canonical scheduler receipt. */
    const retry = outcome.scheduler.schedules.find(fiveSecondTimer)
    expect(retry).toBeDefined()
    /** Asynchronous shutdown publishes its Promise before it starts the bounded drain. */
    const shutdown = outcome.logger.shutdown('manual')
    await microtasks()
    outcome.scheduler.manual.advance(3000)
    await shutdown
    expect(retry!.cancel).toHaveBeenCalledOnce()
    expect(outcome.transport.calls).toBe(1)
  } finally {
    vi.useRealTimers()
  }
}

/** Select only the server-advised retry task independently of host deadline timers. */
function fiveSecondTimer(task: IRetrySchedule): boolean {
  return task.delayMs === 5000
}
it(
  'drains until the shutdown deadline then cancels Retry-After without a second request',
  shutdownRetry
)

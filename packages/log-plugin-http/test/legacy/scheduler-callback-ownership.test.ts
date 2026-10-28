import { walkErrorCauses } from '@migaia/utils/error'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { retryFeature, timeoutFeature } from '@migaia/log-host/features'
import { httpPlugin } from '../../src/index.ts'

/** Fetch injection uses the actual public factory's portable request/response contract. */
type IHttpFetch = NonNullable<Parameters<typeof httpPlugin>[0]['fetcher']>

/** Each case selects only the original scheduler callback and receipt failure boundaries. */
type ISyncSchedulerOptions = {
  scheduleFailure?: Error
  task?: IScheduledTask
}

/** A genuine scheduler receipt records cancellation independently of callback admission. */
class OwnedTask implements IScheduledTask {
  /** The spy observes every real call made by the canonical resource owner. */
  readonly cancel = vi.fn(() => this.cancelTask())
  /** A successful returned receipt is independently observable. */
  cancelTask(): void {}
}

/** The original hostile accessor remains a real scheduler receipt boundary. */
class GetterFailureTask implements IScheduledTask {
  /** Getter failure must remain reachable after scheduler/timeout containment. */
  #failure: Error
  /** Capture the exact original exception once for this case. */
  constructor(failure: Error) {
    this.#failure = failure
  }
  /** Reading cancellation fails before a cancellation call can be obtained. */
  get cancel(): never {
    throw this.#failure
  }
}

/** Exceptional registration/cancellation admission retains its primary error contract. */
class SyncScheduler implements IScheduler {
  /** Case-local callback and receipt behavior is captured before host construction. */
  #options: ISyncSchedulerOptions
  /** Only independently returned receipts enter this record. */
  readonly schedules: Array<{ readonly delayMs: number; readonly task: IScheduledTask }> = []
  /** Keep the old call-argument assertion on the actual scheduler entry point. */
  readonly schedule = vi.fn((callback: () => void, delayMs: number) =>
    this.register(callback, delayMs)
  )
  /** The original fixture holds one fixed monotonic clock. */
  now(): number {
    return 0
  }
  /** Preserve the scenario's callback-before-return ordering without private production seams. */
  constructor(options: ISyncSchedulerOptions = {}) {
    this.#options = options
  }
  /** A throwing registration returns no receipt even when its callback already ran. */
  register(callback: () => void, delayMs: number): IScheduledTask {
    callback()
    if (this.#options.scheduleFailure) throw this.#options.scheduleFailure
    /** The independent receipt is created only after the callback has returned. */
    const task = this.#options.task ?? new OwnedTask()
    this.schedules.push({ delayMs, task })
    return task
  }
}

/** Original scheduling becomes observable after the new host's asynchronous entry admission. */
async function admittedMicrotasks(): Promise<void> {
  // Sixty-four is a fixed fixture bound covering one delivery's canonical Promise continuations.
  for (let index = 0; index < 64; index++) await Promise.resolve()
}

/** The original error-chain helper remains the authority for exact cause reachability. */
function errorCauses(error: unknown): unknown[] {
  return [...walkErrorCauses(error)]
}

/** One public HTTP output retains old total attempts, backoff and ten-second timeout policy. */
async function runHttp(
  scheduler: SyncScheduler,
  fetcher: IHttpFetch,
  retries = 0,
  flushFailure?: Error
): Promise<{ failures: unknown[] }> {
  /** Runtime failures are observed without terminal console duplication. */
  const failures: unknown[] = []
  /** A real host owns scheduler snapshots, timeout/retry policy and the output registration. */
  const host = createLogHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    scheduler,
    plugins: [
      httpPlugin({
        url: 'https://example.test/logs',
        fetcher,
        features: [
          retryFeature({ attempts: retries + 1, backoff: 200 }),
          timeoutFeature({ ms: 10000 })
        ]
      })
    ]
  })
  host.onFailure(({ error }) => {
    failures.push(error)
  })
  try {
    host.log('info', 'scheduled')
    await admittedMicrotasks()
    await expect(host.flush()).resolves.toBeUndefined()
    if (flushFailure) expect.soft(failures.flatMap(errorCauses)).toContain(flushFailure)
    return { failures }
  } finally {
    await host.shutdown('manual')
  }
}

/** Preserve native signals while exposing the old global AbortController abort-throw boundary. */
const NativeAbortController = globalThis.AbortController

/** A real native controller's abort method can still fail before the request is admitted. */
class CallbackFailureAbortController extends NativeAbortController {
  /** The original callback exception belongs only to its current legacy case. */
  static failure: Error
  /** Keep the original failure primary without replacing the native signal with a fake object. */
  override abort(): void {
    throw CallbackFailureAbortController.failure
  }
}

/** Throwing from the real timeout callback must not lose its independently returned receipt. */
async function callbackFailure(): Promise<void> {
  /** The exact original must survive as the reported primary cause. */
  const primary = new Error('abort-callback')
  CallbackFailureAbortController.failure = primary
  /** Timeout callback and receipt ordering is unchanged from the original case. */
  const scheduler = new SyncScheduler()
  /** Failed abort admission must prevent even a successful fetcher from being called. */
  const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }))
  vi.stubGlobal('AbortController', CallbackFailureAbortController)
  try {
    /** The supported native global remains the only controller injection boundary. */
    const result = await runHttp(scheduler, fetch)
    expect.soft(fetch).not.toHaveBeenCalled()
    expect.soft(scheduler.schedules[0]?.task.cancel).toHaveBeenCalledOnce()
    expect.soft(result.failures[0]).toMatchObject({
      source: 'logging',
      code: 'DELIVERY_FAILED'
    })
    expect(errorCauses(result.failures[0])[1]).toBe(primary)
  } finally {
    vi.stubGlobal('AbortController', NativeAbortController)
  }
}

/** A schedule throw after a completed callback remains primary, with no invented task receipt. */
async function scheduleThrowAfterCallback(): Promise<void> {
  /** The registration's original exception must remain reachable despite fulfilled flush. */
  const primary = new Error('schedule-after-callback')
  /** No schedule call can return a handle after this deliberate post-callback throw. */
  const scheduler = new SyncScheduler({ scheduleFailure: primary })
  /** Deadline admission failure must prevent POST. */
  const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }))
  /** The old rejected-flush error is now observed through the approved fulfilled failure path. */
  const result = await runHttp(scheduler, fetch, 1, primary)
  expect.soft(fetch).not.toHaveBeenCalled()
  expect.soft(scheduler.schedule).toHaveBeenCalledWith(expect.any(Function), 10000)
  expect.soft(scheduler.schedules).toHaveLength(0)
  expect.soft(result.failures[0]).toMatchObject({
    source: 'logging',
    code: 'DELIVERY_FAILED'
  })
  expect(errorCauses(result.failures[0])[1]).toBe(primary)
}

/** A hostile cancellation accessor must not leave the public delivery or flush unsettled. */
async function cancelGetterFailure(): Promise<void> {
  /** The exact original remains beneath the same ordered wrapping position. */
  const primary = new Error('cancel-getter')
  /** The callback still fires before this real receipt's accessor is read. */
  const scheduler = new SyncScheduler({ task: new GetterFailureTask(primary) })
  /** Timeout settlement must prevent the otherwise-successful POST. */
  const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }))
  /** Flush remains fulfilled while the original getter error must still be observed. */
  const result = await runHttp(scheduler, fetch, 0, primary)
  expect.soft(fetch).not.toHaveBeenCalled()
  expect.soft(result.failures[0]).toMatchObject({
    source: 'logging',
    code: 'DELIVERY_FAILED'
  })
  /** The existing lifecycle accessor wrapper remains the first primary branch. */
  const admission = (result.failures[0] as Error).cause as TypeError
  expect(admission).toBeInstanceOf(TypeError)
  expect(admission).toMatchObject({ source: 'lifecycle', code: 'INVALID_OPTION' })
  expect(admission.cause).toBe(primary)
}

it(
  'keeps request callback failure primary and still cancels the returned task once',
  callbackFailure
)
it(
  'keeps schedule throw primary when callback already ran and no handle was returned',
  scheduleThrowAfterCallback
)
it(
  'contains a task cancel getter failure without leaving the delivery pending',
  cancelGetterFailure
)

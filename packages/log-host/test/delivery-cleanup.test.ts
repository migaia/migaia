import { expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { createLogHost } from '../src/index.ts'
import { defineOutputPlugin } from '../src/plugin.ts'
import { retryFeature } from '../src/features/retry.ts'
import { timeoutFeature } from '../src/features/timeout.ts'
import { FailureCapture } from './fixtures/output.ts'

/** The native signal remains real while the selected cleanup operation reports its original error. */
const NativeAbortController = globalThis.AbortController

/** A native controller exposes a failing removal without introducing another cancellation owner. */
class RemovalFailureController extends NativeAbortController {
  /** The selected original belongs to the currently executing case. */
  static failure: Error
  /** A failed first attempt can have a cleanup failure absent from its later retry. */
  static firstOnly = false
  /** Fixed-case removal order distinguishes earlier cleanup from final-attempt cleanup. */
  static removals = 0
  /** Native listener removal is still called with the exact original signal receiver. */
  #remove: AbortSignal['removeEventListener']
  /** Only listener cleanup is replaced; abort/reason behavior stays native. */
  constructor() {
    super()
    this.#remove = this.signal.removeEventListener
    Object.defineProperty(this.signal, 'removeEventListener', {
      configurable: true,
      value: (...args: Parameters<AbortSignal['removeEventListener']>) => this.remove(...args)
    })
  }
  /** Remove the actual registration before throwing the independently observed cleanup failure. */
  remove(...args: Parameters<AbortSignal['removeEventListener']>): void {
    Reflect.apply(this.#remove, this.signal, args)
    RemovalFailureController.removals++
    if (!RemovalFailureController.firstOnly || RemovalFailureController.removals === 1)
      throw RemovalFailureController.failure
  }
}

/** One real manual-clock receipt remains cancelled before its independent cleanup error is thrown. */
class CleanupTask implements IScheduledTask {
  /** The canonical scheduler continues to own actual timer state. */
  #task: IScheduledTask
  /** This receipt retains the exact injected cleanup error. */
  #failure: Error
  /** Borrow the real receipt without introducing a parallel timer. */
  constructor(task: IScheduledTask, failure: Error) {
    this.#task = task
    this.#failure = failure
  }
  /** Release the real timer before reporting the original cleanup failure. */
  cancel(): void {
    this.#task.cancel()
    throw this.#failure
  }
}

/** Supported callbacks remain asynchronous to schedule receipt publication. */
class CleanupScheduler implements IScheduler {
  /** The canonical manual clock owns all callback timing. */
  #clock = createManualScheduler()
  /** Only output attempt timer cleanup receives this failure. */
  #failure: Error
  /** Capture the selected original before host scheduler admission. */
  constructor(failure: Error) {
    this.#failure = failure
  }
  /** Keep one monotonic clock domain for host and output policy. */
  now(): number {
    return this.#clock.now()
  }
  /** Every callback is registered before its independently returned receipt can be used. */
  schedule(callback: () => void, delay: number): IScheduledTask {
    /** A real canonical task is returned even when its cleanup is deliberately hostile. */
    const task = this.#clock.schedule(callback, delay)
    return delay === 10000 ? new CleanupTask(task, this.#failure) : task
  }
}

/** Primary classification must use the deliver error, independently of cleanup wrapping. */
async function failedDeliveryPrimary(): Promise<void> {
  /** The exact primary remains first through both attempts and the final aggregate. */
  const primary = new Error('delivery-primary')
  /** Timer cancellation is the first cleanup secondary. */
  const cancel = new Error('timer-cancel')
  /** Native signal removal follows cancellation. */
  const remove = new Error('listener-remove')
  /** The actual output callback always rejects the same original primary. */
  const deliver = vi.fn(async () => {
    throw primary
  })
  /** Retry callbacks independently prove exact original identity rather than matching its shape. */
  const retryable = vi.fn((error: unknown) => error === primary)
  /** A zero delay keeps this case focused on error classification and cleanup order. */
  const retryDelay = vi.fn((_error: unknown) => 0)
  /** All reported values belong to the host's real failure channel. */
  const failures = new FailureCapture()
  /** Native host lifetime resources predate the later controller cleanup injection. */
  const host = createLogHost({
    scheduler: new CleanupScheduler(cancel),
    plugins: [
      defineOutputPlugin({
        name: 'primary-output',
        batchable: true,
        defaultFormat: 'json',
        features: [retryFeature({ attempts: 2 }), timeoutFeature({ ms: 10000 })],
        deliver,
        retryable,
        retryDelay
      })
    ]
  })
  host.onFailure(failures.receive)
  RemovalFailureController.failure = remove
  RemovalFailureController.firstOnly = true
  RemovalFailureController.removals = 0
  vi.stubGlobal('AbortController', RemovalFailureController)
  try {
    host.log('info', 'failed')
    await expect(host.flush()).resolves.toBeUndefined()
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(retryable).toHaveBeenCalledExactlyOnceWith(primary)
    expect(retryDelay).toHaveBeenCalledExactlyOnceWith(primary)
    expect(failures.failures).toHaveLength(1)
    expect(failures.failures[0].error).toMatchObject({ source: 'logging', code: 'DELIVERY_FAILED' })
    expect((failures.failures[0].error as Error).cause).toBeInstanceOf(AggregateError)
    expect(((failures.failures[0].error as Error).cause as AggregateError).errors).toEqual([
      primary,
      cancel,
      remove
    ])
  } finally {
    vi.unstubAllGlobals()
    await host.shutdown('manual')
  }
}

/** Cleanup after fulfilled delivery cannot cause a second successful output operation. */
async function successfulDeliveryCleanup(): Promise<void> {
  /** Independent native failures preserve the original release order. */
  const cancel = new Error('success-timer-cancel')
  /** Listener removal must remain reachable after the cancellation failure. */
  const remove = new Error('success-listener-remove')
  /** A real fulfilled transport is counted separately from every policy callback. */
  const deliver = vi.fn(async () => undefined)
  /** Cleanup-only failure must not be offered to an output's transport retry classifier. */
  const retryable = vi.fn(() => true)
  /** A successful operation has no transport retry hint to consult. */
  const retryDelay = vi.fn(() => 0)
  /** The host reports exactly one final cleanup-only error. */
  const failures = new FailureCapture()
  /** Retry is deliberately available so the no-replay assertion exercises actual policy. */
  const host = createLogHost({
    scheduler: new CleanupScheduler(cancel),
    plugins: [
      defineOutputPlugin({
        name: 'success-output',
        batchable: true,
        defaultFormat: 'json',
        features: [retryFeature({ attempts: 3 }), timeoutFeature({ ms: 10000 })],
        deliver,
        retryable,
        retryDelay
      })
    ]
  })
  host.onFailure(failures.receive)
  RemovalFailureController.failure = remove
  RemovalFailureController.firstOnly = false
  RemovalFailureController.removals = 0
  vi.stubGlobal('AbortController', RemovalFailureController)
  try {
    host.log('info', 'success')
    await expect(host.flush()).resolves.toBeUndefined()
    expect(deliver).toHaveBeenCalledOnce()
    expect(retryable).not.toHaveBeenCalled()
    expect(retryDelay).not.toHaveBeenCalled()
    expect(failures.failures).toHaveLength(1)
    expect(failures.failures[0].error).toMatchObject({ source: 'logging', code: 'DELIVERY_FAILED' })
    expect((failures.failures[0].error as Error).cause).toBeInstanceOf(AggregateError)
    expect(((failures.failures[0].error as Error).cause as AggregateError).errors).toEqual([
      cancel,
      remove
    ])
  } finally {
    vi.unstubAllGlobals()
    await host.shutdown('manual')
  }
}

it(
  'classifies retry using deliver primary before ordered timeout cleanup errors',
  failedDeliveryPrimary
)
it('reports host cleanup once without replaying a successful delivery', successfulDeliveryCleanup)

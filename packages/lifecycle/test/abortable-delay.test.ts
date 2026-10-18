import { describe, expect, it, vi } from 'vitest'
import { type IScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { abortableDelay, createAbortController, LifecycleErrorCode } from '../src/index.js'

describe('review 1c abortableDelay', () => {
  it('resolves elapsed and aborted waits without leaving a timer owned', async () => {
    /** Virtual time proves ownership without wall-clock timing assertions. */
    const scheduler = createManualScheduler()
    /** The elapsed wait must own exactly one task until its duration passes. */
    const elapsed = abortableDelay(scheduler, 10, undefined)
    expect(scheduler.pendingCount).toBe(1)
    scheduler.advance(10)
    await expect(elapsed).resolves.toBe(true)
    expect(scheduler.pendingCount).toBe(0)

    /** This cancellation source belongs to one wait, not to the scheduler. */
    const controller = createAbortController()
    /** Aborting completes the delay while the domain caller keeps its cancellation policy. */
    const aborted = abortableDelay(scheduler, 100, controller.signal)
    controller.abort()
    await expect(aborted).resolves.toBe(false)
    expect(scheduler.pendingCount).toBe(0)
  })

  it.each([false, true])(
    'cancels a synchronously returned task once with cleanup reporting=%s',
    async (reportsCleanup) => {
      /** One native error must retain its identity through either observation channel. */
      const failure = new Error('fixture timer cleanup failed')
      /** The returned handle must not be cancelled once in the callback and once after admission. */
      const cancel = vi.fn(() => {
        throw failure
      })
      /** An injected synchronous callback stresses the admission/returned-handle race. */
      const scheduler: IScheduler = {
        now: () => 0,
        schedule: (callback) => {
          callback()
          return { cancel }
        }
      }
      /** The owner can choose diagnostic cleanup while preserving successful settlement. */
      const report = vi.fn()
      /** The same canonical state machine serves both cleanup policies. */
      const pending = abortableDelay(scheduler, 1, undefined, reportsCleanup ? report : undefined)
      if (reportsCleanup) {
        await expect(pending).resolves.toBe(true)
        expect(report).toHaveBeenCalledWith(failure)
      } else await expect(pending).rejects.toBe(failure)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(failure).toMatchObject({
        source: '@migaia/lifecycle',
        code: LifecycleErrorCode.delayFailed
      })
    }
  )

  it('retains a native admission failure with the registered lifecycle code', async () => {
    /** A host scheduling failure remains the same Error, including its original stack. */
    const failure = new Error('fixture scheduling failed')
    /** A scheduler may fail admission without admitting a timer. */
    const scheduler: IScheduler = {
      now: () => 0,
      schedule: () => {
        throw failure
      }
    }
    await expect(abortableDelay(scheduler, 1, undefined)).rejects.toBe(failure)
    expect(failure).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.delayFailed
    })
  })
})

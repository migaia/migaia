import { describe, expect, it, vi } from 'vitest'
import {
  boundedWait,
  createLifecycleUnit,
  createManualScheduler,
  createProvisionalScope
} from '../src/index.js'
import { observeAbortSubscription } from '../src/observed-subscription.js'

describe('MA-052 through MA-080 lifecycle closure regressions', () => {
  it('contains a task rejection after boundedWait timeout without a host throw', async () => {
    const scheduler = createManualScheduler()
    const uncaught: unknown[] = []
    const onUncaught = (error: unknown): void => {
      uncaught.push(error)
    }
    process.on('uncaughtException', onUncaught)
    let reject!: (error: unknown) => void
    const task = new Promise<void>((_, rejectTask) => {
      reject = rejectTask
    })
    const waiting = boundedWait(task, 1, { scheduler })
    scheduler.advance(1)
    await expect(waiting).resolves.toBe(false)
    reject(new Error('late rejection'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off('uncaughtException', onUncaught)
    expect(uncaught).toEqual([])
  })

  it('advances manual time to each due callback so nested positive delays run in order', () => {
    const scheduler = createManualScheduler()
    const seen: number[] = []
    scheduler.schedule(() => {
      seen.push(scheduler.now())
      scheduler.schedule(() => seen.push(scheduler.now()), 1)
    }, 5)
    scheduler.advance(10)
    expect(seen).toEqual([5, 6])
  })

  it('does not let a synchronous superseded lifecycle unit result overwrite the current generation', () => {
    const unit = createLifecycleUnit<number>()
    let first = true
    unit.start(() => {
      if (first) {
        first = false
        unit.start(() => 2)
      }
      return 1
    })
    expect(unit.value).toBe(2)
  })

  it('captures signal listener methods once and retains the receiver', () => {
    let addReads = 0
    let removeReads = 0
    const signal = {
      aborted: false,
      reason: undefined,
      get addEventListener() {
        addReads++
        return function (this: unknown): void {
          expect(this).toBe(signal)
        }
      },
      get removeEventListener() {
        removeReads++
        return function (this: unknown): void {
          expect(this).toBe(signal)
        }
      }
    }
    const subscription = observeAbortSubscription(
      signal,
      () => undefined,
      () => undefined
    )
    subscription.unsubscribe()
    expect(addReads).toBe(1)
    expect(removeReads).toBe(1)
  })

  it('publishes one rollback promise before abort listeners can re-enter', async () => {
    const scope = createProvisionalScope()
    let reentrant: Promise<void> | undefined
    scope.signal.addEventListener('abort', () => {
      reentrant = scope.rollback()
    })
    const first = scope.rollback()
    await expect(first).resolves.toBeUndefined()
    expect(reentrant).toBe(first)
  })

  it('settles a queued mutation when the timeout clock fails after removal', async () => {
    let nowCalls = 0
    const scheduler = {
      now: () => {
        nowCalls++
        if (nowCalls > 2) throw new Error('late clock')
        return 0
      },
      schedule: (callback: () => void) => {
        callback()
        return { cancel: vi.fn() }
      }
    }
    const { createMutationQueue } = await import('../src/mutation-queue.js')
    const queue = createMutationQueue({ scheduler, queueAdmissionTimeoutMs: 1 })
    void queue.enqueue(() => new Promise<void>(() => {}))
    const queued = queue.enqueue(() => undefined)
    await expect(queued).rejects.toMatchObject({ code: 'QUEUE_ADMISSION_TIMEOUT' })
    expect(queue.size).toBe(1)
  })
})

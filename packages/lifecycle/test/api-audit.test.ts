import { describe, expect, it, vi } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { boundedWait, createSyncLifecycleScope, executeReleaseDescriptor } from '../src/index.js'

describe('lifecycle audited release contracts', () => {
  it('retains the task primary when timer cancellation also fails', async () => {
    /** These independent errors must remain reachable through the returned failure. */
    const primary = new Error('task primary')
    /** Cleanup is secondary to the task that won the wait. */
    const cleanup = new Error('timer cleanup')
    try {
      await boundedWait(Promise.reject(primary), 10, {
        scheduler: {
          now: () => 0,
          schedule: () => ({
            cancel: () => {
              throw cleanup
            }
          })
        }
      })
    } catch (error) {
      expect(walkErrorCauses(error)).toContain(primary)
      expect(walkErrorCauses(error)).toContain(cleanup)
      return
    }
    expect.unreachable('the failed task must reject')
  })

  it('waits for a synchronous timer registration before finalizing cleanup', async () => {
    /** A synchronous callback still owns the handle returned after it fires. */
    const cleanup = new Error('timer cleanup')
    /** Cancellation must happen exactly once, including the failure path. */
    const cancel = vi.fn(() => {
      throw cleanup
    })
    await expect(
      boundedWait(new Promise(() => {}), 10, {
        scheduler: {
          now: () => 0,
          schedule: (callback) => {
            callback()
            return { cancel }
          }
        }
      })
    ).rejects.toBe(cleanup)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('reports a syncSafe thenable rejection while keeping synchronous disposal', async () => {
    /** Observe the original late failure without waiting for it in synchronous disposal. */
    const failure = new Error('sync callback rejected')
    /** Report is the existing asynchronous observation channel for a contract-violating callback. */
    const reports: unknown[] = []
    /** The then protocol is captured exactly once before it is observed. */
    let thenReads = 0
    /** A structural thenable makes rejection observation measurable without a process handler. */
    const result = {
      // oxlint-disable-next-line unicorn/no-thenable -- This fixture exercises the supported captured-then protocol.
      get then() {
        thenReads++
        return (_resolve: unknown, reject: (error: unknown) => void) => reject(failure)
      }
    }
    /** Collector must return the synchronous violation immediately. */
    const scope = createSyncLifecycleScope({
      errorPolicy: 'collect',
      report: (error) => reports.push(error)
    })
    scope.own({}, { syncSafe: true, force: () => result as never })
    expect(scope.dispose()[0]?.error).toMatchObject({ code: 'SCOPE_SYNC_VIOLATION' })
    expect(scope.lifecycle).toBe('terminal')
    await Promise.resolve()
    await Promise.resolve()
    expect(thenReads).toBe(1)
    expect(reports).toHaveLength(1)
    expect(walkErrorCauses(reports[0])).toContain(failure)
  })

  it('observes a graceful rejection even when its shared deadline has passed', async () => {
    /** Graceful work was already called, so force fallback cannot erase its later rejection. */
    const failure = new Error('late graceful rejected')
    /** The original promise is rejected only after the release selected its force fallback. */
    let reject!: (error: unknown) => void
    /** Keep the task pending until the expired-deadline branch has returned. */
    const task = new Promise<void>((_resolve, rejectTask) => {
      reject = rejectTask
    })
    /** Existing context reporter receives diagnostics and the late original error. */
    const reports: unknown[] = []
    /** Force must still release once without awaiting noncooperative graceful work. */
    const force = vi.fn()
    await expect(
      executeReleaseDescriptor(
        { graceful: () => task, force },
        {
          signal: new AbortController().signal,
          deadlineAt: 0,
          scheduler: { now: () => 1, schedule: () => ({ cancel: () => undefined }) },
          report: (error) => reports.push(error)
        }
      )
    ).resolves.toEqual([])
    reject(failure)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    expect(force).toHaveBeenCalledTimes(1)
    expect(reports.some((error) => walkErrorCauses(error).includes(failure))).toBe(true)
  })
})

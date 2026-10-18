import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createCoroutineSupervisor } from '../../src/coroutine/index.js'
import { createCoroutineLauncher, terminateCoroutineHandle } from '../../src/coroutine/launcher.js'
import { deferred } from '../support/memory-launcher.js'

/** Flushes task and supervisor continuations without moving virtual time. */
async function flush(): Promise<void> {
  for (let index = 0; index < 30; index++) await Promise.resolve()
}

describe('A12 coroutine profile', () => {
  it('classifies fulfilled and rejected task settlement', async () => {
    const scheduler = createManualScheduler()
    const done = deferred<void>()
    const supervisor = createCoroutineSupervisor({
      id: 'coroutine',
      report: () => undefined,
      spec: { task: () => done.promise },
      budget: createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false, scheduler }),
      scheduler
    })
    await supervisor.start()
    done.resolve()
    await flush()
    expect(supervisor.inspect().lastExit?.reason).toBe('exited')
    expect(supervisor.state).toBe('stopped')

    const boom = new Error('task boom')
    const broken = createCoroutineSupervisor({
      id: 'broken',
      report: () => undefined,
      // Without restart, start() settles on the crash instead of waiting out a backoff.
      restart: { mode: 'never' },
      spec: { task: () => Promise.reject(boom) },
      budget: createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false, scheduler }),
      scheduler
    })
    await broken.start()
    await flush()
    expect(broken.inspect().lastExit?.reason).toBe('crashed')
    const error = broken.inspect().lastExit?.error as Error & { code?: string }
    expect(error.code).toBe(SupervisionErrorCode.exitUnexpected)
    expect(error.cause).toBe(boom)
  })

  it('aborts once and runs an async generator finally block on stop', async () => {
    const scheduler = createManualScheduler()
    const gate = deferred<void>()
    let cleaned = false
    let aborted = 0
    const supervisor = createCoroutineSupervisor({
      id: 'generator',
      report: () => undefined,
      spec: {
        task: async function* ({ signal }) {
          signal.addEventListener('abort', () => {
            aborted++
          })
          try {
            yield 1
            await gate.promise
          } finally {
            cleaned = true
          }
        }
      },
      budget: createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false, scheduler }),
      scheduler
    })
    await supervisor.start()
    const stopped = supervisor.stop()
    // Let the queued lifetime retirement begin before allowing the task to exit naturally.
    await flush()
    expect(aborted).toBe(1)
    gate.resolve()
    await stopped
    expect(cleaned).toBe(true)
    expect(aborted).toBe(1)
    expect(supervisor.inspect().lastExit?.reason).toBe('stopped')
  })

  it('reports a synchronous iterator return failure and waits for next before exiting', async () => {
    const scheduler = createManualScheduler()
    const boom = new Error('return failed')
    /** Custom iterators may leave next active even after a return request fails. */
    const next = deferred<IteratorResult<unknown>>()
    /** Cleanup failure is observable before actual exit. */
    const reports: unknown[] = []
    let returns = 0
    let aborts = 0
    let unhandled = 0
    const onUnhandled = (): void => {
      unhandled++
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const launcher = createCoroutineLauncher<undefined>(scheduler, (error) => {
        reports.push(error)
      })
      const handle = await launcher.launch(
        {
          task: ({ signal }) => {
            signal.addEventListener('abort', () => {
              aborts++
            })
            return {
              [Symbol.asyncIterator]() {
                return {
                  next: () => next.promise,
                  return: (): Promise<IteratorResult<unknown>> => {
                    returns++
                    throw boom
                  }
                }
              }
            }
          }
        },
        {
          signal: new AbortController().signal
        }
      )
      terminateCoroutineHandle(handle)
      terminateCoroutineHandle(handle)
      await flush()
      expect(reports).toEqual([boom])
      next.resolve({ done: true, value: undefined })
      expect(await handle.exited).toEqual({ outcome: 'rejected', error: boom })
      await flush()
      expect(returns).toBe(1)
      expect(aborts).toBe(1)
      expect(unhandled).toBe(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
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
    gate.resolve()
    await stopped
    expect(cleaned).toBe(true)
    expect(aborted).toBe(1)
    expect(supervisor.inspect().lastExit?.reason).toBe('stopped')
  })

  it('turns a synchronous generator return failure into a fulfilled exited status', async () => {
    const scheduler = createManualScheduler()
    const boom = new Error('return failed')
    let returns = 0
    let aborts = 0
    let unhandled = 0
    const onUnhandled = (): void => {
      unhandled++
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const launcher = createCoroutineLauncher<undefined>(scheduler)
      const handle = await launcher.launch(
        {
          task: ({ signal }) => {
            signal.addEventListener('abort', () => {
              aborts++
            })
            return {
              [Symbol.asyncIterator]() {
                return {
                  next: () => new Promise<IteratorResult<unknown>>(() => undefined),
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
          signal: {
            aborted: false,
            addEventListener: () => undefined,
            removeEventListener: () => undefined
          }
        }
      )
      terminateCoroutineHandle(handle)
      terminateCoroutineHandle(handle)
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

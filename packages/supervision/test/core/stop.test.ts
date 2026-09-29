import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createMemoryLauncher } from '../support/memory-launcher.js'
import { createMemoryProfile } from '../support/memory-profile.js'

/** Flushes the release descriptor chain after a clock advance. */
async function flush(): Promise<void> {
  for (let index = 0; index < 35; index++) await Promise.resolve()
}

describe('A5 bounded stop', () => {
  it('drains before graceful termination and classifies a clean stop', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const order: string[] = []
    const profile = createMemoryProfile({ gracefulTermination: true, autoExitOnTerminate: true })
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: {
        ...profile,
        terminate(handle, mode) {
          order.push(mode)
          profile.terminate(handle, mode)
        }
      },
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      stop: {
        beforeTerminate: async () => {
          order.push('drain')
        }
      }
    })
    await supervisor.start()
    await supervisor.stop()
    expect(order).toEqual(['drain', 'graceful'])
    expect(supervisor.inspect().lastExit?.reason).toBe('stopped')
  })

  it('keeps the lease after reap timeout until exit actually fulfills', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const reported: unknown[] = []
    const budget = createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler })
    const supervisor = createSupervisor({
      id: 'memory',
      report: (error) => {
        reported.push(error)
      },
      spec: 'a',
      launcher,
      profile: createMemoryProfile(),
      budget,
      scheduler
    })
    await supervisor.start()
    const stopping = supervisor.stop()
    await flush()
    expect(launcher.launched[0]?.termination).toEqual(['force'])
    scheduler.advance(5_000)
    await stopping
    expect(supervisor.inspect().lastExit?.reason).toBe('abandoned')
    expect((reported[0] as { code?: string })?.code).toBe(SupervisionErrorCode.reapTimeout)
    expect(budget.inUse).toBe(1)
    launcher.launched[0]?.exit({ outcome: 'fulfilled' })
    await flush()
    expect(budget.inUse).toBe(0)
  })

  it('bounds drain and graceful exit before forcing a killed unit', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    let drainAborted = false
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ gracefulTermination: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      stop: {
        beforeTerminate: (_handle, signal) =>
          new Promise<void>(() => {
            signal.addEventListener('abort', () => {
              drainAborted = true
            })
          })
      }
    })
    await supervisor.start()
    const stopping = supervisor.stop()
    await flush()
    scheduler.advance(5_000)
    await flush()
    expect(drainAborted).toBe(true)
    expect(launcher.launched[0]?.termination).toEqual(['graceful'])
    scheduler.advance(5_000)
    await flush()
    expect(launcher.launched[0]?.termination).toEqual(['graceful', 'force'])
    launcher.launched[0]?.exit({ outcome: 'fulfilled' })
    await stopping
    expect(supervisor.inspect().lastExit?.reason).toBe('killed')
  })
})

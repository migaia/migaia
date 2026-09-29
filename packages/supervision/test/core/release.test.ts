import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, createUnitBudget, type IUnitBudget } from '../../src/index.js'
import { createMemoryLauncher } from '../support/memory-launcher.js'
import { createMemoryProfile } from '../support/memory-profile.js'

describe('A6 inverse scope release', () => {
  it('cancels monitors, then stops the unit, then releases attachments and lease', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const log: string[] = []
    const underlying = createUnitBudget({
      kind: 'memory',
      maxUnits: 1,
      launchRate: false,
      scheduler
    })
    const budget: IUnitBudget<'memory'> = {
      kind: 'memory',
      get inUse() {
        return underlying.inUse
      },
      get pending() {
        return underlying.pending
      },
      get closed() {
        return underlying.closed
      },
      close: () => underlying.close(),
      tryAcquire: () => underlying.tryAcquire(),
      async acquire(signal) {
        const result = await underlying.acquire(signal)
        if (result.kind === 'rejected') return result
        return {
          kind: 'granted',
          lease: {
            release() {
              log.push('lease')
              result.lease.release()
            }
          }
        }
      }
    }
    const profile = createMemoryProfile({ autoExitOnTerminate: true })
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: {
        ...profile,
        terminate(handle, mode) {
          log.push('terminate')
          profile.terminate(handle, mode)
        }
      },
      budget,
      scheduler,
      hooks: {
        afterLaunch(_handle, unit) {
          unit.scope.own(
            { attachment: true },
            {
              force: () => {
                log.push('attachment')
              }
            }
          )
          return Promise.resolve()
        },
        onReady(_handle, unit) {
          unit.monitors.own(
            { monitor: true },
            {
              force: () => {
                log.push('monitor')
              }
            }
          )
        }
      }
    })
    await supervisor.start()
    await supervisor.stop()
    expect(log).toEqual(['monitor', 'terminate', 'attachment', 'lease'])
  })
})

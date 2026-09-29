import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createMemoryLauncher } from '../support/memory-launcher.js'
import { createMemoryProfile } from '../support/memory-profile.js'

/** Flushes asynchronous checks and the queued failure command. */
async function flush(): Promise<void> {
  for (let index = 0; index < 40; index++) await Promise.resolve()
}

describe('A7 periodic health', () => {
  it('forces the unit after three consecutive rejected checks', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const failures = [new Error('one'), new Error('two'), new Error('three')]
    const finalFailure = failures[2]
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      restart: { mode: 'never' },
      health: {
        intervalMs: 5_000,
        timeoutMs: 2_000,
        failureThreshold: 3,
        check: () => Promise.reject(failures.shift())
      }
    })
    await supervisor.start()
    for (let index = 0; index < 3; index++) {
      scheduler.advance(5_000)
      await flush()
    }
    expect(launcher.launched[0]?.termination).toContain('force')
    expect(supervisor.inspect().lastExit?.reason).toBe('unhealthy')
    const error = supervisor.inspect().lastExit?.error as Error & { code?: string }
    expect(error.code).toBe(SupervisionErrorCode.unhealthy)
    expect(error.cause).toBe(finalFailure)
  })

  it('counts each timed out check and aborts its own signal', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const signals: Array<{ readonly aborted: boolean }> = []
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      restart: { mode: 'never' },
      health: {
        intervalMs: 5_000,
        timeoutMs: 2_000,
        failureThreshold: 3,
        check: (_handle, signal) => {
          signals.push(signal)
          return new Promise<void>(() => undefined)
        }
      }
    })
    await supervisor.start()
    for (let index = 0; index < 3; index++) {
      scheduler.advance(index === 0 ? 5_000 : 3_000)
      await flush()
      scheduler.advance(2_000)
      await flush()
    }
    expect(signals).toHaveLength(3)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(supervisor.inspect().lastExit?.reason).toBe('unhealthy')
    const error = supervisor.inspect().lastExit?.error as Error & {
      detail?: { timedOut?: boolean }
    }
    expect(error.detail?.timedOut).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createMemoryLauncher } from '../support/memory-launcher.js'
import { createMemoryProfile } from '../support/memory-profile.js'
import { createRecordingScheduler } from '../support/recording-scheduler.js'

/** Settles generation and timer continuations under the manual clock. */
async function flush(): Promise<void> {
  for (let index = 0; index < 35; index++) await Promise.resolve()
}

describe('A4 restart policy', () => {
  it('caps exponential delay and enters terminal once after the window limit', async () => {
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
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget,
      scheduler,
      restart: {
        maxRestarts: 2,
        windowMs: 10_000,
        initialDelayMs: 1_000,
        factor: 10,
        maxDelayMs: 5_000
      }
    })
    await supervisor.start()
    launcher.launched[0]?.exit({ outcome: 'rejected', error: new Error('first') })
    await flush()
    expect(supervisor.state).toBe('backoff')
    const joined = supervisor.start()
    await flush()
    expect(launcher.launched).toHaveLength(1)
    scheduler.advance(1_000)
    await flush()
    expect(launcher.launched).toHaveLength(2)
    expect((await joined).state).toBe('ready')
    launcher.launched[1]?.exit({ outcome: 'rejected', error: new Error('second') })
    await flush()
    scheduler.advance(4_999)
    await flush()
    expect(launcher.launched).toHaveLength(2)
    scheduler.advance(1)
    await flush()
    expect(launcher.launched).toHaveLength(3)
    launcher.launched[2]?.exit({ outcome: 'rejected', error: new Error('third') })
    await flush()
    expect(supervisor.state).toBe('terminal')
    expect((reported[0] as { code?: string })?.code).toBe(SupervisionErrorCode.supervisionExhausted)
    expect(reported).toHaveLength(1)
    expect(budget.inUse).toBe(0)
    expect(await supervisor.whenReady()).toEqual({ state: 'terminal' })
  })

  it('never restarts normally when the on-failure mode sees clean exit', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler
    })
    await supervisor.start()
    launcher.launched[0]?.exit({ outcome: 'fulfilled' })
    await flush()
    expect(supervisor.state).toBe('stopped')
    expect(supervisor.inspect().failuresInWindow).toBe(0)
  })

  it('keeps one unrefd cooldown timer and relaunches after it expires', async () => {
    const scheduler = createRecordingScheduler()
    const launcher = createMemoryLauncher()
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      restart: { mode: 'never' },
      terminalPolicy: { mode: 'cooldown', afterMs: 60_000 }
    })
    await supervisor.start()
    launcher.launched[0]?.exit({ outcome: 'rejected', error: new Error('crashed') })
    await flush()
    expect(supervisor.state).toBe('terminal')
    expect(scheduler.pendingCount).toBe(1)
    expect(scheduler.unrefCalls).toBe(1)
    scheduler.advance(60_000)
    await flush()
    expect(launcher.launched).toHaveLength(2)
    expect(supervisor.state).toBe('ready')
    await supervisor.stop()
  })
})

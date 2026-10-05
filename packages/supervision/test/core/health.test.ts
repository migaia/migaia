import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createMemoryLauncher, deferred } from '../support/memory-launcher.js'
import { createMemoryProfile } from '../support/memory-profile.js'

/** Flushes asynchronous checks and the queued failure command. */
async function flush(): Promise<void> {
  for (let index = 0; index < 40; index++) await Promise.resolve()
}

describe('A7 periodic health', () => {
  it('[A52] cold inspection exposes actual checks without launching another check', async () => {
    /** The original monitor remains the only clock and check owner. */
    const scheduler = createManualScheduler()
    /** Completion separates a pending check from an observed healthy result. */
    const checking = deferred<void>()
    /** Querying cannot run health work or manufacture a healthy state at readiness. */
    let checks = 0
    /** The canonical supervisor supplies both the unit and its existing monitor. */
    const supervisor = createSupervisor({
      id: 'health-detail',
      spec: 'a',
      launcher: createMemoryLauncher(),
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      report: () => undefined,
      health: {
        intervalMs: 10,
        timeoutMs: 5,
        check: () => {
          checks++
          return checking.promise
        }
      }
    })
    try {
      await supervisor.start()
      expect(supervisor.inspect().health, '[A52] unobserved health is explicit').toEqual({
        state: 'pending',
        failures: 0
      })
      expect(checks).toBe(0)
      scheduler.advance(10)
      await flush()
      expect(supervisor.inspect().health).toEqual({
        state: 'checking',
        failures: 0,
        observedAt: 10
      })
      checking.resolve()
      await flush()
      expect(supervisor.inspect().health).toEqual({ state: 'healthy', failures: 0, observedAt: 10 })
      expect(checks).toBe(1)
      await supervisor.stop()
      expect(supervisor.inspect().health).toBeUndefined()
    } finally {
      checking.resolve()
      await supervisor.dispose()
    }
  })
  it.each(['stop', 'dispose'] as const)(
    '[K247] clears timers when %s precedes a queued health failure continuation',
    async (operation) => {
      /** Manual time exposes any timer armed after the synchronous close fence. */
      const scheduler = createManualScheduler()
      /** One real supervisor unit, with retirement paused at its asynchronous boundary. */
      const launcher = createMemoryLauncher()
      /** Indicates that the health failure command has entered retirement. */
      const retiring = deferred<void>()
      /** Releases retirement only after stop/dispose has synchronously cleared timers. */
      const release = deferred<void>()
      /** Keep the canonical profile except for the deterministic retirement barrier. */
      const profile = createMemoryProfile({ autoExitOnTerminate: true })
      /** The failed health check must use the normal retry path with a 1ms backoff. */
      const supervisor = createSupervisor({
        id: 'health-close-race',
        report: () => undefined,
        spec: 'a',
        launcher,
        profile: {
          ...profile,
          async terminate(handle, mode) {
            retiring.resolve()
            await release.promise
            profile.terminate(handle, mode)
          }
        },
        budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
        scheduler,
        restart: { mode: 'always', initialDelayMs: 1 },
        health: {
          intervalMs: 5,
          timeoutMs: 2,
          failureThreshold: 1,
          check: () => Promise.reject(new Error('health failure fixture'))
        }
      })
      await supervisor.start()
      scheduler.advance(5)
      await retiring.promise
      /** Queue the close before the suspended failure command can arm its retry. */
      const closing = supervisor[operation]()
      release.resolve()
      await closing
      expect(scheduler.pendingCount).toBe(0)
      expect(supervisor.state).toBe(operation === 'dispose' ? 'disposed' : 'stopped')
      expect(launcher.launched).toHaveLength(1)
      await supervisor.dispose()
    }
  )
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

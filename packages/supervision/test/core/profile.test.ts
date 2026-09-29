import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createMemoryLauncher } from '../support/memory-launcher.js'
import { createMemoryProfile } from '../support/memory-profile.js'

/** Lets a failure callback complete its queued retirement. */
async function flush(): Promise<void> {
  for (let index = 0; index < 35; index++) await Promise.resolve()
}

describe('A10 profile admission and hooks', () => {
  it('rejects a mismatched budget and unsupported required termination', () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const profile = createMemoryProfile()
    const budget = createUnitBudget({ kind: 'other', maxUnits: 1, launchRate: false, scheduler })
    expect(() =>
      createSupervisor({
        id: 'memory',
        report: () => undefined,
        spec: 'a',
        launcher,
        profile,
        budget,
        scheduler
      })
    ).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.invalidOption,
        detail: { field: 'budget' }
      })
    )
    expect(() =>
      createSupervisor({
        id: 'memory',
        report: () => undefined,
        spec: 'a',
        launcher: { ...launcher, capabilities: { termination: 'cooperative' } },
        profile,
        budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
        scheduler
      })
    ).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.capabilityUnsupported,
        detail: { capability: 'termination', level: 'cooperative', kind: 'memory' }
      })
    )
  })

  it('reports degraded capability once and preserves inspect data', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const reported: unknown[] = []
    const supervisor = createSupervisor({
      id: 'memory',
      report: (error) => {
        reported.push(error)
      },
      spec: 'a',
      launcher: { ...launcher, capabilities: { termination: 'cooperative' } },
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      isolation: 'best-effort',
      hooks: { inspectUnit: () => ({ mark: 1 }) }
    })
    await supervisor.start()
    expect(supervisor.inspect().degraded).toEqual(['termination'])
    expect(supervisor.inspect().unit).toEqual({ mark: 1 })
    expect((reported[0] as { code?: string })?.code).toBe(
      SupervisionErrorCode.capabilityUnsupported
    )
    await supervisor.stop()
    await supervisor.start()
    await flush()
    expect(reported).toHaveLength(1)
    await supervisor.stop()
  })
})

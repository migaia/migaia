import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createProcessSupervisor } from '../../src/process/index.js'
import { memoryProcessLauncher, processSpec } from './support/memory-process-launcher.js'

/** Settles microtasks queued by a sample and the supervisor command queue. */
async function settle(): Promise<void> {
  for (let index = 0; index < 20; index++) await Promise.resolve()
}

describe('A4 monitored usage', () => {
  it('forces a unit only after a sampled memory violation', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher({
      termination: 'enforced',
      'fault-isolation': 'enforced',
      'memory-limit': 'monitored'
    })
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const report: unknown[] = []
    const supervisor = createProcessSupervisor({
      id: 'usage',
      spec: { ...processSpec(), limits: { memoryBytes: 100 } },
      launcher,
      budget,
      scheduler,
      report: (error) => {
        report.push(error)
      },
      restart: { mode: 'never' }
    })
    await supervisor.start()
    const handle = launcher.handles[0]!
    let observed = 50
    handle.setUsage(async () => ({ rssBytes: observed }))
    scheduler.advance(1_000)
    await settle()
    expect(handle.terminations).toEqual([])
    observed = 150
    scheduler.advance(1_000)
    await settle()
    expect(handle.terminations).toContain('force')
    expect(supervisor.inspect().lastExit?.reason).toBe('resource-violation')
    expect(supervisor.inspect().lastExit?.error).toMatchObject({
      code: SupervisionErrorCode.resourceLimitExceeded
    })
    await supervisor.dispose()
    expect(scheduler.pendingCount).toBe(0)
  })

  it('skips overlapping samples and preserves the last rejection as unhealthy cause', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher({
      termination: 'enforced',
      'fault-isolation': 'enforced',
      'cpu-time-limit': 'monitored'
    })
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const supervisor = createProcessSupervisor({
      id: 'health',
      spec: { ...processSpec(), limits: { cpuTimeMs: 100 } },
      launcher,
      budget,
      scheduler,
      report: () => undefined,
      usage: { intervalMs: 1_000, failureThreshold: 3 },
      restart: { mode: 'never' }
    })
    await supervisor.start()
    const handle = launcher.handles[0]!
    let calls = 0
    let release: ((usage: { cpuTimeMs: number }) => void) | undefined
    handle.setUsage(() => {
      calls++
      return new Promise((resolve) => {
        release = resolve
      })
    })
    scheduler.advance(1_000)
    await settle()
    scheduler.advance(1_000)
    await settle()
    expect(calls).toBe(1)
    release?.({ cpuTimeMs: 50 })
    await settle()
    const rejection = new Error('sample failed')
    handle.setUsage(async () => {
      throw rejection
    })
    for (let index = 0; index < 3; index++) {
      scheduler.advance(1_000)
      await settle()
    }
    expect(supervisor.inspect().lastExit?.reason).toBe('unhealthy')
    expect((supervisor.inspect().lastExit!.error as Error).cause).toBe(rejection)
    await supervisor.dispose()
  })

  it('does not sample enforced limits or a declared wall-time limit', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher({
      termination: 'enforced',
      'fault-isolation': 'enforced',
      'memory-limit': 'enforced'
    })
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const spec = { ...processSpec(), limits: { memoryBytes: 100, callWallTimeMs: 2_000 } }
    const supervisor = createProcessSupervisor({
      id: 'enforced',
      spec,
      launcher,
      budget,
      scheduler,
      report: () => undefined
    })
    await supervisor.start()
    let calls = 0
    launcher.handles[0]!.setUsage(async () => {
      calls++
      return { rssBytes: 1_000 }
    })
    scheduler.advance(10_000)
    await settle()
    expect(calls).toBe(0)
    expect(launcher.specs[0]).toBe(spec)
    expect(launcher.specs[0]?.limits?.callWallTimeMs).toBe(2_000)
    await supervisor.dispose()
  })
})

import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createPrewarmPool } from '../../src/process/index.js'
import { memoryProcessLauncher, processSpec } from './support/memory-process-launcher.js'
import { memoryRegistry } from './support/memory-registry.js'

/** Settles pool launches and ordered release callbacks. */
async function settle(): Promise<void> {
  for (let index = 0; index < 100; index++) await Promise.resolve()
}

describe('A10 bounded idle unit pool', () => {
  it('registers and budgets idle units without crash-driven respawn', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher()
    const registry = memoryRegistry()
    const budget = createUnitBudget({ kind: 'process', maxUnits: 3, scheduler })
    const reports: unknown[] = []
    const pool = createPrewarmPool({
      id: 'pool',
      spec: processSpec(),
      launcher,
      budget,
      size: 2,
      scheduler,
      registry: { port: registry.port, namespace: 'test' },
      report: (error) => {
        reports.push(error)
      }
    })
    await settle()
    expect(launcher.handles).toHaveLength(2)
    expect(pool.idle).toBe(2)
    expect(budget.inUse).toBe(2)
    expect(registry.records.size).toBe(2)
    launcher.handles[0]!.complete({ code: 1, signal: null })
    await settle()
    expect(pool.idle).toBe(1)
    expect(launcher.handles).toHaveLength(2)
    expect(registry.records.size).toBe(1)
    expect(budget.inUse).toBe(1)
    expect(
      reports.some(
        (error) => (error as { code?: string }).code === SupervisionErrorCode.exitUnexpected
      )
    ).toBe(true)
    await pool.dispose()
    expect(budget.inUse).toBe(0)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('uses nonqueuing leases and retires idle units at their deadline', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher()
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const pool = createPrewarmPool({
      id: 'pool',
      spec: processSpec(),
      launcher,
      budget,
      size: 2,
      scheduler,
      idleTimeoutMs: 60_000,
      report: () => undefined
    })
    await settle()
    expect(pool.idle).toBe(1)
    expect(budget.pending).toBe(0)
    scheduler.advance(60_000)
    await settle()
    expect(launcher.handles[0]!.terminations).toContain('graceful')
    expect(pool.idle).toBe(0)
    expect(budget.inUse).toBe(0)
    expect(launcher.handles).toHaveLength(1)
    await pool.dispose()
  })

  it('retains the lease across a timed-out launch until the late unit exits', async () => {
    const scheduler = createManualScheduler()
    const base = memoryProcessLauncher()
    const spec = processSpec()
    let releaseLaunch: ((handle: (typeof base.handles)[number]) => void) | undefined
    let captured: Parameters<typeof base.launch>[1] | undefined
    const launcher = {
      ...base,
      launch: async (_spec: typeof spec, context: Parameters<typeof base.launch>[1]) => {
        captured = context
        return new Promise<(typeof base.handles)[number]>((resolve) => {
          releaseLaunch = resolve
        })
      }
    }
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const reports: unknown[] = []
    const pool = createPrewarmPool({
      id: 'late',
      spec,
      launcher,
      budget,
      size: 1,
      scheduler,
      startupTimeoutMs: 1_000,
      reapTimeoutMs: 1_000,
      report: (error) => {
        reports.push(error)
      }
    })
    await settle()
    scheduler.advance(1_000)
    await settle()
    expect(budget.inUse).toBe(1)
    scheduler.advance(1_000)
    await settle()
    expect(budget.inUse).toBe(1)
    expect(
      reports.some(
        (error) => (error as { code?: string }).code === SupervisionErrorCode.reapTimeout
      )
    ).toBe(true)
    const late = await base.launch(spec, captured!)
    releaseLaunch?.(late)
    await settle()
    expect(late.terminations).toContain('force')
    expect(budget.inUse).toBe(0)
    await pool.dispose()
  })

  it('retires a sampled idle violation and does not launch a replacement', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher({
      termination: 'enforced',
      'fault-isolation': 'enforced',
      'memory-limit': 'monitored'
    })
    const budget = createUnitBudget({ kind: 'process', maxUnits: 2, scheduler })
    const reports: unknown[] = []
    const pool = createPrewarmPool({
      id: 'sampled',
      spec: { ...processSpec(), limits: { memoryBytes: 100 } },
      launcher,
      budget,
      size: 1,
      scheduler,
      report: (error) => {
        reports.push(error)
      }
    })
    await settle()
    launcher.handles[0]!.setUsage(async () => ({ rssBytes: 150 }))
    scheduler.advance(1_000)
    await settle()
    expect(launcher.handles[0]!.terminations).toContain('force')
    expect(pool.idle).toBe(0)
    expect(launcher.handles).toHaveLength(1)
    expect(
      reports.some(
        (error) => (error as { code?: string }).code === SupervisionErrorCode.resourceLimitExceeded
      )
    ).toBe(true)
    await pool.dispose()
  })

  it('releases an unlaunched lease after an adapter rejection', async () => {
    const scheduler = createManualScheduler()
    const base = memoryProcessLauncher()
    const cause = new Error('launch failed')
    const launcher = {
      ...base,
      launch: async () => {
        throw cause
      }
    }
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const reports: unknown[] = []
    const pool = createPrewarmPool({
      id: 'failed',
      spec: processSpec(),
      launcher,
      budget,
      size: 1,
      scheduler,
      report: (error) => {
        reports.push(error)
      }
    })
    await settle()
    expect(pool.idle).toBe(0)
    expect(budget.inUse).toBe(0)
    expect(
      reports.some(
        (error) => (error as { code?: string }).code === SupervisionErrorCode.launchFailed
      )
    ).toBe(true)
    await pool.dispose()
  })
})

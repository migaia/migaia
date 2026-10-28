import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import {
  createSupervisor,
  createUnitBudget,
  SupervisionErrorCode,
  SUPERVISION_SOURCE,
  type ISupervisorEvent
} from '../../src/index.ts'
import { createMemoryLauncher, type IMemoryHandle } from '../support/memory-launcher.ts'
import { createMemoryProfile } from '../support/memory-profile.ts'

/** Flushes the release descriptor chain after a clock advance. */
async function flush(): Promise<void> {
  for (let index = 0; index < 35; index++) await Promise.resolve()
}

describe('bounded stop', () => {
  it('abandons explicitly unobservable exit immediately and reports once across repeated disposal', async () => {
    /** Virtual time must stay at zero when recovery knows exit cannot be observed. */
    const scheduler = createManualScheduler()
    /** Native exit stays pending until the test proves the abandoned lease remains held. */
    const memory = createMemoryLauncher()
    /** This declaration is the boundary under test, independent of host detection. */
    const launcher = {
      ...memory,
      capabilities: { ...memory.capabilities, 'exit-observation': 'unsupported' as const }
    }
    /** Only recovery diagnostics are emitted because memory requires enforced termination. */
    const reported: unknown[] = []
    /** Exit events remain reserved for actual exit after the abandoned diagnostic publication. */
    const exits: ISupervisorEvent<IMemoryHandle>[] = []
    /** Abandoning recovery must not advertise an unconfirmed free unit slot. */
    const budget = createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler })
    /** Owns the controlled unit through the same public disposal path as thread adapters. */
    const supervisor = createSupervisor({
      id: 'unobservable',
      report: (error) => {
        reported.push(error)
      },
      spec: 'a',
      launcher,
      profile: createMemoryProfile(),
      budget,
      scheduler,
      stop: { reapTimeoutMs: 5_000 }
    })
    supervisor.subscribe((event) => {
      if (event.type === 'exit') exits.push(event)
    })
    await supervisor.start()
    /** Completion is observed without advancing the scheduler to the recovery deadline. */
    let disposed = false
    /** Concurrent and repeated disposal must share one recovery operation. */
    const disposing = supervisor.dispose().then(() => {
      disposed = true
    })
    await flush()
    /** Fallback advances only broken code, exposing its actual REAP_TIMEOUT before assertion. */
    const immediate = disposed
    if (!immediate) scheduler.advance(5_000)
    await disposing
    expect(reported).toMatchObject([
      {
        source: SUPERVISION_SOURCE,
        code: SupervisionErrorCode.exitUnobservable,
        name: 'Error',
        detail: { kind: 'memory', generation: 1, capability: 'exit-observation' }
      }
    ])
    expect(immediate).toBe(true)
    expect(scheduler.now()).toBe(0)
    expect(scheduler.pendingCount).toBe(0)
    expect(memory.launched[0]?.termination).toEqual(['force'])
    expect(supervisor.inspect().abandoned).toBe(1)
    expect(supervisor.inspect().lastExit).toMatchObject({
      reason: 'abandoned',
      error: reported[0]
    })
    expect(exits).toHaveLength(0)
    expect(budget.inUse).toBe(1)
    await supervisor.dispose()
    expect(reported).toHaveLength(1)
    expect(exits).toHaveLength(0)
    expect(memory.launched[0]?.termination).toEqual(['force'])
    memory.launched[0]?.exit({ outcome: 'fulfilled' })
    await flush()
    expect(budget.inUse).toBe(0)
    expect(reported).toHaveLength(1)
    expect(exits).toHaveLength(1)
    expect(exits[0]).toMatchObject({ reason: 'abandoned', error: reported[0] })
  })

  it('keeps the recovery deadline when observable exit never settles', async () => {
    /** A supported observation path must retain its real recovery timeout. */
    const scheduler = createManualScheduler()
    /** Controlled exit remains pending throughout the recovery deadline. */
    const memory = createMemoryLauncher()
    /** Enforced observation distinguishes an actual timeout from a declared host boundary. */
    const launcher = {
      ...memory,
      capabilities: { ...memory.capabilities, 'exit-observation': 'enforced' as const }
    }
    /** Captures the single actual recovery failure. */
    const reported: unknown[] = []
    /** Budget ownership continues until the original observed unit really exits. */
    const budget = createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler })
    /** Uses the public disposal path with an explicit observable launcher declaration. */
    const supervisor = createSupervisor({
      id: 'observable-pending',
      report: (error) => {
        reported.push(error)
      },
      spec: 'a',
      launcher,
      profile: createMemoryProfile(),
      budget,
      scheduler,
      stop: { reapTimeoutMs: 5_000 }
    })
    await supervisor.start()
    /** Pending exit must block disposal until the finite deadline. */
    let disposed = false
    /** Awaits only the same controlled recovery sequence. */
    const disposing = supervisor.dispose().then(() => {
      disposed = true
    })
    await flush()
    expect(disposed).toBe(false)
    scheduler.advance(4_999)
    await flush()
    expect(disposed).toBe(false)
    expect(reported).toEqual([])
    scheduler.advance(1)
    await disposing
    expect(reported).toMatchObject([
      { source: SUPERVISION_SOURCE, code: SupervisionErrorCode.reapTimeout, name: 'Error' }
    ])
    expect(supervisor.inspect().lastExit?.reason).toBe('abandoned')
    expect(budget.inUse).toBe(1)
    memory.launched[0]?.exit({ outcome: 'fulfilled' })
    await flush()
    expect(budget.inUse).toBe(0)
  })

  it('reports no recovery error when enforced observation confirms exit', async () => {
    /** Confirmed exit completes without consuming any virtual recovery time. */
    const scheduler = createManualScheduler()
    /** The profile resolves this launcher's exact exited promise on termination. */
    const memory = createMemoryLauncher()
    /** Explicit enforcement follows the unchanged observable-unit path. */
    const launcher = {
      ...memory,
      capabilities: { ...memory.capabilities, 'exit-observation': 'enforced' as const }
    }
    /** A clean confirmed stop has no diagnostic failure. */
    const reported: unknown[] = []
    /** Confirmed exit releases the original unit lease. */
    const budget = createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler })
    /** Owns one immediately exiting unit through the public disposal path. */
    const supervisor = createSupervisor({
      id: 'observable-exited',
      report: (error) => {
        reported.push(error)
      },
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget,
      scheduler
    })
    await supervisor.start()
    await supervisor.dispose()
    expect(reported).toEqual([])
    expect(supervisor.inspect().abandoned).toBe(0)
    expect(scheduler.now()).toBe(0)
    expect(budget.inUse).toBe(0)
  })

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

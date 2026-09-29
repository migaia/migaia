import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createMemoryLauncher, deferred } from '../support/memory-launcher.js'
import { createMemoryProfile } from '../support/memory-profile.js'

/** Lets the candidate pass its budget and launch continuations. */
async function flush(): Promise<void> {
  for (let index = 0; index < 25; index++) await Promise.resolve()
}

describe('A8 replacement', () => {
  it('keeps the old unit serving until the new unit becomes ready', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const candidateReady = deferred<void>()
    const budget = createUnitBudget({ kind: 'memory', maxUnits: 2, launchRate: false, scheduler })
    let readyCalls = 0
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget,
      scheduler,
      ready: () => (++readyCalls === 1 ? Promise.resolve() : candidateReady.promise)
    })
    const switched: number[] = []
    supervisor.subscribe((event) => {
      if (event.type === 'switched') switched.push(event.to)
    })
    await supervisor.start()
    const original = launcher.launched[0]!
    const replacement = supervisor.replace({ strategy: 'start-then-switch' })
    await flush()
    expect(budget.inUse).toBe(2)
    expect(original.termination).toEqual([])
    expect(await supervisor.whenReady()).toMatchObject({ generation: 1, unit: original })
    candidateReady.resolve()
    expect(await replacement).toEqual({ kind: 'replaced', generation: 2 })
    expect(switched).toEqual([2])
    expect(original.termination).toEqual(['force'])
    expect(await supervisor.whenReady()).toMatchObject({
      generation: 2,
      unit: launcher.launched[1]
    })
    expect(budget.inUse).toBe(1)
    await supervisor.stop()
  })

  it('rejects candidate admission without touching the old unit', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const budget = createUnitBudget({
      kind: 'memory',
      maxUnits: 1,
      overflow: 'reject',
      launchRate: false,
      scheduler
    })
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget,
      scheduler
    })
    await supervisor.start()
    expect(await supervisor.replace({ strategy: 'start-then-switch' })).toEqual({
      kind: 'rejected',
      reason: 'full'
    })
    expect(launcher.launched[0]?.termination).toEqual([])
    await supervisor.stop()
  })

  it('retains the old unit after a candidate startup timeout', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const budget = createUnitBudget({ kind: 'memory', maxUnits: 2, launchRate: false, scheduler })
    let readyCalls = 0
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget,
      scheduler,
      ready: () => (++readyCalls === 1 ? Promise.resolve() : new Promise<void>(() => undefined))
    })
    await supervisor.start()
    const replacement = supervisor.replace({ strategy: 'start-then-switch' })
    await flush()
    scheduler.advance(10_000)
    await flush()
    const result = await replacement
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed')
      expect((result.error as { code?: string }).code).toBe(SupervisionErrorCode.startupTimeout)
    expect(launcher.launched[0]?.termination).toEqual([])
    expect((await supervisor.whenReady()).state).toBe('ready')
    expect(budget.inUse).toBe(1)
    await supervisor.stop()
  })

  it('continues to enforce old-unit health while a candidate waits for ready', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const readyGate = deferred<void>()
    let readyCalls = 0
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 2, launchRate: false, scheduler }),
      scheduler,
      ready: () => (++readyCalls === 1 ? Promise.resolve() : readyGate.promise),
      health: {
        intervalMs: 5_000,
        failureThreshold: 1,
        check: () => Promise.reject(new Error('unhealthy'))
      }
    })
    await supervisor.start()
    const original = launcher.launched[0]!
    const replacement = supervisor.replace({ strategy: 'start-then-switch' })
    await flush()
    scheduler.advance(5_000)
    await flush()
    expect(original.termination).toContain('force')
    readyGate.resolve()
    await replacement
    await supervisor.stop()
  })
})

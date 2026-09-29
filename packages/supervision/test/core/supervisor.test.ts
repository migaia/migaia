import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import {
  createSupervisor,
  createUnitBudget,
  SupervisionErrorCode,
  SUPERVISION_SOURCE
} from '../../src/index.js'
import { deferred, createMemoryLauncher } from '../support/memory-launcher.js'
import { createMemoryProfile } from '../support/memory-profile.js'

/** Advances pending lifecycle and queue continuations. */
async function flush(): Promise<void> {
  for (let index = 0; index < 20; index++) await Promise.resolve()
}

describe('A3 supervisor startup', () => {
  it('moves from queued through starting to ready after the ready hook', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const ready = deferred<void>()
    const events: string[] = []
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      ready: () => ready.promise
    })
    supervisor.subscribe((event) => {
      if (event.type === 'state') events.push(`${event.from}->${event.to}`)
    })
    const started = supervisor.start()
    await flush()
    expect(events.slice(0, 2)).toEqual(['idle->queued', 'queued->starting'])
    ready.resolve()
    expect(await started).toMatchObject({ state: 'ready', generation: 1 })
    expect(await supervisor.whenReady()).toMatchObject({
      state: 'ready',
      generation: 1,
      unit: launcher.launched[0]
    })
    expect(events[2]).toBe('starting->ready')
    await supervisor.stop()
  })

  it('forces a startup timeout at its exact scheduler deadline', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const reported: unknown[] = []
    const supervisor = createSupervisor({
      id: 'memory',
      report: (error) => {
        reported.push(error)
      },
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      ready: () => new Promise<void>(() => undefined)
    })
    const started = supervisor.start()
    await flush()
    scheduler.advance(10_000)
    await flush()
    expect(launcher.launched[0]?.termination).toContain('force')
    expect(supervisor.inspect().lastExit?.reason).toBe('startup-timeout')
    expect((supervisor.inspect().lastExit?.error as { code?: string })?.code).toBe(
      SupervisionErrorCode.startupTimeout
    )
    expect((supervisor.inspect().lastExit?.error as { source?: string })?.source).toBe(
      SUPERVISION_SOURCE
    )
    await started
  })

  it('retains a lease for a never-settling launch and reaps its late handle', async () => {
    const scheduler = createManualScheduler()
    const late = deferred<Awaited<ReturnType<ReturnType<typeof createMemoryLauncher>['launch']>>>()
    const memory = createMemoryLauncher()
    const budget = createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler })
    const reported: unknown[] = []
    const supervisor = createSupervisor({
      id: 'memory',
      report: (error) => {
        reported.push(error)
      },
      spec: 'a',
      launcher: { capabilities: memory.capabilities, launch: () => late.promise },
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget,
      scheduler
    })
    const started = supervisor.start()
    await flush()
    const stopped = supervisor.stop()
    await flush()
    scheduler.advance(5_000)
    await stopped
    await started
    expect(budget.inUse).toBe(1)
    expect(supervisor.inspect().abandoned).toBe(1)
    expect((reported[0] as { code?: string })?.code).toBe(SupervisionErrorCode.reapTimeout)
    const handle = await memory.launch('a', {
      signal: {
        aborted: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      }
    })
    late.resolve(handle)
    await flush()
    expect(handle.termination).toEqual(['force'])
    expect(budget.inUse).toBe(0)
  })

  it('preserves launch and attachment failures on a coded error chain', async () => {
    const scheduler = createManualScheduler()
    const launchFailure = new Error('launch rejected')
    const memory = createMemoryLauncher()
    const profile = createMemoryProfile({ autoExitOnTerminate: true })
    const failed = createSupervisor({
      id: 'launch',
      report: () => undefined,
      spec: 'a',
      launcher: { capabilities: memory.capabilities, launch: () => Promise.reject(launchFailure) },
      profile,
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler
    })
    await failed.start()
    const launchError = failed.inspect().lastExit?.error as Error & {
      code?: string
      detail?: { phase?: string }
    }
    expect(launchError.code).toBe(SupervisionErrorCode.launchFailed)
    expect(launchError.detail?.phase).toBe('launch')
    expect(launchError.cause).toBe(launchFailure)

    const attachmentFailure = new Error('attachment rejected')
    const attached = createSupervisor({
      id: 'attach',
      report: () => undefined,
      spec: 'a',
      launcher: memory,
      profile,
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      hooks: { afterLaunch: () => Promise.reject(attachmentFailure) }
    })
    await attached.start()
    const attachError = attached.inspect().lastExit?.error as Error & {
      code?: string
      detail?: { phase?: string }
    }
    expect(attachError.code).toBe(SupervisionErrorCode.launchFailed)
    expect(attachError.detail?.phase).toBe('attach')
    expect(attachError.cause).toBe(attachmentFailure)
  })
})

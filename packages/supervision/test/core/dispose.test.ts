import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import {
  createSupervisor,
  createUnitBudget,
  SupervisionErrorCode,
  type ISupervisor
} from '../../src/index.js'
import { createMemoryLauncher, type IMemoryHandle } from '../support/memory-launcher.js'
import { createMemoryProfile } from '../support/memory-profile.js'

/** Advances the queued disposal and release descriptor continuations. */
async function flush(): Promise<void> {
  for (let index = 0; index < 35; index++) await Promise.resolve()
}

describe('A9 disposal', () => {
  it('shares the bounded stop promise and distinguishes closing from terminal', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const supervisor = createSupervisor({
      id: 'memory',
      report: () => undefined,
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      stop: { beforeTerminate: () => new Promise<void>(() => undefined) }
    })
    await supervisor.start()
    const disposing = supervisor.dispose()
    expect(supervisor.dispose()).toBe(disposing)
    expect(supervisor.stop()).toBe(disposing)
    await expect(supervisor.start()).rejects.toMatchObject({
      code: SupervisionErrorCode.scopeClosed
    })
    await expect(supervisor.restart()).rejects.toMatchObject({
      code: SupervisionErrorCode.scopeClosed
    })
    await expect(supervisor.replace()).rejects.toMatchObject({
      code: SupervisionErrorCode.scopeClosed
    })
    expect(await supervisor.whenReady()).toEqual({ state: 'disposed' })
    await flush()
    scheduler.advance(5_000)
    await disposing
    expect(supervisor.state).toBe('disposed')
    await expect(supervisor.start()).rejects.toMatchObject({
      code: SupervisionErrorCode.scopeTerminal
    })
  })

  it('allows a ready hook to await stop without a queue self dependency', async () => {
    const scheduler = createManualScheduler()
    const launcher = createMemoryLauncher()
    const reported: unknown[] = []
    let supervisor!: ISupervisor<IMemoryHandle, string>
    supervisor = createSupervisor({
      id: 'memory',
      report: (error) => {
        reported.push(error)
      },
      spec: 'a',
      launcher,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      ready: async () => {
        await supervisor.stop()
      }
    })
    const started = supervisor.start()
    await flush()
    expect((await started).state).not.toBe('ready')
    expect(supervisor.state).toBe('stopped')
    expect(
      reported.some((error) => (error as { code?: string }).code === 'QUEUE_SELF_DEPENDENCY')
    ).toBe(false)
  })
})

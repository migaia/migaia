import { expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { createSupervisor, createUnitBudget, type ISupervisorEvent } from '../../src/index.ts'
import { createMemoryLauncher, type IMemoryHandle } from '../support/memory-launcher.ts'
import { createMemoryProfile } from '../support/memory-profile.ts'

/** Flushes promise continuations after an exit. */
async function flush(): Promise<void> {
  for (let index = 0; index < 35; index++) await Promise.resolve()
}

it('publishes an exit the profile cannot classify as an unexpected crash', async () => {
  const scheduler = createManualScheduler()
  const launcher = createMemoryLauncher()
  /** Failure thrown by the profile's classifier. */
  const classifyFailure = new Error('classifier failed')
  const profile = {
    ...createMemoryProfile(),
    classifyExit(): never {
      throw classifyFailure
    }
  }
  const exits: ISupervisorEvent<IMemoryHandle>[] = []
  const supervisor = createSupervisor({
    id: 'unclassifiable',
    report: () => {},
    spec: 'a',
    launcher,
    profile,
    budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler }),
    scheduler
  })
  supervisor.subscribe((event) => {
    if (event.type === 'exit') exits.push(event)
  })
  await supervisor.start()
  launcher.launched[0]!.exit({ outcome: 'fulfilled' })
  await flush()
  expect(exits).toHaveLength(1)
  expect(exits[0]).toMatchObject({ reason: 'crashed', error: { code: 'EXIT_UNEXPECTED' } })
  expect((exits[0] as { error: Error }).error.cause).toBe(classifyFailure)
  const disposing = supervisor.dispose()
  await flush()
  scheduler.advance(10_000)
  await flush()
  await disposing
})

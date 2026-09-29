import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createThreadSupervisor, ThreadUnitKind } from '../../src/threads/index.js'
import { memoryThreadLauncher, settle, threadSpec } from './support/memory-thread-launcher.js'

describe('A2 thread budget', () => {
  it('rejects wrong budget kinds at both type and runtime boundaries', () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher()
    const processBudget = createUnitBudget({ kind: 'process', maxUnits: 4, scheduler })
    expect(() =>
      createThreadSupervisor({
        id: 'wrong',
        launcher,
        spec: threadSpec(),
        scheduler,
        report: () => undefined,
        // @ts-expect-error a process budget cannot own a thread
        budget: processBudget
      })
    ).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.invalidOption,
        detail: expect.objectContaining({ field: 'budget' })
      })
    )
    expect(() =>
      createUnitBudget({
        kind: ThreadUnitKind.thread,
        maxUnits: 1,
        parent: processBudget as never,
        scheduler
      })
    ).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.invalidOption,
        detail: expect.objectContaining({ field: 'parent' })
      })
    )
    expect(launcher.handles).toHaveLength(0)
  })

  it('queues another thread until actual exit releases the shared slot', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher(undefined, false)
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
    const make = (id: string) =>
      createThreadSupervisor({
        id,
        launcher,
        spec: threadSpec(),
        budget,
        scheduler,
        report: () => undefined
      })
    const first = make('first')
    const second = make('second')
    await first.start()
    const waiting = second.start()
    await settle()
    expect(second.inspect().state).toBe('queued')
    expect(launcher.handles).toHaveLength(1)
    const stopping = first.stop()
    await settle()
    expect(launcher.handles[0]?.terminations).toBe(1)
    expect(launcher.handles).toHaveLength(1)
    launcher.handles[0]!.complete({ code: null })
    await stopping
    await waiting
    expect(launcher.handles).toHaveLength(2)
    await first.dispose()
    const secondStop = second.stop()
    await settle()
    launcher.handles[1]!.complete({ code: null })
    await secondStop
    await second.dispose()
  })

  it('returns a full rejection without launching when overflow rejects', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher()
    const budget = createUnitBudget({
      kind: ThreadUnitKind.thread,
      maxUnits: 0,
      overflow: 'reject',
      scheduler
    })
    const supervisor = createThreadSupervisor({
      id: 'full',
      launcher,
      spec: threadSpec(),
      budget,
      scheduler,
      report: () => undefined
    })
    expect(await supervisor.start()).toEqual({ state: 'stopped', rejection: 'full' })
    expect(launcher.handles).toHaveLength(0)
    await supervisor.dispose()
  })
})

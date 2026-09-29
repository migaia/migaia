import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createProcessSupervisor } from '../../src/process/index.js'
import { memoryProcessLauncher, processSpec } from './support/memory-process-launcher.js'

/** Allows exit observers and queued state transitions to settle. */
async function settle(): Promise<void> {
  for (let index = 0; index < 20; index++) await Promise.resolve()
}

describe('A6 core process profile', () => {
  it('classifies clean exit and reports terminal entry only once', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher()
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const reports: unknown[] = []
    const supervisor = createProcessSupervisor({
      id: 'profile',
      spec: processSpec(),
      launcher,
      budget,
      scheduler,
      report: (error) => {
        reports.push(error)
      },
      restart: { maxRestarts: 0 }
    })
    await supervisor.start()
    launcher.handles[0]!.complete()
    await settle()
    expect(supervisor.inspect().lastExit?.reason).toBe('exited')
    expect(reports).toHaveLength(0)
    await supervisor.start()
    launcher.handles[1]!.complete({ code: 1, signal: null })
    await settle()
    expect(supervisor.inspect().state).toBe('terminal')
    expect(supervisor.inspect().terminalEntries).toBe(1)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ code: SupervisionErrorCode.supervisionExhausted })
    expect((reports[0] as Error).cause).toMatchObject({
      code: SupervisionErrorCode.exitUnexpected,
      detail: { code: 1, signal: null, kind: 'process' }
    })
    await supervisor.dispose()
  })

  it('rejects a non-process budget before launch', () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher()
    expect(() =>
      createProcessSupervisor({
        id: 'wrong-budget',
        spec: processSpec(),
        launcher,
        budget: createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler }) as never,
        scheduler,
        report: () => undefined
      })
    ).toThrowError(expect.objectContaining({ code: SupervisionErrorCode.invalidOption }))
    expect(launcher.handles).toHaveLength(0)
  })

  it('requests graceful termination before force escalation', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher(undefined, false)
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const supervisor = createProcessSupervisor({
      id: 'stop',
      spec: processSpec(),
      launcher,
      budget,
      scheduler,
      report: () => undefined
    })
    await supervisor.start()
    const handle = launcher.handles[0]!
    const stopping = supervisor.stop()
    await settle()
    expect(handle.terminations).toEqual(['graceful'])
    scheduler.advance(5_000)
    await settle()
    expect(handle.terminations).toEqual(['graceful', 'force'])
    handle.complete({ code: null, signal: 'SIGKILL' })
    await stopping
    await supervisor.dispose()
  })
})

import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createThreadSupervisor, ThreadUnitKind } from '../../src/threads/index.js'
import { memoryThreadLauncher, settle, threadSpec } from './support/memory-thread-launcher.js'

describe('A7 bounded thread stop', () => {
  it('drains before one termination and observes the actual exit', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher()
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
    const supervisor = createThreadSupervisor({
      id: 'drain',
      spec: threadSpec(),
      launcher,
      budget,
      scheduler,
      report: () => undefined,
      stop: {
        beforeTerminate: async () => {
          launcher.events.push('drain')
        }
      }
    })
    await supervisor.start()
    await supervisor.stop()
    expect(launcher.events).toEqual(['launch', 'drain', 'terminate', 'exited'])
    expect(launcher.handles[0]?.terminations).toBe(1)
    expect(supervisor.inspect().lastExit?.reason).toBe('stopped')
    expect(budget.inUse).toBe(0)
    await supervisor.dispose()
  })

  it('bounds a stuck drain and does not enter a graceful termination phase', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher()
    const signals: Array<{ readonly aborted: boolean }> = []
    const supervisor = createThreadSupervisor({
      id: 'drain-timeout',
      spec: threadSpec(),
      launcher,
      budget: createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler }),
      scheduler,
      report: () => undefined,
      stop: {
        beforeTerminate: (_handle, signal) => {
          signals.push(signal)
          return new Promise<void>(() => undefined)
        }
      }
    })
    await supervisor.start()
    const stopping = supervisor.stop()
    await settle()
    expect(launcher.handles[0]?.terminations).toBe(0)
    scheduler.advance(5_000)
    await settle()
    expect(signals[0]?.aborted).toBe(true)
    expect(launcher.handles[0]?.terminations).toBe(1)
    await stopping
    expect(supervisor.inspect().lastExit?.reason).toBe('killed')
    await supervisor.dispose()
  })

  it('reports reap timeout once, retains the lease, and releases it after late exit', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher(undefined, false)
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
    const reports: unknown[] = []
    const supervisor = createThreadSupervisor({
      id: 'reap',
      spec: threadSpec(),
      launcher,
      budget,
      scheduler,
      report: (error) => {
        reports.push(error)
      }
    })
    await supervisor.start()
    const stopping = supervisor.stop()
    await settle()
    expect(launcher.handles[0]?.terminations).toBe(1)
    scheduler.advance(5_000)
    await stopping
    expect(launcher.handles[0]?.terminations).toBe(1)
    expect(supervisor.inspect().lastExit?.reason).toBe('abandoned')
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      code: SupervisionErrorCode.reapTimeout,
      detail: expect.objectContaining({ phase: 'exit', kind: 'thread' })
    })
    expect(budget.inUse).toBe(1)
    launcher.handles[0]!.complete({ code: null })
    await settle()
    expect(budget.inUse).toBe(0)
    await supervisor.dispose()
  })

  it('reports a thrown termination verbatim and shares the concurrent stop sequence', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher(undefined, false)
    const reports: unknown[] = []
    let drains = 0
    const supervisor = createThreadSupervisor({
      id: 'concurrent',
      spec: threadSpec(),
      launcher,
      budget: createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler }),
      scheduler,
      report: (error) => {
        reports.push(error)
      },
      stop: {
        beforeTerminate: async () => {
          drains++
        }
      }
    })
    await supervisor.start()
    const boom = new Error('terminate failed')
    launcher.handles[0]!.failTermination(boom)
    const stopping = supervisor.stop()
    const disposing = supervisor.dispose()
    await settle()
    expect(drains).toBe(1)
    expect(reports).toContain(boom)
    launcher.handles[0]!.complete({ code: null })
    await Promise.all([stopping, disposing])
    expect(launcher.handles[0]?.terminations).toBe(1)
  })
})

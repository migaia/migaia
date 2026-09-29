import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createUnitBudget, SUPERVISION_SOURCE, SupervisionErrorCode } from '../../src/index.js'
import { createThreadSupervisor, ThreadUnitKind } from '../../src/threads/index.js'
import { memoryThreadLauncher, settle, threadSpec } from './support/memory-thread-launcher.js'

describe('A3 thread supervision and A4 exit classification', () => {
  it('restarts on the core backoff schedule and keeps a coded cause chain', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher()
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 2, scheduler })
    const reports: unknown[] = []
    const launchTimes: number[] = []
    const originalLaunch = launcher.launch
    launcher.launch = async (spec, context) => {
      launchTimes.push(scheduler.now())
      return originalLaunch(spec, context)
    }
    const supervisor = createThreadSupervisor({
      id: 'backoff',
      spec: threadSpec(),
      launcher,
      budget,
      scheduler,
      report: (error) => {
        reports.push(error)
      },
      restart: { maxRestarts: 3 }
    })
    await supervisor.start()
    launcher.handles[0]!.complete({ code: 1 })
    for (const delay of [250, 500, 1_000]) {
      await settle()
      scheduler.advance(delay)
      await settle()
      launcher.handles[launcher.handles.length - 1]!.complete({ code: 1 })
    }
    await settle()
    expect(launchTimes).toEqual([0, 250, 750, 1_750])
    expect(supervisor.inspect().state).toBe('terminal')
    expect(reports).toHaveLength(1)
    const terminal = reports[0] as Error & {
      code: string
      source: string
      detail: { kind: string }
    }
    expect(terminal.code).toBe(SupervisionErrorCode.supervisionExhausted)
    expect(terminal.detail.kind).toBe('thread')
    const exit = terminal.cause as Error & {
      code: string
      source: string
      detail: { code: number; kind: string }
    }
    expect(exit.code).toBe(SupervisionErrorCode.exitUnexpected)
    expect(exit.detail).toMatchObject({ code: 1, kind: 'thread' })
    for (const error of [terminal, exit]) {
      expect(Object.values(SupervisionErrorCode)).toContain(error.code)
      expect(error.source).toBe(SUPERVISION_SOURCE)
      expect(error.code).not.toMatch(/^(THREAD|PROCESS)_/)
    }
    expect(scheduler.pendingCount).toBe(0)
    expect(budget.inUse).toBe(0)
    expect(await supervisor.whenReady()).toEqual({ state: 'terminal' })
    await supervisor.dispose()
  })

  it('preserves an external launch rejection as the exact cause', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher()
    const boom = new Error('foreign launcher failure')
    const stack = boom.stack
    launcher.launchFailure = boom
    const supervisor = createThreadSupervisor({
      id: 'launch',
      spec: threadSpec(),
      launcher,
      budget: createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler }),
      scheduler,
      report: () => undefined,
      restart: { maxRestarts: 0 }
    })
    await supervisor.start()
    await settle()
    const failure = supervisor.inspect().lastExit?.error as Error & {
      code: string
      source: string
      detail: { phase: string; kind: string }
    }
    expect(failure).toMatchObject({
      code: SupervisionErrorCode.launchFailed,
      source: SUPERVISION_SOURCE
    })
    expect(failure.detail).toMatchObject({ phase: 'launch', kind: 'thread' })
    expect(failure.cause).toBe(boom)
    expect(boom).not.toHaveProperty('code')
    expect(boom).not.toHaveProperty('source')
    expect(boom.stack).toBe(stack)
    await supervisor.dispose()
  })

  it.each([
    [{ code: null, error: new Error('uncaught') }, 'crashed', true],
    [{ code: 0 }, 'exited', false],
    [{ code: 0, error: new Error('uncaught') }, 'crashed', true],
    [{ code: 3 }, 'crashed', true]
  ] as const)('classifies exit %j as %s', async (status, reason, failed) => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher()
    const reports: unknown[] = []
    const supervisor = createThreadSupervisor({
      id: 'exit',
      spec: threadSpec(),
      launcher,
      budget: createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler }),
      scheduler,
      report: (error) => {
        reports.push(error)
      }
    })
    await supervisor.start()
    launcher.handles[0]!.complete(status)
    await settle()
    expect(supervisor.inspect().lastExit?.reason).toBe(reason)
    if (failed) {
      const error = supervisor.inspect().lastExit?.error as Error & {
        code: string
        detail: { code: number | null }
      }
      expect(error.code).toBe(SupervisionErrorCode.exitUnexpected)
      expect(error.detail.code).toBe(status.code)
      if ('error' in status) expect(error.cause).toBe(status.error)
      else expect(Object.hasOwn(error, 'cause')).toBe(false)
      expect(supervisor.inspect().state).toBe('backoff')
    } else {
      expect(supervisor.inspect().state).toBe('stopped')
      expect(reports).toHaveLength(0)
    }
    await supervisor.dispose()
  })
})

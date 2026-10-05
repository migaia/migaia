import { expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, type ISupervisorEvent } from '../../src/index.js'
import { createProcessSupervisor, type IProcessHandle } from '../../src/process/index.js'
import { memoryProcessLauncher, processSpec } from '../process/support/memory-process-launcher.js'

/** Flushes original exit and scope release continuations without advancing time. */
async function settle(): Promise<void> {
  for (let index = 0; index < 60; index++) await Promise.resolve()
}

it('[A52/A58] abandonment is not native exit; late actual exit preserves its status once', async () => {
  /** The native exit promise remains pending past the bounded reap deadline. */
  const launcher = memoryProcessLauncher(undefined, false)
  /** No wall-clock sleeps are necessary to distinguish termination from actual exit. */
  const scheduler = createManualScheduler()
  /** Native lease ownership cannot end when the reap deadline merely expires. */
  const budget = createUnitBudget({ kind: 'process', maxUnits: 2, launchRate: false, scheduler })
  /** Captures only the original publisher's exit facts. */
  const exits: ISupervisorEvent<IProcessHandle>[] = []
  /** Process profile projects genuine code/signal values supplied by its exited promise. */
  const supervisor = createProcessSupervisor({
    id: 'native-exit-detail',
    launcher,
    scheduler,
    budget,
    spec: processSpec(),
    restart: { mode: 'never' },
    stop: { reapTimeoutMs: 5 },
    report: () => undefined
  })
  supervisor.subscribe((event) => {
    if (event.type === 'exit') exits.push(event)
  })
  try {
    await supervisor.start()
    /** Reap is allowed to abandon, while native exit remains independently pending. */
    const killing = supervisor.kill()
    await settle()
    expect(launcher.handles[0]!.terminations).toEqual(['force'])
    scheduler.advance(5)
    await killing
    expect(supervisor.inspect().lastExit?.reason).toBe('abandoned')
    expect(exits, '[A58] timeout cannot manufacture native exit').toEqual([])
    expect(budget.inUse).toBe(1)
    launcher.handles[0]!.complete({ code: null, signal: 'SIGKILL' })
    await settle()
    expect(exits).toEqual([
      expect.objectContaining({
        type: 'exit',
        generation: 1,
        reason: 'abandoned',
        status: { code: null, signal: 'SIGKILL' },
        observedAt: 5
      })
    ])
    expect(supervisor.inspect().lastExit).toMatchObject({
      generation: 1,
      status: { code: null, signal: 'SIGKILL' },
      observedAt: 5
    })
    expect(budget.inUse).toBe(0)
  } finally {
    for (const handle of launcher.handles) handle.complete()
    await settle()
    await supervisor.dispose()
  }
})

it('[A58] late abandoned exit cannot overwrite the next generation exit', async () => {
  /** Two leases allow a new unit while the abandoned unit remains alive. */
  const scheduler = createManualScheduler()
  /** Each actual handle keeps its own exit promise and native status. */
  const launcher = memoryProcessLauncher(undefined, false)
  /** The original generation owner, rather than the facade, routes every exit. */
  const supervisor = createProcessSupervisor({
    id: 'late-native-exit',
    launcher,
    scheduler,
    spec: processSpec(),
    report: () => undefined,
    budget: createUnitBudget({ kind: 'process', maxUnits: 2, launchRate: false, scheduler }),
    restart: { mode: 'never' },
    stop: { reapTimeoutMs: 5 }
  })
  try {
    await supervisor.start()
    /** The old unit is retained until its actual exit, independent of command completion. */
    const killing = supervisor.kill()
    await settle()
    scheduler.advance(5)
    await killing
    await supervisor.start()
    /** A completed new generation must keep its own exit facts after an old late completion. */
    const generation = supervisor.generation
    launcher.handles[1]!.complete({ code: 0, signal: null })
    await settle()
    launcher.handles[0]!.complete({ code: null, signal: 'SIGKILL' })
    await settle()
    expect(supervisor.inspect().lastExit).toMatchObject({
      generation,
      reason: 'exited',
      status: { code: 0, signal: null }
    })
  } finally {
    for (const handle of launcher.handles) handle.complete()
    await settle()
    await supervisor.dispose()
  }
})

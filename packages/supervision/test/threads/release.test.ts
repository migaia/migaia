import { createManualScheduler } from '@migaia/utils/scheduler'
import { createAbortController } from '@migaia/lifecycle'
import { describe, expect, it } from 'vitest'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import {
  createThreadSupervisor,
  ThreadUnitKind,
  type IThreadBudget
} from '../../src/threads/index.js'
import { memoryThreadLauncher, settle, threadSpec } from './support/memory-thread-launcher.js'

describe('A8 thread resource release', () => {
  it.each(['clean', 'crash', 'launch', 'ready', 'heap', 'stop'] as const)(
    'releases all leases after %s',
    async (mode) => {
      const scheduler = createManualScheduler()
      const launcher = memoryThreadLauncher()
      const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
      if (mode === 'launch') launcher.launchFailure = new Error('launch rejected')
      const supervisor = createThreadSupervisor({
        id: mode,
        spec: threadSpec(),
        launcher,
        budget,
        scheduler,
        report: () => undefined,
        restart: { mode: 'never' },
        ready: mode === 'ready' ? () => Promise.reject(new Error('ready rejected')) : undefined
      })
      await supervisor.start()
      if (mode === 'clean') launcher.handles[0]!.complete({ code: 0 })
      if (mode === 'crash') launcher.handles[0]!.complete({ code: 1 })
      if (mode === 'heap') launcher.handles[0]!.complete({ code: 1, limit: 'heapBytes' })
      if (mode === 'stop') await supervisor.stop()
      await settle()
      await supervisor.dispose()
      expect(launcher.handles.every((handle) => !handle.alive)).toBe(true)
      expect(budget.pending).toBe(0)
      expect(budget.inUse).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    }
  )

  it('releases both replacement strategies and the old thread only after switch', async () => {
    for (const strategy of ['stop-then-start', 'start-then-switch'] as const) {
      const scheduler = createManualScheduler()
      const launcher = memoryThreadLauncher()
      const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 2, scheduler })
      const supervisor = createThreadSupervisor({
        id: strategy,
        spec: threadSpec(),
        launcher,
        budget,
        scheduler,
        report: () => undefined
      })
      await supervisor.start()
      expect(await supervisor.replace({ strategy })).toEqual({ kind: 'replaced', generation: 2 })
      expect(launcher.handles[0]?.alive).toBe(false)
      expect(launcher.handles[1]?.alive).toBe(true)
      await supervisor.dispose()
      expect(launcher.handles.every((handle) => !handle.alive)).toBe(true)
      expect(budget.inUse).toBe(0)
      expect(budget.pending).toBe(0)
    }
  })

  it('aborts a pending launch and reaps its late handle', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher()
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
    let resolveLaunch: (handle: Awaited<ReturnType<typeof launcher.launch>>) => void = () =>
      undefined
    const late = new Promise<Awaited<ReturnType<typeof launcher.launch>>>((resolve) => {
      resolveLaunch = resolve
    })
    let launchSignal: Parameters<typeof launcher.launch>[1]['signal'] | undefined
    const delayed = {
      capabilities: launcher.capabilities,
      launch: (
        _spec: Parameters<typeof launcher.launch>[0],
        context: Parameters<typeof launcher.launch>[1]
      ) => {
        launchSignal = context.signal
        return late
      }
    }
    const supervisor = createThreadSupervisor({
      id: 'pending',
      spec: threadSpec(),
      launcher: delayed,
      budget,
      scheduler,
      report: () => undefined
    })
    const started = supervisor.start()
    await settle()
    expect(supervisor.inspect().state).toBe('starting')
    const disposing = supervisor.dispose()
    await settle()
    expect(launchSignal?.aborted).toBe(true)
    scheduler.advance(5_000)
    await Promise.all([started, disposing])
    expect(budget.inUse).toBe(1)
    const context = { signal: createAbortController().signal }
    resolveLaunch(await launcher.launch(threadSpec(), context))
    await settle()
    expect(launcher.handles[0]?.terminations).toBe(1)
    expect(launcher.handles[0]?.alive).toBe(false)
    expect(budget.inUse).toBe(0)
  })

  it('shares disposal and rejects commands during closing and after terminal', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher()
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
    const supervisor = createThreadSupervisor({
      id: 'dispose',
      spec: threadSpec(),
      launcher,
      budget,
      scheduler,
      report: () => undefined,
      stop: { beforeTerminate: () => new Promise<void>(() => undefined) }
    })
    await supervisor.start()
    const disposing = supervisor.dispose()
    expect(supervisor.dispose()).toBe(disposing)
    await expect(supervisor.start()).rejects.toMatchObject({
      code: SupervisionErrorCode.scopeClosed
    })
    await settle()
    scheduler.advance(5_000)
    await disposing
    await expect(supervisor.start()).rejects.toMatchObject({
      code: SupervisionErrorCode.scopeTerminal
    })
    expect(launcher.handles.every((handle) => !handle.alive)).toBe(true)
    expect(budget.inUse).toBe(0)
  })

  it('cancels monitors before termination and releases the lease after exit', async () => {
    const clock = createManualScheduler()
    const launcher = memoryThreadLauncher()
    const scheduler = {
      now: () => clock.now(),
      schedule(callback: () => void, delayMs: number) {
        const task = clock.schedule(callback, delayMs)
        return {
          cancel: () => {
            launcher.events.push('timer-cancel')
            task.cancel()
          },
          unref: () => task.unref?.()
        }
      }
    }
    const underlying = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
    const budget: IThreadBudget = {
      kind: ThreadUnitKind.thread,
      get inUse() {
        return underlying.inUse
      },
      get pending() {
        return underlying.pending
      },
      get closed() {
        return underlying.closed
      },
      close: () => underlying.close(),
      tryAcquire: () => underlying.tryAcquire(),
      async acquire(signal) {
        const outcome = await underlying.acquire(signal)
        if (outcome.kind === 'rejected') return outcome
        return {
          kind: 'granted' as const,
          lease: {
            release() {
              launcher.events.push('lease')
              outcome.lease.release()
            }
          }
        }
      }
    }
    const supervisor = createThreadSupervisor({
      id: 'order',
      spec: threadSpec(),
      launcher,
      budget,
      scheduler,
      report: () => undefined,
      health: { check: () => Promise.resolve(), intervalMs: 5_000 }
    })
    await supervisor.start()
    launcher.events.length = 0
    await supervisor.stop()
    const timer = launcher.events.indexOf('timer-cancel')
    const termination = launcher.events.indexOf('terminate')
    const exited = launcher.events.indexOf('exited')
    const lease = launcher.events.indexOf('lease')
    expect([timer, termination, exited, lease].every((index) => index >= 0)).toBe(true)
    expect(timer).toBeLessThan(termination)
    expect(termination).toBeLessThan(exited)
    expect(exited).toBeLessThan(lease)
    await supervisor.dispose()
  })

  it.each(['backoff', 'terminal'] as const)(
    'disposes from %s with no live handle or timer',
    async (mode) => {
      const scheduler = createManualScheduler()
      const launcher = memoryThreadLauncher()
      const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
      const supervisor = createThreadSupervisor({
        id: mode,
        spec: threadSpec(),
        launcher,
        budget,
        scheduler,
        report: () => undefined,
        restart: { maxRestarts: mode === 'terminal' ? 0 : 3 }
      })
      await supervisor.start()
      launcher.handles[0]!.complete({ code: 1 })
      await settle()
      expect(supervisor.inspect().state).toBe(mode)
      await supervisor.dispose()
      expect(launcher.handles.every((handle) => !handle.alive)).toBe(true)
      expect(budget.pending).toBe(0)
      expect(budget.inUse).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    }
  )

  it('releases after a health failure with unsupported exit observation', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher({
      termination: 'enforced',
      'fault-isolation': 'unsupported',
      'heap-limit': 'unsupported',
      'exit-observation': 'unsupported'
    })
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
    const supervisor = createThreadSupervisor({
      id: 'health-release',
      spec: threadSpec(),
      launcher,
      budget,
      scheduler,
      report: () => undefined,
      restart: { mode: 'never' },
      health: {
        intervalMs: 5_000,
        failureThreshold: 1,
        check: () => Promise.reject(new Error('health failed'))
      }
    })
    await supervisor.start()
    scheduler.advance(5_000)
    await settle()
    expect(supervisor.inspect().lastExit?.reason).toBe('unhealthy')
    await supervisor.dispose()
    expect(launcher.handles.every((handle) => !handle.alive)).toBe(true)
    expect(budget.inUse).toBe(0)
    expect(budget.pending).toBe(0)
    expect(scheduler.pendingCount).toBe(0)
  })
})

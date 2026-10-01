import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createProcessResilience } from '../../src/process/resilience/index.js'
import type { IProcessRegistrationBinding } from '../../src/process/resilience/types.js'

/** Flush only the promise continuations created by terminal subscribers and cleanup. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 24; turn += 1) await Promise.resolve()
}

/** A narrow supervisor exposes its real terminal entry and state without a second scheduler. */
function supervisorFixture(report: (error: unknown) => void) {
  let state: 'ready' | 'terminal' | 'starting' = 'ready'
  let entry = 0
  let listener: (event: { entry: number; error: unknown }) => void = () => undefined
  const restart = vi.fn(async () => ({ state: 'ready' as const, generation: 2, unit: {} }))
  const binding: IProcessRegistrationBinding = {
    ownership: 'spawn-owned',
    health: 'ping',
    supervisor: {
      restart,
      inspect: () => ({
        kind: 'fixture',
        state,
        generation: 1,
        failuresInWindow: 0,
        terminalEntries: entry,
        degraded: [],
        abandoned: 0
      }),
      onTerminal(next) {
        listener = next
        return () => {
          listener = () => undefined
        }
      },
      dispose: async () => undefined
    }
  }
  return {
    binding,
    restart,
    enter(error: unknown) {
      state = 'terminal'
      entry += 1
      report(error)
      listener({ entry, error })
    },
    leave() {
      state = 'starting'
    }
  }
}

describe('process resilience terminal registration', () => {
  it('[A6] reports at 0/1/5/15 minutes and liquidates after four unhandled entries', async () => {
    const scheduler = createManualScheduler()
    const reports: unknown[] = []
    const supervisor = supervisorFixture((error) => reports.push(error))
    const release = vi.fn(async () => undefined)
    const resilience = createProcessResilience({
      scheduler,
      report: (error) => reports.push(error)
    })
    const registration = resilience.attachRegistration('p', supervisor.binding, {
      kind: 'standalone-host',
      release
    })
    const guard = resilience.callGuard('p')
    const failure = new Error('terminal')
    supervisor.enter(failure)
    await settle()
    expect(reports).toEqual([failure])
    expect(registration.inspect()).toMatchObject({ state: 'terminal', unhandled: 1 })
    expect(scheduler.pendingCount).toBe(1)
    expect(() =>
      guard.beforeDispatch({ method: 'request', mode: 'request', generation: 1 })
    ).toThrowError(expect.objectContaining({ code: 'PROCESS_TERMINAL_CALL' }))
    scheduler.advance(60_000)
    await settle()
    expect(reports).toHaveLength(2)
    scheduler.advance(240_000)
    await settle()
    expect(reports).toHaveLength(3)
    scheduler.advance(600_000)
    await settle()
    expect(reports).toHaveLength(4)
    expect(release).toHaveBeenCalledOnce()
    expect(registration.inspect()).toMatchObject({ liquidated: true, unhandled: 4 })
    expect(() =>
      guard.beforeDispatch({ method: 'request', mode: 'request', generation: 1 })
    ).toThrowError(expect.objectContaining({ code: 'PROCESS_LIQUIDATED' }))
    expect(scheduler.pendingCount).toBe(0)
    await registration.close()
    await resilience.close()
  })

  it('[A6] accepts one successful subscriber without a second diagnostic report', async () => {
    const scheduler = createManualScheduler()
    const reports: unknown[] = []
    const supervisor = supervisorFixture((error) => reports.push(error))
    const resilience = createProcessResilience({
      scheduler,
      report: (error) => reports.push(error)
    })
    const release = vi.fn(async () => undefined)
    const registration = resilience.attachRegistration('p', supervisor.binding, {
      kind: 'standalone-host',
      release
    })
    resilience.onTerminal(() => undefined)
    supervisor.enter(new Error('terminal'))
    await settle()
    expect(reports).toHaveLength(1)
    expect(registration.inspect()?.unhandled).toBe(0)
    expect(scheduler.pendingCount).toBe(0)
    scheduler.advance(900_000)
    expect(release).not.toHaveBeenCalled()
    await resilience.close()
  })

  it('[A6] preserves unhandled count across cooldown and clears it on explicit restart', async () => {
    const scheduler = createManualScheduler()
    const reports: unknown[] = []
    const supervisor = supervisorFixture((error) => reports.push(error))
    const resilience = createProcessResilience({
      scheduler,
      report: (error) => reports.push(error)
    })
    const registration = resilience.attachRegistration('p', supervisor.binding, {
      kind: 'standalone-host',
      release: async () => undefined
    })
    supervisor.enter(new Error('first'))
    await settle()
    supervisor.leave()
    scheduler.advance(60_000)
    await settle()
    expect(reports).toHaveLength(1)
    expect(registration.inspect()?.unhandled).toBe(1)
    supervisor.enter(new Error('second'))
    await settle()
    expect(registration.inspect()?.unhandled).toBe(2)
    await registration.restart()
    expect(supervisor.restart).toHaveBeenCalledOnce()
    expect(registration.inspect()?.unhandled).toBe(0)
    expect(scheduler.pendingCount).toBe(0)
    await resilience.close()
  })

  it('[A6] normal close removes its guard and never disposes the caller supervisor', async () => {
    const scheduler = createManualScheduler()
    const supervisor = supervisorFixture(() => undefined)
    const resilience = createProcessResilience({ scheduler, report: () => undefined })
    const registration = resilience.attachRegistration('p', supervisor.binding, {
      kind: 'standalone-host',
      release: async () => undefined
    })
    const guard = resilience.callGuard('p')
    supervisor.enter(new Error('terminal'))
    await settle()
    const closing = registration.close()
    expect(registration.close()).toBe(closing)
    await closing
    expect(registration.inspect()).toBeUndefined()
    expect(resilience.inspect('p')).toBeUndefined()
    expect(() =>
      guard.beforeDispatch({ method: 'request', mode: 'request', generation: 1 })
    ).not.toThrow()
    await registration.restart()
    expect(supervisor.restart).toHaveBeenCalledOnce()
    await resilience.close()
  })

  it('[A6] extends the last diagnostic interval until a custom unhandled limit', async () => {
    const scheduler = createManualScheduler()
    const reports: unknown[] = []
    const supervisor = supervisorFixture((error) => reports.push(error))
    const release = vi.fn(async () => undefined)
    const resilience = createProcessResilience({
      scheduler,
      report: (error) => reports.push(error),
      reportAtMs: [0, 10, 20],
      unhandledLimit: 4
    })
    const registration = resilience.attachRegistration('p', supervisor.binding, {
      kind: 'standalone-host',
      release
    })
    supervisor.enter(new Error('terminal'))
    await settle()
    for (let count = 2; count <= 5; count += 1) {
      scheduler.advance(10)
      await settle()
      expect(reports).toHaveLength(count)
    }
    expect(release).toHaveBeenCalledOnce()
    expect(registration.inspect()).toMatchObject({ liquidated: true, unhandled: 5 })
    await resilience.close()
  })

  it('[A6] reports a failing subscriber once while leaving the entry unhandled', async () => {
    const scheduler = createManualScheduler()
    const reports: unknown[] = []
    const supervisor = supervisorFixture((error) => reports.push(error))
    const resilience = createProcessResilience({
      scheduler,
      report: (error) => reports.push(error)
    })
    const registration = resilience.attachRegistration('p', supervisor.binding, {
      kind: 'standalone-host',
      release: async () => undefined
    })
    const subscriberFailure = new Error('subscriber failed')
    resilience.onTerminal(() => {
      throw subscriberFailure
    })
    const terminal = new Error('terminal')
    supervisor.enter(terminal)
    await settle()
    expect(reports).toEqual([terminal, subscriberFailure])
    expect(registration.inspect()?.unhandled).toBe(1)
    expect(scheduler.pendingCount).toBe(1)
    await resilience.close()
  })
})

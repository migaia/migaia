import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { createProcessResilience } from '../../../rpc-plugin-process/dist/process/resilience/index.js'
import type { IProcessRegistrationBinding } from '../../../rpc-plugin-process/dist/process/resilience/types.js'

/** Flush only the promise continuations created by terminal subscribers and cleanup. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 64; turn += 1) await Promise.resolve()
}

/** The original supervisor observation fixture has one explicit mutable state owner. */
class TerminalSupervisorFixture {
  /** Terminal observations read the same current supervisor phase as restart consumers. */
  #state: 'ready' | 'terminal' | 'starting' = 'ready'
  /** Every native terminal entry advances once and remains visible to inspection. */
  #entry = 0
  /** The fixture follows the original single-subscriber supervisor contract. */
  #listener: (event: { entry: number; error: unknown }) => void = () => undefined
  /** The exact diagnostic callback remains receiver-free when a terminal entry is reported. */
  #report: (error: unknown) => void
  /** Existing assertions retain the same observable restart spy and native result. */
  readonly restart = vi.fn(async () => ({ state: 'ready' as const, generation: 2, unit: {} }))
  /** This is the original narrow supervisor port consumed by the production governor. */
  readonly binding: IProcessRegistrationBinding

  /** Assemble the unchanged registration port before any terminal event can be delivered. */
  constructor(report: (error: unknown) => void) {
    this.#report = report
    this.binding = {
      ownership: 'spawn-owned',
      health: 'ping',
      supervisor: {
        restart: this.restart,
        inspect: () => ({
          kind: 'fixture',
          state: this.#state,
          generation: 1,
          failuresInWindow: 0,
          terminalEntries: this.#entry,
          degraded: [],
          abandoned: 0
        }),
        onTerminal: (listener) => {
          this.#listener = listener
          return () => {
            this.#listener = () => undefined
          }
        },
        dispose: async () => undefined
      }
    }
  }

  /** Report before notifying the original governor, preserving terminal error identity and order. */
  enter(error: unknown): void {
    this.#state = 'terminal'
    this.#entry += 1
    /** Preserve the original plain callback receiver. */
    const report = this.#report
    report(error)
    /** Deliver the captured listener with the original plain invocation receiver. */
    const listener = this.#listener
    listener({ entry: this.#entry, error })
  }

  /** Simulate only the original departure from terminal, without inventing another lifecycle. */
  leave(): void {
    this.#state = 'starting'
  }
}

/** Create the original narrow supervisor with explicit ownership instead of shared factory state. */
function supervisorFixture(report: (error: unknown) => void) {
  return new TerminalSupervisorFixture(report)
}

describe('process resilience terminal registration', () => {
  it('reports at 0/1/5/15 minutes and liquidates after four unhandled entries', async () => {
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
    const failure = new Error('terminal')
    supervisor.enter(failure)
    await settle()
    expect(reports).toEqual([failure])
    expect(registration.inspect()).toMatchObject({ state: 'terminal', unhandled: 1 })
    expect(scheduler.pendingCount).toBe(1)
    expect(() => resilience.assertAvailable('p')).toThrowError(
      expect.objectContaining({ code: 'PROCESS_TERMINAL_CALL' })
    )
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
    expect(() => resilience.assertAvailable('p')).toThrowError(
      expect.objectContaining({ code: 'PROCESS_LIQUIDATED' })
    )
    expect(scheduler.pendingCount).toBe(0)
    await registration.close()
    await resilience.close()
  })

  it('accepts one successful subscriber without a second diagnostic report', async () => {
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

  it('preserves unhandled count across cooldown and clears it on explicit restart', async () => {
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

  it('normal close removes its guard and never disposes the caller supervisor', async () => {
    const scheduler = createManualScheduler()
    const supervisor = supervisorFixture(() => undefined)
    const resilience = createProcessResilience({ scheduler, report: () => undefined })
    const registration = resilience.attachRegistration('p', supervisor.binding, {
      kind: 'standalone-host',
      release: async () => undefined
    })
    supervisor.enter(new Error('terminal'))
    await settle()
    const closing = registration.close()
    expect(registration.close()).toBe(closing)
    await closing
    expect(registration.inspect()).toBeUndefined()
    expect(resilience.inspect('p')).toBeUndefined()
    expect(() => resilience.assertAvailable('p')).not.toThrow()
    await registration.restart()
    expect(supervisor.restart).toHaveBeenCalledOnce()
    await resilience.close()
  })

  it('extends the last diagnostic interval until a custom unhandled limit', async () => {
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

  it('reports a failing subscriber once while leaving the entry unhandled', async () => {
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

it('passive liquidation notifications follow successful cleanup and cannot handle terminal state', async () => {
  /** The canonical governor schedules terminal handling independently from passive observers. */
  const scheduler = createManualScheduler()
  const reports: unknown[] = []
  const supervisor = supervisorFixture((error) => reports.push(error))
  /** Actual cleanup has not committed while this owner release remains pending. */
  let finish!: () => void
  const cleanup = new Promise<void>((resolve) => {
    finish = resolve
  })
  const release = vi.fn(() => cleanup)
  const resilience = createProcessResilience({
    scheduler,
    report: (error) => reports.push(error),
    reportAtMs: [0, 10],
    unhandledLimit: 1
  })
  const registration = resilience.attachRegistration('p', supervisor.binding, {
    kind: 'standalone-host',
    release
  })
  try {
    /** The existing governor exposes passive facts after the original cleanup commits. */
    const notifications: unknown[] = []
    const unsubscribe = resilience.onLiquidated((snapshot: unknown) => {
      notifications.push(snapshot)
      expect(resilience.inspect('p')?.liquidated).toBe(true)
    })
    expect(typeof unsubscribe).toBe('function')
    supervisor.enter(new Error('terminal fixture'))
    await settle()
    expect(notifications).toEqual([])
    expect(registration.inspect()?.unhandled).toBe(1)
    scheduler.advance(10)
    await settle()
    expect(release).toHaveBeenCalledOnce()
    expect(notifications).toEqual([])
    finish()
    await settle()
    expect(notifications).toHaveLength(1)
    expect(registration.inspect()?.unhandled).toBe(2)
    unsubscribe?.()
    unsubscribe?.()
  } finally {
    finish()
    await settle()
    await registration.close()
    await resilience.close()
  }
})

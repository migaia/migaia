import { createManualScheduler } from '@migaia/utils/scheduler'
import type { IPluginDependencyPlan, IPluginRemoval } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import { createProcessResilience } from '../../src/process/resilience/index.js'
import type {
  IProcessDependencyHostPort,
  IProcessRegistrationBinding
} from '../../src/process/resilience/types.js'

/** One fake terminal source preserves supervision's own zero-minute report. */
function terminalSource(report: (error: unknown) => void) {
  let callback: (event: { entry: number; error: unknown }) => void = () => undefined
  const binding: IProcessRegistrationBinding = {
    ownership: 'spawn-owned',
    health: 'ping',
    supervisor: {
      restart: async () => ({ state: 'terminal' }),
      inspect: () => ({
        kind: 'fixture',
        state: 'terminal' as const,
        generation: 1,
        failuresInWindow: 0,
        terminalEntries: 1,
        degraded: [],
        abandoned: 0
      }),
      onTerminal(listener) {
        callback = listener
        return () => {
          callback = () => undefined
        }
      },
      dispose: async () => undefined
    }
  }
  return {
    binding,
    enter(error: unknown) {
      report(error)
      callback({ entry: 1, error })
    }
  }
}

/** All terminal subscriber and liquidation continuations settle without wall time. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
}

/** A committed plan need only list names that the mutation actually changed. */
function plan(policy: 'suspend' | 'cascade', dependent?: string): IPluginDependencyPlan {
  return {
    policy,
    order: dependent ? ['P', dependent] : ['P'],
    steps: [
      { name: 'P', action: 'release' as const },
      ...(dependent
        ? [
            {
              name: dependent,
              action: policy === 'suspend' ? ('suspend' as const) : ('release' as const)
            }
          ]
        : [])
    ],
    edges: []
  }
}

/** One test Host respects the real dry-run overload while recording committed calls. */
function hostPort(result: IPluginRemoval | Error) {
  const calls = vi.fn((_name: string, _options: unknown) => undefined)
  async function unUse(
    name: string,
    options: Readonly<{ policy: 'suspend' | 'cascade'; dryRun: true }>
  ): Promise<IPluginDependencyPlan>
  async function unUse(
    name: string,
    options: Readonly<{ policy: 'suspend' | 'cascade'; dryRun?: false }>
  ): Promise<IPluginRemoval>
  async function unUse(
    name: string,
    options: Readonly<{ policy: 'suspend' | 'cascade'; dryRun?: boolean }>
  ): Promise<IPluginDependencyPlan | IPluginRemoval> {
    calls(name, options)
    if (options.dryRun) return plan(options.policy)
    if (result instanceof Error) throw result
    return result
  }
  const host: IProcessDependencyHostPort = { unUse }
  return { host, calls }
}

describe('process resilience committed liquidation', () => {
  it('[A7] uses only the committed affected plan and starts one dependent diagnostic', async () => {
    const scheduler = createManualScheduler()
    const reports: unknown[] = []
    const source = terminalSource((error) => reports.push(error))
    const { host, calls } = hostPort({ ok: true, affected: plan('suspend', 'D2') })
    const resilience = createProcessResilience({
      scheduler,
      report: (error) => reports.push(error),
      reportAtMs: [0, 1],
      unhandledLimit: 1
    })
    const registration = resilience.attachRegistration('P', source.binding, {
      kind: 'proxy-plugin',
      name: 'P',
      host
    })
    source.enter(new Error('terminal'))
    await settle()
    scheduler.advance(1)
    await settle()
    expect(calls).toHaveBeenCalledExactlyOnceWith('P', { policy: 'suspend' })
    expect(resilience.inspect('P')).toMatchObject({ liquidated: true })
    expect(resilience.inspect('D2')).toMatchObject({ id: 'D2', unhandled: 1 })
    expect(resilience.inspect('D1')).toBeUndefined()
    expect(
      reports.filter(
        (error) =>
          !!error &&
          typeof error === 'object' &&
          'detail' in error &&
          (error.detail as { registrationId?: string })?.registrationId === 'D2'
      )
    ).toHaveLength(1)
    await expect(registration.restart()).rejects.toMatchObject({ code: 'PROCESS_LIQUIDATED' })
    await resilience.close()
  })

  it('[A7] treats post-removal errors as committed and retains each cleanup failure', async () => {
    const scheduler = createManualScheduler()
    const reports: unknown[] = []
    const source = terminalSource((error) => reports.push(error))
    const cleanup = new Error('cleanup failed')
    const { host, calls } = hostPort({
      ok: false,
      errors: [cleanup],
      affected: plan('suspend')
    })
    const resilience = createProcessResilience({
      scheduler,
      report: (error) => reports.push(error),
      reportAtMs: [0, 1],
      unhandledLimit: 1
    })
    resilience.attachRegistration('P', source.binding, {
      kind: 'proxy-plugin',
      name: 'P',
      host
    })
    const terminal = new Error('terminal')
    source.enter(terminal)
    await settle()
    scheduler.advance(1)
    await settle()
    expect(calls).toHaveBeenCalledOnce()
    expect(reports).toContain(cleanup)
    expect(resilience.inspect('P')).toMatchObject({ liquidated: true })
    expect(resilience.inspect('P')?.reason).toMatchObject({
      errors: [terminal, cleanup]
    })
    await resilience.close()
  })

  it('[A7] leaves pre-commit rejection terminal without a tombstone or retry mutation', async () => {
    const scheduler = createManualScheduler()
    const reports: unknown[] = []
    const source = terminalSource((error) => reports.push(error))
    const primary = new Error('pre-commit failed')
    const { host, calls } = hostPort(primary)
    const resilience = createProcessResilience({
      scheduler,
      report: (error) => reports.push(error),
      reportAtMs: [0, 1],
      unhandledLimit: 1
    })
    const registration = resilience.attachRegistration('P', source.binding, {
      kind: 'proxy-plugin',
      name: 'P',
      host
    })
    source.enter(new Error('terminal'))
    await settle()
    scheduler.advance(1)
    await settle()
    expect(calls).toHaveBeenCalledOnce()
    expect(reports).toContain(primary)
    expect(registration.inspect()).toMatchObject({ liquidated: false, state: 'terminal' })
    expect(resilience.inspect('P')).toMatchObject({ liquidated: false })
    await resilience.close()
  })

  it('[A7] standalone release never reads a Host plan and fails without a tombstone', async () => {
    const scheduler = createManualScheduler()
    const reports: unknown[] = []
    const source = terminalSource((error) => reports.push(error))
    const failure = new Error('release failed')
    const release = vi.fn(async () => {
      throw failure
    })
    const resilience = createProcessResilience({
      scheduler,
      report: (error) => reports.push(error),
      reportAtMs: [0, 1],
      unhandledLimit: 1
    })
    resilience.attachRegistration('P', source.binding, { kind: 'standalone-host', release })
    source.enter(new Error('terminal'))
    await settle()
    scheduler.advance(1)
    await settle()
    expect(release).toHaveBeenCalledOnce()
    expect(reports).toContain(failure)
    expect(resilience.inspect('P')).toMatchObject({ liquidated: false })
    await resilience.close()
  })

  it('[A7] cascade releases actual dependants without starting diagnostic timers', async () => {
    const scheduler = createManualScheduler()
    const reports: unknown[] = []
    const source = terminalSource((error) => reports.push(error))
    const { host, calls } = hostPort({ ok: true, affected: plan('cascade', 'D2') })
    const resilience = createProcessResilience({
      scheduler,
      report: (error) => reports.push(error),
      reportAtMs: [0, 1],
      unhandledLimit: 1,
      liquidation: { cascade: true }
    })
    resilience.attachRegistration('P', source.binding, {
      kind: 'proxy-plugin',
      name: 'P',
      host
    })
    source.enter(new Error('terminal'))
    await settle()
    scheduler.advance(1)
    await settle()
    expect(calls).toHaveBeenCalledExactlyOnceWith('P', { policy: 'cascade' })
    expect(resilience.inspect('D2')).toMatchObject({ liquidated: true })
    expect(scheduler.pendingCount).toBe(0)
    await resilience.close()
  })

  it('[A7] autonomously retains only the newest 100 committed tombstones', async () => {
    const scheduler = createManualScheduler()
    const resilience = createProcessResilience({
      scheduler,
      report: () => undefined,
      reportAtMs: [0, 1],
      unhandledLimit: 1
    })
    for (let index = 0; index < 101; index += 1) {
      const source = terminalSource(() => undefined)
      resilience.attachRegistration(`p${index}`, source.binding, {
        kind: 'standalone-host',
        release: async () => undefined
      })
      source.enter(new Error('terminal'))
      await settle()
      scheduler.advance(1)
      await settle()
      expect(resilience.inspect(`p${index}`)).toMatchObject({ liquidated: true })
    }
    expect(resilience.inspect('p0')).toBeUndefined()
    expect(resilience.inspect('p1')).toMatchObject({ liquidated: true })
    expect(resilience.inspect('p100')).toMatchObject({ liquidated: true })
    await resilience.close()
  })

  it('[A7] a liquidated handle cannot remove a replacement registration', async () => {
    /** Both generations use the governor's original monotonic report schedule. */
    const scheduler = createManualScheduler()
    /** Automatic retirement leaves only a bounded diagnostic entry in the owner. */
    const resilience = createProcessResilience({
      scheduler,
      report: () => undefined,
      reportAtMs: [0, 1],
      unhandledLimit: 1
    })
    /** The retained caller handle outlives its successful automatic liquidation. */
    const first = terminalSource(() => undefined)
    const retired = resilience.attachRegistration('p', first.binding, {
      kind: 'standalone-host',
      release: async () => undefined
    })
    first.enter(new Error('first terminal'))
    await settle()
    scheduler.advance(1)
    await settle()
    expect(retired.inspect()).toMatchObject({ liquidated: true })
    /** Reusing the identity removes the tombstone without borrowing the old registration. */
    const second = terminalSource(() => undefined)
    const current = resilience.attachRegistration('p', second.binding, {
      kind: 'standalone-host',
      release: async () => undefined
    })
    await retired.close()
    expect(resilience.inspect('p')).toEqual(current.inspect())
    await resilience.close()
    expect(resilience.inspect('p')).toBeUndefined()
  })
})

import { definePlugin, PluginHost } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import type { IProcessHandle } from '@migaia/supervision/process'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import { REMOTE_FIXTURE_CONTRACT, remoteHarness } from '../remote/fixture.js'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createProcessResilience } from '../../src/process/resilience/index.js'
import type { IProcessRegistrationBinding } from '../../src/process/resilience/types.js'

/** Flush only the promise continuations created by terminal subscribers and cleanup. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 64; turn += 1) await Promise.resolve()
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
  it.each(['spawn', 'connect'] as const)(
    '[A6] gates actual proxy modes and liquidates once through its real local Host for %s',
    async (deploymentKind) => {
      /** Existing neutral endpoint records the frame count independently of the real supervisor. */
      const fixture = remoteHarness()
      const scheduler = fixture.binding.scheduler
      const reports: unknown[] = []
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      /** A crash exhausts this deployment without introducing a mocked terminal event. */
      let crash!: (exit: { code: number; signal: null }) => void
      const handle: IProcessHandle = {
        identity: { fingerprint: 'terminal-child' },
        exited: new Promise((resolve) => {
          crash = resolve
        }),
        terminate: () => crash({ code: 0, signal: null })
      }
      /** Borrowed EOF settles only its local socket handle, with no foreign termination port. */
      let lost: ((reason?: unknown) => void) | undefined
      const borrowedRaw = {
        kind: 'byte' as const,
        write: async () => undefined,
        onData: () => () => undefined,
        onClose(listener: (reason?: unknown) => void) {
          lost = listener
          return () => {
            lost = undefined
          }
        },
        close: () => {
          lost?.()
          lost = undefined
        }
      }
      const unUse = vi.spyOn(host, 'unUse')
      const plugin = createProcessPlugin({
        name: 'p',
        contract: REMOTE_FIXTURE_CONTRACT,
        registrationOwner: { name: 'p', host },
        host: host.plugin,
        endpointFactory: async () => fixture.served,
        report: (error) => reports.push(error),
        deployment:
          deploymentKind === 'connect'
            ? {
                kind: 'connect',
                address: 'borrowed-fixture',
                token: 'local-secret',
                dial: async () => borrowedRaw,
                establish: async () => ({
                  ...fixture.channel,
                  agreement: { ...fixture.channel.agreement, source: 'negotiated' as const }
                }),
                supervision: {
                  scheduler,
                  restart: { mode: 'on-failure', maxRestarts: 0 },
                  health: { check: async () => undefined }
                }
              }
            : {
                kind: 'spawn',
                channelKind: 'message',
                supervision: {
                  id: 'terminal-child',
                  scheduler,
                  spec: {
                    command: 'fixture',
                    args: [],
                    env: { inherit: [], set: {} },
                    stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
                  },
                  launcher: {
                    capabilities: { termination: 'enforced', 'fault-isolation': 'enforced' },
                    launch: async () => handle
                  },
                  budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler }),
                  restart: { mode: 'on-failure', maxRestarts: 0 },
                  health: { check: async () => undefined },
                  report: (error) => reports.push(error)
                },
                rawChannel: async () => ({
                  kind: 'message',
                  send: () => undefined,
                  onMessage: () => () => undefined,
                  onClose: () => () => undefined,
                  close: () => undefined
                }),
                establish: async () => fixture.channel
              }
      })
      try {
        const [installed] = await host.use(plugin)
        const feature = installed.getFeature('f') as Record<string, (...args: unknown[]) => unknown>
        const [other] = await host.use(
          definePlugin({ name: 'other', install: () => ({ live: true }) })
        )
        if (deploymentKind === 'connect') lost!(new Error('borrowed EOF fixture'))
        else crash({ code: 1, signal: null })
        await settle()
        const frames = fixture.sends.length
        for (const method of ['request', 'oneWay']) {
          /** Capture rejection before a synchronous assertion, preserving strict base-RED identity. */
          const failure = await (feature[method]!([]) as Promise<unknown>).then(
            () => undefined,
            (error) => error
          )
          expect(failure, 'SDD_BASE_RED_CONTRACT:A6 default process call guard').toMatchObject({
            code: 'PROCESS_TERMINAL_CALL'
          })
        }
        for (const method of ['generator', 'asyncGenerator'])
          await expect(
            (feature[method]!([]) as AsyncIterableIterator<unknown>).next()
          ).rejects.toMatchObject({ code: 'PROCESS_TERMINAL_CALL' })
        expect(fixture.sends).toHaveLength(frames)
        expect(reports).toHaveLength(1)
        for (const offset of [60_000, 240_000, 600_000]) {
          scheduler.advance(offset)
          await settle()
        }
        expect(unUse.mock.calls.filter(([, options]) => !options?.dryRun)).toHaveLength(1)
        await unUse.mock.results.find(
          (result, index) => result.type === 'return' && !unUse.mock.calls[index]?.[1]?.dryRun
        )?.value
        await settle()
        await expect(feature.request!([])).rejects.toMatchObject({ code: 'PROCESS_LIQUIDATED' })
        expect(other.extensions.live).toBe(true)
        expect(scheduler.pendingCount).toBe(0)
      } finally {
        await host.dispose()
      }
    }
  )

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

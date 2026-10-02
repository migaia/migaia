import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createProcessHost } from '../../src/process/host/client.js'
import { hostFixture } from './fixtures/host-control.js'
import { nativeHostOptions } from './fixtures/host-native.js'
import type { IRemoteRetryPort } from '../../src/remote/types.js'

describe('process Host facade admission and ownership', () => {
  it('[K221/A1] drains an external retry port without changing its call count or Promise', async () => {
    /** No endpoint send owns this logical operation; the caller-supplied retry port does. */
    const fixture = hostFixture()
    /** Preserve the exact settlement object and Promise produced by the external owner. */
    const value = Object.freeze({ completed: true })
    /** The external owner decides when its request settles. */
    let settle!: (result: typeof value) => void
    const pending = new Promise<typeof value>((resolve) => {
      settle = resolve
    })
    /** Count forwarding at the external boundary instead of inspecting internal drain counters. */
    const dispatch = vi.fn(() => pending)
    const external: IRemoteRetryPort = { dispatch: dispatch as IRemoteRetryPort['dispatch'] }
    const host = createProcessHost({ ...fixture.options, retryPort: external })
    try {
      const feature = await host.use('p')
      const request = feature.f!.m!([])
      expect(request).toBe(pending)
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(fixture.send.mock.calls.filter((call) => call[1] === 'p.f.m')).toHaveLength(0)
      const closing = host.release()
      await Promise.resolve()
      await Promise.resolve()
      expect(fixture.terminate).not.toHaveBeenCalled()
      settle(value)
      expect(await request).toBe(value)
      await closing
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(fixture.terminate).toHaveBeenCalledTimes(1)
      expect(fixture.scheduler.pendingCount).toBe(0)
    } finally {
      settle(value)
      await host.release()
    }
  })

  it('[A1] forwards the process call wall cap through the existing remote dispatcher', async () => {
    /** The neutral endpoint records the effective deadline rather than waiting on real time. */
    const fixture = hostFixture()
    if (fixture.options.deployment.kind !== 'spawn') throw new Error('fixture deployment')
    /** One typed observer preserves every endpoint argument at the canonical dispatch boundary. */
    const sends: unknown[][] = []
    const original = fixture.options.endpointFactory
    const host = createProcessHost({
      ...fixture.options,
      deployment: {
        ...fixture.options.deployment,
        supervision: {
          ...fixture.options.deployment.supervision,
          spec: { ...fixture.options.deployment.supervision.spec, limits: { callWallTimeMs: 60 } }
        }
      },
      endpointFactory: async (...args) => {
        const served = await original(...args)
        return {
          ...served,
          endpoint: {
            ...served.endpoint,
            send<T>(...input: Parameters<typeof served.endpoint.send>) {
              sends.push(input)
              return served.endpoint.send<T>(...input)
            }
          }
        }
      }
    })
    try {
      const features = await host.use('p')
      await features.f!.m!([], { timeoutMs: 120 })
      expect(sends.at(-1)?.[3]).toMatchObject({ timeoutMs: 60 })
    } finally {
      await host.release()
    }
  })
  it('[A1] announces one close and waits for the real in-flight request before child exit', async () => {
    const fixture = nativeHostOptions()
    const original = fixture.options.endpointFactory
    const close = vi.fn()
    let sent!: () => void
    const businessSent = new Promise<void>((resolve) => {
      sent = resolve
    })
    const host = createProcessHost({
      ...fixture.options,
      endpointFactory: async (...args) => {
        const served = await original(...args)
        return {
          ...served,
          endpoint: {
            ...served.endpoint,
            send<T>(...input: Parameters<typeof served.endpoint.send>) {
              const pending = served.endpoint.send<T>(...input)
              if (input[1].endsWith('.request')) sent()
              return pending
            },
            announceClose(...input) {
              close()
              return served.endpoint.announceClose(...input)
            }
          }
        }
      }
    })
    try {
      const feature = await host.use('p')
      const request = feature.f!.request!(['delay'])
      await businessSent
      let finished = false
      const releasing = host.release().then(() => {
        finished = true
      })
      await Promise.resolve()
      expect(finished).toBe(false)
      expect(() => host.inspect()).toThrow(expect.objectContaining({ code: 'PROCESS_HOST_CLOSED' }))
      expect(await request).toMatchObject({ pid: fixture.handles[0]!.identity.pid, input: 'delay' })
      await releasing
      expect(close).toHaveBeenCalledTimes(1)
      await fixture.handles[0]!.exited
    } finally {
      await host.release()
    }
  })
  it('[A1] controls a real initially empty Node Host through the local catalog resolver', async () => {
    const fixture = nativeHostOptions()
    const host = createProcessHost(fixture.options)
    try {
      expect(fixture.handles).toHaveLength(0)
      await host.ready()
      expect(await host.inspect()).toMatchObject({ plugins: [] })
      const features = await host.use('p', { portable: 'configuration' })
      const response = await features.f!.request!(['hello'])
      expect(response).toMatchObject({
        pid: fixture.handles[0]!.identity.pid,
        input: 'hello',
        config: { portable: 'configuration' },
        resolutions: 1,
        calls: 1
      })
      expect(await host.inspect()).toMatchObject({ plugins: [{ name: 'p', state: 'enabled' }] })
      await host.unUse('p')
      expect(await host.inspect()).toMatchObject({ plugins: [] })
      await host.release()
      await fixture.handles[0]!.exited
    } finally {
      await host.release()
    }
  })
  it('[A1] stays lazy, delegates catalog control and gates release synchronously', async () => {
    const fixture = hostFixture()
    const host = createProcessHost(fixture.options)
    expect(fixture.launch).not.toHaveBeenCalled()
    await host.ready()
    expect(host.inspectRegistration()).toMatchObject({ state: 'ready', health: 'custom' })
    await host.use('p')
    await host.inspect()
    await host.unUse('p')
    expect(fixture.send.mock.calls.map((row) => row[1])).toEqual([
      'migaia.remote.describe',
      'migaia.remote.host.use',
      'migaia.remote.host.inspect',
      'migaia.remote.host.unUse'
    ])
    const release = host.release()
    expect(host.release()).toBe(release)
    for (const operation of [
      () => host.ready(),
      () => host.use('p'),
      () => host.inspect(),
      () => host.unUse('p'),
      () => host.restart(),
      () => host.replace()
    ])
      expect(operation).toThrow(expect.objectContaining({ code: 'PROCESS_HOST_CLOSED' }))
    await release
    expect(fixture.terminate).toHaveBeenCalledTimes(1)
    expect(fixture.upstream.calls.filter((value) => value === 'endpoint.dispose')).toHaveLength(1)
  })

  it('[A2/A4] rejects borrowed strategy and scheduler mismatch before dial or launch', () => {
    const fixture = hostFixture()
    const dial = vi.fn()
    expect(() =>
      createProcessHost({ ...fixture.options, scheduler: createManualScheduler() })
    ).toThrow(
      expect.objectContaining({
        code: 'PROCESS_HOST_INVALID_OPTION',
        detail: { field: 'scheduler' }
      })
    )
    expect(() =>
      createProcessHost({
        ...fixture.options,
        replaceStrategy: 'start-then-switch',
        deployment: {
          kind: 'connect',
          address: 'fixture',
          token: 'fixture-secret',
          dial,
          establish: async () => fixture.upstream.channel
        }
      })
    ).toThrow(
      expect.objectContaining({
        code: 'PROCESS_HOST_INVALID_OPTION',
        detail: { field: 'replaceStrategy' }
      })
    )
    expect(fixture.launch).not.toHaveBeenCalled()
    expect(dial).not.toHaveBeenCalled()
  })

  it('[A1] escalates a second signal once while awaiting the owned exit and unsubscribes', async () => {
    const fixture = hostFixture()
    let settleExit!: (value: { code: number; signal: null }) => void
    let notify: (() => void) | undefined
    const unsubscribe = vi.fn(() => {
      notify = undefined
    })
    const terminate = vi.fn((mode: string) => {
      if (mode === 'force') settleExit({ code: 0, signal: null })
    })
    if (fixture.options.deployment.kind !== 'spawn') throw new Error('fixture deployment')
    const host = createProcessHost({
      ...fixture.options,
      shutdownSignal: {
        subscribe(listener) {
          notify = () => listener('SIGTERM')
          return unsubscribe
        }
      },
      deployment: {
        ...fixture.options.deployment,
        supervision: {
          ...fixture.options.deployment.supervision,
          launcher: {
            capabilities: fixture.options.deployment.supervision.launcher.capabilities,
            launch: async () => ({
              identity: { fingerprint: 'signal-host' },
              exited: new Promise((resolve) => {
                settleExit = resolve
              }),
              terminate
            })
          }
        }
      }
    })
    await host.ready()
    notify?.()
    notify?.()
    notify?.()
    await host.release()
    expect(terminate.mock.calls.filter((row) => row[0] === 'force')).toHaveLength(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

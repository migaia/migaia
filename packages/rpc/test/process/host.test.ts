import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createProcessHost } from '../../src/process/host/client.js'
import { hostFixture } from './fixtures/host-control.js'
import { nativeHostOptions } from './fixtures/host-native.js'

describe('process Host facade admission and ownership', () => {
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

import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createProcessHost } from '../../src/process/host/client.js'
import { hostFixture, runtimeHostFixture } from './fixtures/host-control.js'
import * as bindingModule from '../../src/process/plugin/binding.js'
import { nativeHostFixture } from './fixtures/host-native.js'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import { RemoteMethodName } from '../../src/remote/constants.js'
import type { IRemoteRetryPort } from '../../src/remote/types.js'
import { createLifecycleScope, type IAbortSignal } from '@migaia/lifecycle'

describe('process Host facade admission and ownership', () => {
  it('[K221/A1] drains an external retry port without changing its call count or Promise', async () => {
    /** No endpoint send owns this logical operation; the caller-supplied retry port does. */
    const fixture = nativeHostFixture()
    /** Preserve the original drain-timer oracle on the actual native binding's clock. */
    const scheduler = createManualScheduler()
    /** Preserve the exact settlement object and Promise produced by the external owner. */
    const value = Object.freeze({ completed: true })
    /** The external owner decides when its request settles. */
    let settle!: (result: typeof value) => void
    const pending = new Promise<typeof value>((resolve) => {
      settle = resolve
    })
    /** Count forwarding at the external boundary instead of inspecting internal drain counters. */
    const dispatch = vi.fn(() => pending)
    /** Reserved controls perform their real single send; this external owner handles business only. */
    const external: IRemoteRetryPort = {
      dispatch: (input) =>
        input.method === 'p.request'
          ? dispatch()
          : input.sendOnce({ expectedGeneration: input.generation, key: input.key })
    }
    /** Observe actual endpoint work and actual process termination independently from retry. */
    const sends: string[] = []
    const terminate = vi.fn()
    const factory = fixture.options.endpointFactory
    const launcher = fixture.options.spawn.supervision.launcher
    const plugin = createProcessPlugin({
      ...fixture.options,
      retryPort: external,
      endpointFactory: async (...args) => {
        const served = await factory(...args)
        return {
          ...served,
          endpoint: {
            ...served.endpoint,
            send<T>(...input: Parameters<typeof served.endpoint.send>) {
              sends.push(input[1])
              return served.endpoint.send<T>(...input)
            }
          }
        }
      },
      spawn: {
        ...fixture.options.spawn,
        supervision: {
          ...fixture.options.spawn.supervision,
          scheduler,
          launcher: {
            ...launcher,
            async launch(spec, context) {
              /** Native exit and identity remain those of the original launched handle. */
              const handle = await launcher.launch(spec, context)
              return {
                ...handle,
                terminate: (...args) => {
                  terminate(...args)
                  return handle.terminate(...args)
                }
              }
            }
          }
        }
      }
    })
    try {
      await fixture.host.use(plugin)
      const outlet = fixture.host.process!
      await outlet.request('child', RemoteMethodName.hostUse, ['p'])
      const request = outlet.request('child', 'p.request', [])
      expect(request).toBe(pending)
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(sends.filter((method) => method === 'p.request')).toHaveLength(0)
      const closing = fixture.close()
      await Promise.resolve()
      await Promise.resolve()
      expect(terminate).not.toHaveBeenCalled()
      settle(value)
      expect(await request).toBe(value)
      await closing
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(terminate).toHaveBeenCalledTimes(1)
      await fixture.handles[0]!.exited
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      settle(value)
      await fixture.close()
    }
  })

  it('[A1] forwards the process call wall cap through the existing remote dispatcher', async () => {
    /** A real native endpoint records the effective deadline selected by its canonical dispatcher. */
    const fixture = nativeHostFixture()
    /** The unchanged exact 60ms oracle uses the original unadvanced manual dispatch clock. */
    const scheduler = createManualScheduler()
    /** One typed observer preserves every endpoint argument at the canonical dispatch boundary. */
    const sends: unknown[][] = []
    const original = fixture.options.endpointFactory
    const plugin = createProcessPlugin({
      ...fixture.options,
      spawn: {
        ...fixture.options.spawn,
        supervision: {
          ...fixture.options.spawn.supervision,
          scheduler,
          spec: { ...fixture.options.spawn.supervision.spec, limits: { callWallTimeMs: 60 } }
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
      await fixture.host.use(plugin)
      const outlet = fixture.host.process!
      await outlet.request('child', RemoteMethodName.hostUse, ['p'])
      await outlet.request('child', 'p.request', 'deadline', { timeoutMs: 120 })
      expect(sends.at(-1)?.[3]).toMatchObject({ timeoutMs: 60 })
    } finally {
      await fixture.close()
    }
  })
  it('[A1] announces one close and waits for the real in-flight request before child exit', async () => {
    const fixture = nativeHostFixture()
    const original = fixture.options.endpointFactory
    const close = vi.fn()
    /** The committed channel keeps its preparation signal detached while Host drains live work. */
    let generationSignal: IAbortSignal | undefined
    let sent!: () => void
    const businessSent = new Promise<void>((resolve) => {
      sent = resolve
    })
    const plugin = createProcessPlugin({
      ...fixture.options,
      endpointFactory: async (...args) => {
        generationSignal = args[1]
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
      await fixture.host.use(plugin)
      const outlet = fixture.host.process!
      await outlet.request('child', RemoteMethodName.hostUse, ['p'])
      const request = outlet.request('child', 'p.request', 'delay')
      /** Observe any cleanup rejection immediately while preserving the actual request Promise. */
      const outcome = Promise.allSettled([request])
      await businessSent
      let finished = false
      const releasing = fixture.close().then(() => {
        finished = true
      })
      await Promise.resolve()
      expect(finished).toBe(false)
      expect(() => outlet.request('child', RemoteMethodName.hostInspect, [])).toThrow(
        expect.objectContaining({ source: '@migaia/plugin-host', code: 'HOST_DISPOSING' })
      )
      const observed = (await outcome)[0]!
      expect(observed).toMatchObject({ status: 'fulfilled' })
      expect(generationSignal?.aborted).toBe(false)
      expect(await request).toMatchObject({ pid: fixture.handles[0]!.identity.pid, input: 'delay' })
      await releasing
      expect(close).toHaveBeenCalledTimes(1)
      await fixture.handles[0]!.exited
    } finally {
      await fixture.close()
    }
  })
  it('[A1] controls a real initially empty Node Host through the local catalog resolver', async () => {
    const fixture = nativeHostFixture()
    try {
      expect(fixture.handles).toHaveLength(0)
      await fixture.host.use(fixture.plugin)
      const outlet = fixture.host.process!
      expect(await outlet.request('child', RemoteMethodName.hostInspect, [])).toMatchObject({
        plugins: []
      })
      await outlet.request('child', RemoteMethodName.hostUse, ['p', { portable: 'configuration' }])
      const response = await outlet.request('child', 'p.request', 'hello')
      expect(response).toMatchObject({
        pid: fixture.handles[0]!.identity.pid,
        input: 'hello',
        config: { portable: 'configuration' },
        resolutions: 1,
        calls: 1
      })
      expect(await outlet.request('child', RemoteMethodName.hostInspect, [])).toMatchObject({
        plugins: [{ name: 'p', state: 'enabled' }]
      })
      await outlet.request('child', RemoteMethodName.hostUnUse, ['p'])
      expect(await outlet.request('child', RemoteMethodName.hostInspect, [])).toMatchObject({
        plugins: []
      })
      await fixture.close()
      await fixture.handles[0]!.exited
    } finally {
      await fixture.close()
    }
  })
  it('[A1] stays lazy, delegates catalog control and gates release synchronously', async () => {
    const fixture = runtimeHostFixture()
    /** The observer calls the original binding constructor and exposes its actual health policy. */
    const binding = vi.spyOn(bindingModule, 'createSpawnProcessBinding')
    try {
      expect(fixture.launch).not.toHaveBeenCalled()
      await fixture.host.use(fixture.plugin)
      const outlet = fixture.host.process!
      expect((await outlet.get('child')).unit).toMatchObject({
        state: 'ready'
      })
      expect(binding.mock.results[0]?.value).toMatchObject({ health: 'custom' })
      await outlet.request('child', RemoteMethodName.hostUse, ['p'])
      await outlet.request('child', RemoteMethodName.hostInspect, [])
      await outlet.request('child', RemoteMethodName.hostUnUse, ['p'])
      expect(fixture.send.mock.calls.map((row) => row[1])).toEqual([
        'migaia.remote.runtime.describe',
        'migaia.remote.host.use',
        'migaia.remote.host.inspect',
        'migaia.remote.host.unUse'
      ])
      const release = fixture.close()
      expect(fixture.close()).toBe(release)
      for (const operation of [
        () => outlet.request('child', 'p.f.m', []),
        () => outlet.request('child', RemoteMethodName.hostUse, ['p']),
        () => outlet.request('child', RemoteMethodName.hostInspect, []),
        () => outlet.request('child', RemoteMethodName.hostUnUse, ['p']),
        () => outlet.restart('child'),
        () => outlet.replace('child')
      ])
        expect(operation).toThrow(
          expect.objectContaining({ source: '@migaia/plugin-host', code: 'HOST_DISPOSING' })
        )
      await release
      expect(fixture.terminate).toHaveBeenCalledTimes(1)
      expect(fixture.upstream.calls.filter((value) => value === 'endpoint.dispose')).toHaveLength(1)
    } finally {
      await fixture.close()
      binding.mockRestore()
    }
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
    const fixture = runtimeHostFixture()
    let settleExit!: (value: { code: number; signal: null }) => void
    let notify: (() => void) | undefined
    const unsubscribe = vi.fn(() => {
      notify = undefined
    })
    const terminate = vi.fn((mode: string) => {
      if (mode === 'force') settleExit({ code: 0, signal: null })
    })
    const plugin = createProcessPlugin({
      ...fixture.options,
      spawn: {
        ...fixture.options.spawn,
        supervision: {
          ...fixture.options.spawn.supervision,
          launcher: {
            capabilities: fixture.options.spawn.supervision.launcher.capabilities,
            launch: async () => ({
              identity: { fingerprint: 'signal-host' },
              exited: new Promise<{ code: number; signal: null }>((resolve) => {
                settleExit = resolve
              }),
              terminate
            })
          }
        }
      }
    })
    /** Signal subscription belongs to the caller; canonical native stop/kill own escalation. */
    const subscription = createLifecycleScope({ scheduler: fixture.scheduler })
    /** The original stop Promise is the only fact distinguishing initial shutdown from escalation. */
    let stopping: Promise<void> | undefined
    try {
      await fixture.host.use(plugin)
      const outlet = fixture.host.process!
      notify = () => {
        if (stopping) void outlet.kill('child').catch(fixture.report)
        else stopping = outlet.stop('child')
      }
      subscription.own(unsubscribe, { force: () => unsubscribe() })
      notify()
      notify()
      notify()
      await stopping
      await fixture.close()
    } finally {
      await fixture.close()
      await subscription.dispose()
    }
    expect(terminate.mock.calls.filter((row) => row[0] === 'force')).toHaveLength(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

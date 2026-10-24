import type { IAbortSignal } from '@migaia/utils/promise'
import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { hostFixture, runtimeHostFixture } from './fixtures/host-control.js'
import * as bindingModule from '../../../rpc-plugin-process/dist/process/plugin/binding.js'
import { nativeHostFixture } from './fixtures/host-native.js'
import { processPlugin } from '@migaia/rpc-plugin-process'
import type { IRemoteRetryPort } from '@migaia/rpc-host/plugin'
import { createLifecycleScope } from '@migaia/lifecycle'
import { readRuntimePeerEndpoint } from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import { readEndpointOwner } from '../../../rpc-host/dist/core/internal/endpoint-projection.js'
import type { IEndpointKernelHost } from '../../../rpc-host/dist/core/endpoint-kernel.js'

describe('process native Host admission and ownership', () => {
  it('drains an external retry port without changing its call count or Promise', async () => {
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
        input.method === 'p.f.request'
          ? dispatch()
          : input.sendOnce({ expectedGeneration: input.generation, key: input.key })
    }
    /** Observe actual endpoint work and actual process termination independently from retry. */
    const sends: string[] = []
    const terminate = vi.fn()

    const launcher = fixture.options.spawn.supervision.launcher
    fixture.observeEndpoint((served) => {
      return {
        ...served,
        endpoint: Object.create(
          served.endpoint,
          Object.getOwnPropertyDescriptors({
            send<T>(...input: Parameters<typeof served.endpoint.send>) {
              sends.push(input[1])
              return served.endpoint.send<T>(...input)
            }
          })
        )
      }
    })
    const plugin = processPlugin({
      ...fixture.options,
      retryPort: external,

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
      await fixture.ready()

      const request = outlet.request('child', 'p.f.request', [])
      expect(request).toBe(pending)
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(sends.filter((method) => method === 'p.f.request')).toHaveLength(0)
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

  it('forwards the process call wall cap through the existing remote dispatcher', async () => {
    /** A real native endpoint records the effective deadline selected by its canonical dispatcher. */
    const fixture = nativeHostFixture()
    /** The unchanged exact 60ms oracle uses the original unadvanced manual dispatch clock. */
    const scheduler = createManualScheduler()
    /** One typed observer preserves every endpoint argument at the canonical dispatch boundary. */
    const sends: unknown[][] = []

    fixture.observeEndpoint((served) => {
      return {
        ...served,
        endpoint: Object.create(
          served.endpoint,
          Object.getOwnPropertyDescriptors({
            send<T>(...input: Parameters<typeof served.endpoint.send>) {
              sends.push(input)
              return served.endpoint.send<T>(...input)
            }
          })
        )
      }
    })
    const plugin = processPlugin({
      ...fixture.options,
      spawn: {
        ...fixture.options.spawn,
        supervision: {
          ...fixture.options.spawn.supervision,
          scheduler,
          spec: { ...fixture.options.spawn.supervision.spec, limits: { callWallTimeMs: 60 } }
        }
      }
    })
    try {
      await fixture.host.use(plugin)
      const outlet = fixture.host.process!
      await fixture.ready()

      await outlet.request('child', 'p.f.request', 'deadline', { timeoutMs: 120 })
      expect(sends.at(-1)?.[3]).toMatchObject({ timeoutMs: 60 })
    } finally {
      await fixture.close()
    }
  })
  it('announces one close and waits for the real in-flight request before child exit', async () => {
    const fixture = nativeHostFixture()

    const close = vi.fn()
    /** The committed channel keeps its preparation signal detached while Host drains live work. */
    let generationSignal: IAbortSignal | undefined
    let sent!: () => void
    const businessSent = new Promise<void>((resolve) => {
      sent = resolve
    })
    fixture.observeEndpoint((served, _channel, signal) => {
      generationSignal = signal

      return {
        ...served,
        endpoint: Object.create(
          served.endpoint,
          Object.getOwnPropertyDescriptors({
            send<T>(...input: Parameters<typeof served.endpoint.send>) {
              const pending = served.endpoint.send<T>(...input)
              if (input[1].endsWith('.request')) sent()
              return pending
            },
            announceClose(...input: Parameters<typeof served.endpoint.announceClose>) {
              close()
              return served.endpoint.announceClose(...input)
            }
          })
        )
      }
    })
    const plugin = processPlugin({
      ...fixture.options
    })
    try {
      await fixture.host.use(plugin)
      const outlet = fixture.host.process!
      await fixture.ready()

      const request = outlet.request('child', 'p.f.request', 'delay')
      /** Observe any cleanup rejection immediately while preserving the actual request Promise. */
      const outcome = Promise.allSettled([request])
      await businessSent
      let finished = false
      const releasing = fixture.close().then(() => {
        finished = true
      })
      await Promise.resolve()
      expect(finished).toBe(false)
      expect(() => outlet.request('child', 'p.f.request', [])).toThrow(
        expect.objectContaining({ source: 'plugin.host', code: 'HOST_DISPOSING' })
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

  it('stays lazy, publishes native business and gates release synchronously', async () => {
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
      /** The final ordinary Host owns one shared kernel, beyond its borrowed per-session views. */
      const kernel = readEndpointOwner<IEndpointKernelHost>(
        readRuntimePeerEndpoint(readRuntimeOutletConnection(outlet, 'child')!.peer).endpoint,
        'kernel'
      )!
      /** Observe the actual final kernel transition rather than an unused session disposal wrapper. */
      const disposal = vi.spyOn(kernel, 'completeDispose')

      expect(await outlet.request('child', 'p.f.m', [])).toEqual({ ok: true })
      expect(fixture.send.mock.calls.map((row) => row[1])).toEqual([
        'migaia.remote.runtime.describe',
        'p.f.m'
      ])
      const release = fixture.close()
      expect(fixture.close()).toBe(release)
      for (const operation of [
        () => outlet.request('child', 'p.f.m', []),
        () => outlet.request('child', 'p.f.request', []),
        () => outlet.restart('child'),
        () => outlet.replace('child')
      ])
        expect(operation).toThrow(
          expect.objectContaining({ source: 'plugin.host', code: 'HOST_DISPOSING' })
        )
      await release
      expect(fixture.terminate).toHaveBeenCalledTimes(1)
      expect(disposal).toHaveBeenCalledTimes(1)
    } finally {
      await fixture.close()
      binding.mockRestore()
    }
  })

  it('rejects borrowed replacement before another dial or native launch', async () => {
    const fixture = hostFixture()
    const dial = vi.fn()
    /** Borrowed native execution never acquires a replacement unit or dials another connection. */
    const source = fixture.connectSource()
    try {
      await fixture.host.use(
        processPlugin({
          name: 'borrowed',
          self: { name: 'parent', instanceId: 'parent' },
          connect: { target: source },
          report: fixture.report
        })
      )
      const dials = source.dial.mock.calls.length
      expect(() => fixture.host.process!.replace('borrowed')).toThrow(
        expect.objectContaining({ code: 'CAPABILITY_CONFLICT' })
      )
      expect(fixture.launch).not.toHaveBeenCalled()
      expect(source.dial.mock.calls).toHaveLength(dials)
      expect(dial).not.toHaveBeenCalled()
    } finally {
      await fixture.close()
    }
  })

  it('escalates a second signal once while awaiting the owned exit and unsubscribes', async () => {
    const fixture = runtimeHostFixture()
    let settleExit!: (value: { code: number; signal: null }) => void
    let notify: (() => void) | undefined
    const unsubscribe = vi.fn(() => {
      notify = undefined
    })
    const terminate = vi.fn((mode: string) => {
      if (mode === 'force') settleExit({ code: 0, signal: null })
    })
    const plugin = processPlugin({
      ...fixture.options,
      spawn: {
        ...fixture.options.spawn,
        supervision: {
          ...fixture.options.spawn.supervision,
          launcher: {
            capabilities: fixture.options.spawn.supervision.launcher.capabilities,
            launch: async (...args) => {
              /** Preserve the exact handle identity that owns the genuine byte ports. */
              const handle = await fixture.options.spawn.supervision.launcher.launch(...args)
              /** The original native termination still owns channel/handle cleanup on force. */
              const force = handle.terminate
              return Object.assign(handle, {
                exited: new Promise<{ code: number; signal: null }>((resolve) => {
                  settleExit = resolve
                }),
                terminate: (mode: Parameters<typeof force>[0]) => {
                  terminate(mode)
                  if (mode === 'force') return force(mode)
                }
              })
            }
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

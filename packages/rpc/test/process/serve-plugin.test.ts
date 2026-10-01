import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import type { IRemoteChannel } from '../../src/remote/types.js'
import { createServeProcessPlugin } from '../../src/process/plugin/serve.js'
import type { IProcessPendingByteConnection } from '../../src/process/types.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import type { IProcessSessionIdentity } from '../../src/process/resilience/types.js'

/** A single request contract lets the test observe per-connection service ownership. */
const contract = {
  schemaVersion: 1 as const,
  plugin: 'p',
  features: { f: { methods: { request: { mode: 'request' as const, idempotent: false } } } }
}

/** Existing shared fixtures declare their recovery ports before accepting a connection. */
const sharedRecovery = {
  createSharedTarget: async () => undefined,
  onInstanceUnhealthy: () => () => undefined
}

/** Creates a target that remote services may reference without owning it. */
async function targetHost() {
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  const target = definePlugin({
    name: 'p',
    features: { f: defineFeature(() => ({ request: () => 'live' })) },
    install: () => ({ version: () => 1 })
  })
  const [targetHandle] = await host.use(target)
  return { host, targetHandle }
}

/** A fake accepted channel exposes its terminal notification and close count. */
function acceptedChannel(id: string) {
  /** The callback belongs to this physical connection alone. */
  let onError: ((error: unknown) => void) | undefined
  const close = vi.fn(async () => undefined)
  const channel = {
    peerId: id,
    scheduler: createManualScheduler(),
    agreement: { capabilities: [] },
    transport: {
      subscribe: () => () => undefined,
      onTransportError(listener: (error: unknown) => void) {
        onError = listener
        return () => {
          onError = undefined
        }
      }
    },
    close
  } as unknown as IRemoteChannel
  return { channel, close, fail: () => onError?.(new Error('EOF')) }
}

/** Lets asynchronous service cleanup settle without a timing assertion. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve()
}

describe('process plugin service ingress', () => {
  it('[A5] closes the unhealthy shared session and replaces its real Host target', async () => {
    const { host, targetHandle } = await targetHost()
    const physical = acceptedChannel('first')
    const second = acceptedChannel('second')
    const third = acceptedChannel('third')
    let onConnection: (pending: IProcessPendingByteConnection) => void | Promise<void> = () =>
      undefined
    let unhealthy: (event: { targetName: string; reason: unknown }) => void = () => undefined
    const createSharedTarget = vi.fn(() =>
      definePlugin({
        name: 'p',
        features: { f: defineFeature(() => ({ request: () => 'new' })) },
        install: () => ({ version: () => 2 })
      })
    )
    const report = vi.fn()
    const endpointFactory = vi.fn(async () => ({
      endpoint: {
        provide: vi.fn(),
        dispose: vi.fn(async () => undefined)
      } as unknown as IRpcEndpoint
    }))
    const serving = await createServeProcessPlugin({
      host,
      contract,
      createSharedTarget,
      onInstanceUnhealthy(listener) {
        unhealthy = listener
        return () => undefined
      },
      endpointFactory,
      report,
      ingress: {
        kind: 'listener',
        address: 'fixture',
        verify: () => 'principal',
        offer: createNativeProcessOffer({ peer: { id: 'listener', runtime: 'node' } }),
        createConnectionContext: (pending) => ({
          peerId:
            pending === firstPending ? 'first' : pending === secondPending ? 'second' : 'third',
          ipc: {
            connectionId: pending === firstPending ? 'c1' : pending === secondPending ? 'c2' : 'c3',
            sessionId: pending === firstPending ? 's1' : pending === secondPending ? 's2' : 's3',
            log: () => undefined
          }
        }),
        listen: async ({ onConnection: callback }) => {
          onConnection = callback
          return { address: 'fixture', close: async () => undefined }
        }
      }
    })
    const firstPending: IProcessPendingByteConnection = {
      accept: async () => ({ channel: physical.channel, principalId: 'alice' }),
      close: async () => undefined
    }
    const secondPending: IProcessPendingByteConnection = {
      accept: async () => ({ channel: second.channel, principalId: 'bob' }),
      close: async () => undefined
    }
    const thirdPending: IProcessPendingByteConnection = {
      accept: async () => ({ channel: third.channel, principalId: 'carol' }),
      close: async () => undefined
    }
    try {
      expect(serving.inspectRecovery()).toEqual({ recoverable: true, fused: false })
      await onConnection(firstPending)
      await onConnection(secondPending)
      expect(targetHandle.extensions.version()).toBe(1)
      unhealthy({ targetName: 'p', reason: new Error('target failed') })
      await vi.waitFor(() => {
        expect(physical.close).toHaveBeenCalledOnce()
        expect(second.close).toHaveBeenCalledOnce()
      })
      expect(createSharedTarget).toHaveBeenCalledOnce()
      await vi.waitFor(() => expect(targetHandle.extensions.version()).toBe(2))
      expect(serving.inspectRecovery()).toEqual({ recoverable: true, fused: false })
      expect(report).toHaveBeenCalledTimes(0)
      await onConnection(thirdPending)
      expect(endpointFactory).toHaveBeenCalledTimes(3)
    } finally {
      await serving.close()
      await host.dispose()
    }
  })

  it('[A5] reports a narrow Host before accepting and exposes its unrecoverable fuse', async () => {
    const { host } = await targetHost()
    /** This caller implements exactly the formerly documented service Host port. */
    const narrow = { use: host.use, unUse: host.unUse, plugin: host.plugin }
    const report = vi.fn()
    const listen = vi.fn(async () => ({ address: 'fixture', close: async () => undefined }))
    let unhealthy: (event: { targetName: string; reason: unknown }) => void = () => undefined
    const createSharedTarget = vi.fn(async () => definePlugin({ name: 'p', install: () => ({}) }))
    try {
      const serving = await createServeProcessPlugin({
        host: narrow,
        contract,
        createSharedTarget,
        onInstanceUnhealthy(listener) {
          unhealthy = listener
          return () => undefined
        },
        endpointFactory: vi.fn(),
        report,
        ingress: {
          kind: 'listener',
          address: 'fixture',
          verify: () => 'principal',
          offer: createNativeProcessOffer({ peer: { id: 'listener', runtime: 'node' } }),
          createConnectionContext: () => ({
            peerId: 'peer',
            ipc: { connectionId: 'c', sessionId: 's', log: () => undefined }
          }),
          listen
        }
      })
      try {
        expect(report).toHaveBeenCalledTimes(1)
        expect(report.mock.calls[0]?.[0]).toMatchObject({
          code: 'PROCESS_INSTANCE_UNHEALTHY',
          detail: { field: 'host.replace' }
        })
        expect(serving.inspectRecovery()).toEqual({ recoverable: false, fused: false })
        unhealthy({ targetName: 'p', reason: new Error('instance failed') })
        await vi.waitFor(() => expect(serving.inspectRecovery().fused).toBe(true))
        expect(serving.inspectRecovery().recoverable).toBe(false)
        expect(report).toHaveBeenCalledTimes(1)
        expect(createSharedTarget).not.toHaveBeenCalled()
      } finally {
        await serving.close()
      }
    } finally {
      await host.dispose()
    }
  })

  it('[A2] rejects missing recovery factories before listener binding', async () => {
    const { host } = await targetHost()
    const listen = vi.fn()
    try {
      await expect(
        createServeProcessPlugin({
          host,
          contract,
          instanceMode: 'per-connection',
          endpointFactory: vi.fn(),
          report: vi.fn(),
          ingress: {
            kind: 'listener',
            address: 'fixture',
            verify: () => 'principal',
            offer: createNativeProcessOffer({ peer: { id: 'listener', runtime: 'node' } }),
            createConnectionContext: () => ({
              peerId: 'peer',
              ipc: { connectionId: 'c', sessionId: 's', log: () => undefined }
            }),
            listen
          }
        })
      ).rejects.toMatchObject({ detail: { field: 'createSessionHost' } })
      expect(listen).not.toHaveBeenCalled()
    } finally {
      await host.dispose()
    }
  })

  it('[A2] creates one target Host per authenticated connection', async () => {
    const { host: fallback } = await targetHost()
    const first = acceptedChannel('first')
    const second = acceptedChannel('second')
    const created: Array<Awaited<ReturnType<typeof targetHost>>> = []
    let onConnection!: (pending: IProcessPendingByteConnection) => void | Promise<void>
    const createSessionHost = vi.fn(async (_session: IProcessSessionIdentity) => {
      const next = await targetHost()
      created.push(next)
      return next.host
    })
    const serving = await createServeProcessPlugin({
      host: fallback,
      contract,
      instanceMode: 'per-connection',
      createSessionHost,
      endpointFactory: async () => ({
        endpoint: {
          provide: vi.fn(),
          dispose: vi.fn(async () => undefined)
        } as unknown as IRpcEndpoint
      }),
      report: vi.fn(),
      ingress: {
        kind: 'listener',
        address: 'fixture',
        verify: () => 'principal',
        offer: createNativeProcessOffer({ peer: { id: 'listener', runtime: 'node' } }),
        createConnectionContext: (pending) => ({
          peerId: pending === firstPending ? 'first' : 'second',
          ipc: {
            connectionId: pending === firstPending ? 'c1' : 'c2',
            sessionId: pending === firstPending ? 's1' : 's2',
            log: () => undefined
          }
        }),
        listen: async ({ onConnection: callback }) => {
          onConnection = callback
          return { address: 'fixture', close: async () => undefined }
        }
      }
    })
    const firstPending: IProcessPendingByteConnection = {
      accept: async () => ({ channel: first.channel, principalId: 'alice' }),
      close: async () => undefined
    }
    const secondPending: IProcessPendingByteConnection = {
      accept: async () => ({ channel: second.channel, principalId: 'bob' }),
      close: async () => undefined
    }
    try {
      await onConnection(firstPending)
      await onConnection(secondPending)
      expect(createSessionHost).toHaveBeenCalledTimes(2)
      expect(createSessionHost.mock.calls[0]?.[0]).toMatchObject({
        sessionId: 's1',
        principalId: 'alice'
      })
      expect(createSessionHost.mock.calls[1]?.[0]).toMatchObject({
        sessionId: 's2',
        principalId: 'bob'
      })
      expect(created[0]!.host).not.toBe(created[1]!.host)
      first.fail()
      await settle()
      expect(second.close).not.toHaveBeenCalled()
    } finally {
      await serving.close()
      await fallback.dispose()
    }
  })

  it('[A4] rejects a listener without a verifier before binding', async () => {
    const { host } = await targetHost()
    const listen = vi.fn()
    const endpointFactory = vi.fn()
    try {
      await expect(
        createServeProcessPlugin({
          host,
          contract,
          ...sharedRecovery,
          endpointFactory,
          report: () => undefined,
          ingress: {
            kind: 'listener',
            address: 'fixture',
            verify: undefined as never,
            offer: {} as never,
            createConnectionContext: () => ({ peerId: 'peer', ipc: {} as never }),
            listen
          }
        })
      ).rejects.toMatchObject({ code: 'PROCESS_PLUGIN_INVALID_OPTION' })
      expect(listen).not.toHaveBeenCalled()
      expect(endpointFactory).not.toHaveBeenCalled()
    } finally {
      await host.dispose()
    }
  })

  it('[A4] closes byte ingress without a verifier before establishing a responder', async () => {
    const { host } = await targetHost()
    const rawClose = vi.fn(async () => undefined)
    const establish = vi.fn()
    const endpointFactory = vi.fn()
    const exit = vi.fn()
    try {
      await expect(
        createServeProcessPlugin({
          host,
          contract,
          ...sharedRecovery,
          endpointFactory,
          report: () => undefined,
          ingress: {
            kind: 'child',
            channelKind: 'byte',
            openRaw: async () => ({
              raw: {
                kind: 'byte',
                write: async () => undefined,
                onData: () => () => undefined,
                onClose: () => () => undefined,
                close: rawClose
              },
              bootstrap: new Uint8Array([1])
            }),
            establish,
            parentLoss: { exit }
          }
        })
      ).rejects.toMatchObject({ code: 'PROCESS_PLUGIN_INVALID_OPTION' })
      await settle()
      expect(rawClose).toHaveBeenCalledTimes(1)
      expect(establish).not.toHaveBeenCalled()
      expect(endpointFactory).not.toHaveBeenCalled()
      expect(exit).toHaveBeenCalledTimes(1)
    } finally {
      await host.dispose()
    }
  })

  it('[A4] gives accepted sessions distinct endpoints and closes only the departed session', async () => {
    const { host, targetHandle } = await targetHost()
    const first = acceptedChannel('first')
    const second = acceptedChannel('second')
    const dispose = [vi.fn(async () => undefined), vi.fn(async () => undefined)]
    const provide = [
      vi.fn((_method: string, _handler: (context: never) => unknown) => undefined),
      vi.fn((_method: string, _handler: (context: never) => unknown) => undefined)
    ]
    /** Listener admission remains callable until the serve handle closes. */
    let onConnection: ((pending: IProcessPendingByteConnection) => void | Promise<void>) | undefined
    const listenerClose = vi.fn(async () => undefined)
    const endpointFactory = vi.fn(async () => {
      const index = endpointFactory.mock.calls.length - 1
      return {
        endpoint: {
          provide: provide[index]!,
          dispose: dispose[index]!
        } as unknown as IRpcEndpoint
      }
    })
    const report = vi.fn()
    try {
      const serving = await createServeProcessPlugin({
        host,
        contract,
        ...sharedRecovery,
        endpointFactory,
        report,
        ingress: {
          kind: 'listener',
          address: 'fixture',
          verify: () => 'principal',
          offer: createNativeProcessOffer({ peer: { id: 'listener', runtime: 'node' } }),
          createConnectionContext: (pending) => ({
            peerId: pending === firstPending ? 'first' : 'second',
            ipc: {
              connectionId: pending === firstPending ? 'connection-1' : 'connection-2',
              sessionId: pending === firstPending ? 'session-1' : 'session-2',
              log: () => undefined
            }
          }),
          listen: async ({ onConnection: callback }) => {
            onConnection = callback
            return { address: 'fixture', close: listenerClose }
          }
        }
      })
      /** Distinct ready channels model two independently authenticated sessions. */
      const firstPending: IProcessPendingByteConnection = {
        accept: vi.fn(async () => ({ channel: first.channel, principalId: 'first-principal' })),
        close: vi.fn(async () => undefined)
      }
      const secondPending: IProcessPendingByteConnection = {
        accept: vi.fn(async () => ({ channel: second.channel, principalId: 'second-principal' })),
        close: vi.fn(async () => undefined)
      }
      const failedClose = vi.fn(async () => undefined)
      const failedPending: IProcessPendingByteConnection = {
        accept: vi.fn(async () => {
          throw new Error('rejected token')
        }),
        close: failedClose
      }
      await onConnection?.(firstPending)
      await onConnection?.(failedPending)
      await onConnection?.(secondPending)
      expect(endpointFactory).toHaveBeenCalledTimes(2)
      expect(failedClose).toHaveBeenCalledTimes(1)
      expect(firstPending.accept).toHaveBeenCalledWith(
        expect.objectContaining({ ipc: expect.objectContaining({ sessionId: 'session-1' }) })
      )
      expect(secondPending.accept).toHaveBeenCalledWith(
        expect.objectContaining({ ipc: expect.objectContaining({ sessionId: 'session-2' }) })
      )
      expect(provide[0]).toHaveBeenCalled()
      expect(provide[1]).toHaveBeenCalled()
      const firstRequest = provide[0]!.mock.calls.find(([method]) => method === 'p.f.request')?.[1]
      const secondRequest = provide[1]!.mock.calls.find(([method]) => method === 'p.f.request')?.[1]
      expect(
        await firstRequest?.({
          data: [],
          signal: { aborted: false },
          success: (value: unknown) => value
        } as never)
      ).toBe('live')
      expect(
        await secondRequest?.({
          data: [],
          signal: { aborted: false },
          success: (value: unknown) => value
        } as never)
      ).toBe('live')
      first.fail()
      await settle()
      expect(dispose[0]).toHaveBeenCalledTimes(1)
      expect(dispose[1]).not.toHaveBeenCalled()
      expect(first.close).toHaveBeenCalledTimes(1)
      expect(second.close).not.toHaveBeenCalled()
      const closing = serving.close()
      expect(serving.close()).toBe(closing)
      await closing
      expect(listenerClose).toHaveBeenCalledTimes(1)
      expect(dispose[1]).toHaveBeenCalledTimes(1)
      expect(second.close).toHaveBeenCalledTimes(1)
      expect(targetHandle.getFeature('f')).toBeDefined()
      expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'rejected token' }))
    } finally {
      await host.dispose()
    }
  })

  it('[A6] closes a channel that authenticates after the serve handle starts closing', async () => {
    const { host, targetHandle } = await targetHost()
    const accepted = acceptedChannel('late')
    /** The pending accept controls the precise close/handshake ordering. */
    let finishAccept!: (value: { channel: IRemoteChannel; principalId: string }) => void
    const authenticated = new Promise<{ channel: IRemoteChannel; principalId: string }>(
      (resolve) => {
        finishAccept = resolve
      }
    )
    /** The listener invokes each pending callback without owning its completion. */
    let onConnection!: (pending: IProcessPendingByteConnection) => void | Promise<void>
    const endpointFactory = vi.fn()
    const report = vi.fn()
    const serving = await createServeProcessPlugin({
      host,
      contract,
      ...sharedRecovery,
      endpointFactory,
      report,
      ingress: {
        kind: 'listener',
        address: 'fixture',
        verify: () => 'principal',
        offer: createNativeProcessOffer({ peer: { id: 'listener', runtime: 'node' } }),
        createConnectionContext: () => ({
          peerId: 'late',
          ipc: { connectionId: 'late', sessionId: 'late', log: () => undefined }
        }),
        listen: async ({ onConnection: callback }) => {
          onConnection = callback
          return { address: 'fixture', close: async () => undefined }
        }
      }
    })
    try {
      const pending: IProcessPendingByteConnection = {
        accept: () => authenticated,
        close: vi.fn(async () => undefined)
      }
      const accepting = onConnection(pending)
      const closing = serving.close()
      finishAccept({ channel: accepted.channel, principalId: 'principal' })
      await accepting
      await closing
      expect(accepted.close).toHaveBeenCalledTimes(1)
      expect(endpointFactory).not.toHaveBeenCalled()
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PROCESS_CHANNEL_CLOSED' })
      )
      expect(targetHandle.getFeature('f')).toBeDefined()
    } finally {
      await host.dispose()
    }
  })

  it('[A6] disposes an endpoint returned after listener close without publishing it', async () => {
    const { host } = await targetHost()
    const accepted = acceptedChannel('late-endpoint')
    /** The endpoint becomes available only after the handle has begun closing. */
    let finishEndpoint!: (value: { endpoint: IRpcEndpoint }) => void
    const prepared = new Promise<{ endpoint: IRpcEndpoint }>((resolve) => {
      finishEndpoint = resolve
    })
    const dispose = vi.fn(async () => undefined)
    let onConnection!: (pending: IProcessPendingByteConnection) => void | Promise<void>
    const endpointFactory = vi.fn(() => prepared)
    const report = vi.fn()
    const serving = await createServeProcessPlugin({
      host,
      contract,
      ...sharedRecovery,
      endpointFactory,
      report,
      ingress: {
        kind: 'listener',
        address: 'fixture',
        verify: () => 'principal',
        offer: createNativeProcessOffer({ peer: { id: 'listener', runtime: 'node' } }),
        createConnectionContext: () => ({
          peerId: 'late-endpoint',
          ipc: { connectionId: 'late', sessionId: 'late', log: () => undefined }
        }),
        listen: async ({ onConnection: callback }) => {
          onConnection = callback
          return { address: 'fixture', close: async () => undefined }
        }
      }
    })
    try {
      const accepting = onConnection({
        accept: async () => ({ channel: accepted.channel, principalId: 'principal' }),
        close: vi.fn(async () => undefined)
      })
      await settle()
      expect(endpointFactory).toHaveBeenCalledTimes(1)
      const closing = serving.close()
      finishEndpoint({ endpoint: { dispose } as unknown as IRpcEndpoint })
      await accepting
      await closing
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(accepted.close).toHaveBeenCalledTimes(1)
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PROCESS_CHANNEL_CLOSED' })
      )
    } finally {
      await host.dispose()
    }
  })

  it('[A6] retains listener, endpoint, and channel cleanup failures in order', async () => {
    const { host } = await targetHost()
    const listenerError = new Error('listener cleanup failed')
    const endpointError = new Error('endpoint cleanup failed')
    const channelError = new Error('channel cleanup failed')
    const report = vi.fn()
    const dispose = vi.fn(async () => {
      throw endpointError
    })
    const closeChannel = vi.fn(async () => {
      throw channelError
    })
    let onConnection!: (pending: IProcessPendingByteConnection) => void | Promise<void>
    const serving = await createServeProcessPlugin({
      host,
      contract,
      ...sharedRecovery,
      report,
      endpointFactory: async () => ({
        endpoint: { provide: vi.fn(), dispose } as unknown as IRpcEndpoint
      }),
      ingress: {
        kind: 'listener',
        address: 'fixture',
        verify: () => 'principal',
        offer: createNativeProcessOffer({ peer: { id: 'listener', runtime: 'node' } }),
        createConnectionContext: () => ({
          peerId: 'cleanup',
          ipc: { connectionId: 'cleanup', sessionId: 'cleanup', log: () => undefined }
        }),
        listen: async ({ onConnection: callback }) => {
          onConnection = callback
          return {
            address: 'fixture',
            close: async () => {
              throw listenerError
            }
          }
        }
      }
    })
    try {
      await onConnection({
        accept: async () => ({
          channel: {
            ...acceptedChannel('cleanup').channel,
            close: closeChannel
          },
          principalId: 'principal'
        }),
        close: vi.fn(async () => undefined)
      })
      const failure = await serving.close().then(
        () => undefined,
        (error: unknown) => error
      )
      expect(failure).toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
      expect(failure).toBeInstanceOf(AggregateError)
      const outer = failure as AggregateError
      expect(outer.errors[0]).toBe(listenerError)
      expect(outer.errors[1]).toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
      expect((outer.errors[1] as AggregateError).errors).toEqual([endpointError, channelError])
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(closeChannel).toHaveBeenCalledTimes(1)
      expect(report).not.toHaveBeenCalled()
    } finally {
      await host.dispose()
    }
  })
})

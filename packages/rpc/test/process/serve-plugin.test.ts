import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import type { IRemoteChannel } from '../../src/remote/types.js'
import { createServeProcessPlugin } from '../../src/process/plugin/serve.js'
import type { IProcessPendingByteConnection } from '../../src/process/types.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'

/** A single request contract lets the test observe per-connection service ownership. */
const contract = {
  schemaVersion: 1 as const,
  plugin: 'p',
  features: { f: { methods: { request: { mode: 'request' as const, idempotent: false } } } }
}

/** Creates a target that remote services may reference without owning it. */
async function targetHost() {
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  const target = definePlugin({
    name: 'p',
    features: { f: defineFeature(() => ({ request: () => 'live' })) },
    install: () => ({})
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
    transport: {
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
  it('[A4] rejects a listener without a verifier before binding', async () => {
    const { host } = await targetHost()
    const listen = vi.fn()
    const endpointFactory = vi.fn()
    try {
      await expect(
        createServeProcessPlugin({
          host,
          contract,
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
      expect(await firstRequest?.({ data: [], success: (value: unknown) => value } as never)).toBe(
        'live'
      )
      expect(await secondRequest?.({ data: [], success: (value: unknown) => value } as never)).toBe(
        'live'
      )
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
})

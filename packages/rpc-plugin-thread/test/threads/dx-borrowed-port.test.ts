import { MessageChannel } from 'node:worker_threads'
import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createNodeThreadChannel } from '../../dist/threads/channel.js'
import { createRpcHost } from '@migaia/rpc-host'
import { createAdapterDeployment, defineTransportPlugin } from '@migaia/rpc-host/plugin'
import type { IRuntimePeer } from '@migaia/rpc-host/plugin'
import { deferred } from '@migaia/utils/promise'

/** The two accepted remote descriptions expose only the opposite peer's application methods. */
type ILeftApi = { greet(name: string): string }
/** Right-side method typing is independent from the local provide descriptor. */
type IRightApi = { twice(value: number): number }
/** The default-address case proves an ordinary accepted request after identity selection. */
type IEchoApi = { echo(value: string): string }

describe('borrowed MessagePort runtime peers', () => {
  it('calls both directions after actual capability ACK on the two held ports', async () => {
    /** The caller owns both native ports and closes them after borrowed peers retire. */
    const ports = new MessageChannel()
    /** Failed construction still leaves each successfully acquired peer available for cleanup. */
    const peers: Pick<IRuntimePeer, 'close'>[] = []
    try {
      /** Both source proposals come from the Core-owned runtime assembly, never a hand-written list. */
      const opened = await Promise.all([
        createRpcHost<IRightApi>({
          self: { name: 'left', instanceId: 'left-1' },
          provide: { greet: (name: string) => `hello ${name}` },
          plugins: [
            defineTransportPlugin({
              name: 'thread',
              mode: 'connect',
              deployment: createAdapterDeployment({
                runtimeKey: 'thread',
                runtimeFamily: createNodeThreadChannel,
                open: async (context) =>
                  createNodeThreadChannel(ports.port1, 'right-1', {
                    scheduler: systemScheduler,
                    capabilities: context.capabilities
                  })
              })
            })
          ],
          report: () => undefined
        }),
        createRpcHost<ILeftApi>({
          self: { name: 'right', instanceId: 'right-1' },
          provide: { twice: (value: number) => value * 2 },
          plugins: [
            defineTransportPlugin({
              name: 'thread',
              mode: 'connect',
              deployment: createAdapterDeployment({
                runtimeKey: 'thread',
                runtimeFamily: createNodeThreadChannel,
                open: async (context) =>
                  createNodeThreadChannel(ports.port2, 'left-1', {
                    scheduler: systemScheduler,
                    capabilities: context.capabilities
                  })
              })
            })
          ],
          report: () => undefined
        })
      ])
      peers.push(...opened)
      expect(await opened[1].request('greet', 'world')).toBe('hello world')
      expect(await opened[0].request('twice', 21)).toBe(42)
      await opened[0].close()
      expect(ports.port1.listenerCount('message')).toBe(0)
      /** Borrowed close leaves the physical port under caller ownership. */
      ports.port1.postMessage({ fixture: 'caller still owns port' })
    } finally {
      await Promise.all(peers.map((peer) => peer.close()))
      ports.port1.close()
      ports.port2.close()
    }
  })

  it('gives main-thread connect sources a Core default self when none is configured', async () => {
    /** Independent held ports exercise the same default identity path as deployed spawn sources. */
    const ports = new MessageChannel()
    /** Only one successful default-address construction needs to be exposed through the public API. */
    const peers: Pick<IRuntimePeer, 'close'>[] = []
    /** The caller learns only the generated local address supplied to its ordinary source callback. */
    const leftAddress = deferred<string>()
    try {
      /** Peer ids identify the opposite logical connection; endpoint addressing remains Core-owned. */
      const opened = await Promise.all([
        createRpcHost({
          provide: { echo: (value: string) => value },
          plugins: [
            defineTransportPlugin({
              name: 'thread',
              mode: 'connect',
              deployment: createAdapterDeployment({
                runtimeKey: 'thread',
                runtimeFamily: createNodeThreadChannel,
                open: async (context) => {
                  leftAddress.resolve(context.self.instanceId)
                  return createNodeThreadChannel(ports.port1, 'right', {
                    scheduler: systemScheduler,
                    capabilities: context.capabilities
                  })
                }
              })
            })
          ],
          report: () => undefined
        }),
        createRpcHost<IEchoApi>({
          self: { name: 'right', instanceId: 'right' },
          plugins: [
            defineTransportPlugin({
              name: 'thread',
              mode: 'connect',
              deployment: createAdapterDeployment({
                runtimeKey: 'thread',
                runtimeFamily: createNodeThreadChannel,
                open: async (context) =>
                  createNodeThreadChannel(ports.port2, await leftAddress.promise, {
                    scheduler: systemScheduler,
                    capabilities: context.capabilities
                  })
              })
            })
          ],
          report: () => undefined
        })
      ])
      peers.push(...opened)
      expect(opened[0].self).toMatchObject({
        name: expect.any(String),
        instanceId: expect.any(String)
      })
      expect(opened[0].self.name).toBe(opened[0].self.instanceId)
      expect(await opened[1].request('echo', 'default address')).toBe('default address')
    } finally {
      await Promise.all(peers.map((peer) => peer.close()))
      ports.port1.close()
      ports.port2.close()
    }
  })
})

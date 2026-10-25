import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { borrowedThreadPlugin } from './fixtures/borrowed-source.js'
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
    const peers: Pick<IRpcHost, 'close'>[] = []
    try {
      /** Both source proposals come from the Core-owned runtime assembly, never a hand-written list. */
      const opened = await Promise.all([
        createRpcHost<IRightApi, readonly [ReturnType<typeof borrowedThreadPlugin>]>({
          self: { name: 'left', instanceId: 'left-1' },
          provide: { greet: (name: string) => `hello ${name}` },
          plugins: [borrowedThreadPlugin(ports.port1, 'right-1')],
          report: () => undefined
        }),
        createRpcHost<ILeftApi, readonly [ReturnType<typeof borrowedThreadPlugin>]>({
          self: { name: 'right', instanceId: 'right-1' },
          provide: { twice: (value: number) => value * 2 },
          plugins: [borrowedThreadPlugin(ports.port2, 'left-1')],
          report: () => undefined
        })
      ])
      peers.push(...opened)
      expect(await opened[1].thread.request('greet', 'world')).toBe('hello world')
      expect(await opened[0].thread.request('twice', 21)).toBe(42)
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
    const peers: Pick<IRpcHost, 'close'>[] = []
    /** The caller learns only the generated local address supplied to its ordinary source callback. */
    const leftAddress = deferred<string>()
    try {
      /** Peer ids identify the opposite logical connection; endpoint addressing remains Core-owned. */
      const opened = await Promise.all([
        createRpcHost({
          provide: { echo: (value: string) => value },
          plugins: [
            borrowedThreadPlugin(ports.port1, 'right', undefined, (context) =>
              leftAddress.resolve(context.self().instanceId)
            )
          ],
          report: () => undefined
        }),
        createRpcHost<IEchoApi, readonly [ReturnType<typeof borrowedThreadPlugin>]>({
          self: { name: 'right', instanceId: 'right' },
          plugins: [borrowedThreadPlugin(ports.port2, 'left')],
          report: () => undefined
        })
      ])
      peers.push(...opened)
      expect(opened[0].self).toMatchObject({
        name: expect.any(String),
        instanceId: expect.any(String)
      })
      expect(opened[0].self.name).toBe(opened[0].self.instanceId)
      expect(await leftAddress.promise).toBe(opened[0].self.instanceId)
      expect(await opened[1].thread.request('echo', 'default address')).toBe('default address')
    } finally {
      await Promise.all(peers.map((peer) => peer.close()))
      ports.port1.close()
      ports.port2.close()
    }
  })
})

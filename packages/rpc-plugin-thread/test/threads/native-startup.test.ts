import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { createThreadBootstrap, readThreadInitial } from '../../dist/threads/bootstrap.js'
import { ThreadBootstrap } from '../../src/threads/constants.ts'
import { borrowedThreadPlugin } from './fixtures/borrowed-source.ts'

/** The real native initial reader supplies only trusted launch facts to the one Session owner. */
function nativeChildSource(port: MessageChannel['port2'], bootstrap: unknown) {
  return borrowedThreadPlugin(port, 'native-child-port', () => readThreadInitial(bootstrap).source)
}

describe('advanced native parent-port startup', () => {
  it('connects the actual borrowed native ports using the original raw child bootstrap', async () => {
    /** The caller owns both real ports; Peer shutdown only removes borrowed listeners. */
    const ports = new MessageChannel()
    /** Keep all successfully opened peers available even if the opposite construction fails. */
    const peers: Pick<IRpcHost, 'close'>[] = []
    /** The advanced child consumes the same raw metadata a native Worker receives at construction. */
    let child!: Promise<
      IRpcHost<Record<never, never>, readonly [ReturnType<typeof borrowedThreadPlugin>]>
    >
    try {
      /** The parent supplies its actual Core-selected identity and capability proposal. */
      const parent = await createRpcHost<
        { twice(value: number): number },
        readonly [ReturnType<typeof borrowedThreadPlugin>]
      >({
        self: { name: 'native-parent', instanceId: 'native-parent' },
        plugins: [
          borrowedThreadPlugin(ports.port1, 'parent-port', undefined, (context) => {
            /** Native parent identity is the original closed two-field bootstrap record. */
            const self = context.self()
            child = createRpcHost({
              provide: { twice: (value: number) => value * 2 },
              plugins: [
                nativeChildSource(
                  ports.port2,
                  createThreadBootstrap('native-child', 'native-child', undefined, {
                    childName: 'native-child',
                    parent: { name: self.name, instanceId: self.instanceId },
                    generation: { kind: 'restart', value: 0, providerId: 'native-startup' }
                  })
                )
              ]
            })
          })
        ],
        report: () => undefined
      })
      peers.push(parent)
      /** Startup ACK yields the actual child Peer rather than accepting caller-supplied trust. */
      const accepted = await child
      peers.push(accepted)
      expect(accepted.self).toEqual({ name: 'native-child', instanceId: 'native-child' })
      expect(await parent.thread.request('twice', 21)).toBe(42)
      await accepted.close()
      expect(ports.port2.listenerCount('message')).toBe(0)
    } finally {
      await Promise.all(peers.map((peer) => peer.close()))
      ports.port1.close()
      ports.port2.close()
    }
  })

  it('rejects cloneable incomplete workerData before exposing a provider or retaining the native listener', async () => {
    /** A real MessagePort still belongs to the caller when native bootstrap validation fails. */
    const ports = new MessageChannel()
    /** No public method may run before its child metadata has been admitted. */
    const provide = vi.fn((value: number) => value)
    /** Caller diagnostics exercise the advanced API's explicit reporter path. */
    const report = vi.fn()
    try {
      await expect(
        createRpcHost({
          provide: { echo: provide },
          report,
          plugins: [
            nativeChildSource(ports.port2, {
              kind: ThreadBootstrap.data,
              peerId: 'native-child',
              source: {}
            })
          ]
        })
      ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'INVALID_CONFIG' })
      expect(provide).not.toHaveBeenCalled()
      expect(ports.port2.listenerCount('message')).toBe(0)
    } finally {
      ports.port1.close()
      ports.port2.close()
    }
  })
})

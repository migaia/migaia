import { describe, expect, it } from 'vitest'
import {
  createNativeProcessOffer,
  createProcessPeer,
  createProcessTransport,
  type IProcessByteListener
} from '@migaia/rpc-process'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '@migaia/rpc-process/adapters/node-socket'

/** The same local socket token authenticates the public listener and connect sources. */
const token = 'listener-capability-fixture'

describe('Process listener runtime capabilities', () => {
  it.each([false, true])(
    '[DX1] derives runtime capabilities for a plain native listener offer (stream=%s)',
    async (stream) => {
      /** The actual bound address is acquired through the public listener adapter. */
      let listener: IProcessByteListener | undefined
      /** Every asynchronous report remains available to the assertion and final cleanup. */
      const reports: unknown[] = []
      /** Both sides use the owning public peer factories, never a prepared Core context. */
      let client:
        | Awaited<ReturnType<typeof createProcessPeer<{ math: { double(value: number): number } }>>>
        | undefined
      /** A plain offer deliberately omits the internal runtime capability list. */
      const server = await createProcessPeer({
        provide: { math: { double: (value: number) => value * 2 } },
        report: (error) => reports.push(error),
        listen: {
          kind: 'listener',
          address: 'tcp://127.0.0.1:0',
          listen: async (options) => {
            listener = await listenProcessByteChannel(options)
            return listener
          },
          verify: (auth) => {
            expect(auth).toBe(token)
            return 'fixture-client'
          },
          offer: createNativeProcessOffer({
            peer: { id: 'fixture-server', runtime: 'node' },
            stream
          }),
          createConnectionContext: () => ({
            peerId: 'fixture-client',
            ipc: {
              connectionId: 'listener-capability',
              sessionId: 'listener-capability',
              log: () => undefined
            }
          })
        }
      })
      try {
        client = await createProcessPeer<{ math: { double(value: number): number } }>({
          self: { name: 'fixture-client', instanceId: 'fixture-client' },
          report: (error) => reports.push(error),
          connect: {
            kind: 'connect',
            address: listener!.address,
            token,
            supervision: { restart: { mode: 'never' } },
            dial: (address, signal) =>
              dialProcessByteChannel({ address, signal: signal as AbortSignal }),
            establish: (raw, prepared) => {
              if (raw.kind !== 'byte') throw new TypeError('Expected socket byte channel')
              return createProcessTransport(raw, {
                role: 'initiator',
                peerId: 'fixture-server',
                offer: prepared.offer!,
                scheduler: prepared.scheduler,
                signal: prepared.signal as AbortSignal,
                ipc: { ...prepared.session, log: () => undefined },
                report: (error) => reports.push(error)
              })
            }
          }
        })
        expect(await client.request('math.double', 21)).toBe(42)
        expect(reports).toEqual([])
      } finally {
        await client?.close()
        await server.close()
      }
    }
  )

  it('[DX1] keeps an explicitly narrow listener offer narrow', async () => {
    /** Capture the real bound address without opening another listener owner. */
    let listener: IProcessByteListener | undefined
    /** A caller-specified empty extension list is an explicit control-only proposal. */
    const offer = createNativeProcessOffer({
      peer: { id: 'narrow-server', runtime: 'node' },
      capabilities: []
    })
    /** Rejection reporting proves no runtime capability was silently added. */
    const reports: unknown[] = []
    const server = await createProcessPeer({
      provide: { echo: (value: string) => value },
      report: (error) => reports.push(error),
      listen: {
        kind: 'listener',
        address: 'tcp://127.0.0.1:0',
        listen: async (options) => {
          listener = await listenProcessByteChannel(options)
          return listener
        },
        verify: () => 'narrow-client',
        offer,
        createConnectionContext: () => ({
          peerId: 'narrow-client',
          ipc: { connectionId: 'narrow', sessionId: 'narrow', log: () => undefined }
        })
      }
    })
    try {
      await expect(
        createProcessPeer({
          self: { name: 'narrow-client', instanceId: 'narrow-client' },
          report: (error) => reports.push(error),
          connect: {
            kind: 'connect',
            address: listener!.address,
            token,
            supervision: { restart: { mode: 'never' } },
            dial: (address, signal) =>
              dialProcessByteChannel({ address, signal: signal as AbortSignal }),
            establish: (raw, prepared) => {
              if (raw.kind !== 'byte') throw new TypeError('Expected socket byte channel')
              return createProcessTransport(raw, {
                role: 'initiator',
                peerId: 'narrow-server',
                offer: prepared.offer!,
                scheduler: prepared.scheduler,
                signal: prepared.signal as AbortSignal,
                ipc: { ...prepared.session, log: () => undefined },
                report: (error) => reports.push(error)
              })
            }
          }
        })
      ).rejects.toMatchObject({ code: 'REMOTE_START_FAILED' })
      expect(reports).toContainEqual(
        expect.objectContaining({
          source: '@migaia/rpc/contract',
          code: 'HANDSHAKE_INCOMPATIBLE',
          reason: 'protocol'
        })
      )
      expect(offer.capabilities).not.toContain('runtime-api@1')
    } finally {
      await server.close()
    }
  })
})

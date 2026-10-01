import { describe, expect, it } from 'vitest'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'

/** Verifier output is a stable principal rather than arbitrary truthy metadata. */
describe('process socket principal admission', () => {
  it.each(['', { unexpected: true }] as const)(
    '[D8] refuses a principal that is not a nonempty string',
    async (principal) => {
      let settle: (error: unknown) => void = () => undefined
      const rejected = new Promise<unknown>((resolve) => {
        settle = resolve
      })
      const listener = await listenProcessByteChannel({
        address: 'tcp://127.0.0.1:0',
        auth: { mode: 'required', verify: () => principal as string },
        report: () => undefined,
        async onConnection(pending) {
          try {
            await pending.accept({
              peerId: 'dialer',
              offer: createNativeProcessOffer({ peer: { id: 'listener', runtime: 'node' } }),
              report: () => undefined,
              ipc: { connectionId: 'server', sessionId: 'server', log: () => undefined }
            })
            settle(undefined)
          } catch (error) {
            settle(error)
          }
        }
      })
      const raw = await dialProcessByteChannel({ address: listener.address })
      try {
        await expect(
          createProcessTransport(raw, {
            role: 'initiator',
            peerId: 'listener',
            offer: createNativeProcessOffer({
              peer: { id: 'dialer', runtime: 'node' },
              auth: 'token'
            }),
            report: () => undefined,
            ipc: { connectionId: 'client', sessionId: 'client', log: () => undefined }
          })
        ).rejects.toBeDefined()
        await expect(rejected).resolves.toMatchObject({ code: 'PROCESS_CHANNEL_AUTH_REJECTED' })
      } finally {
        await raw.close()
        await listener.close()
      }
    }
  )
})

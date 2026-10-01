import { createConnection } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame
} from '../../src/contract/framing/stream.js'
import { createRpcHello } from '../../src/contract/handshake.js'
import { listenProcessByteChannel } from '../../src/process/adapters/node-socket.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import type { IAuthenticatedProcessChannel } from '../../src/process/types.js'

/** Exercise the first-subscriber race across a real loopback socket. */
describe('process socket early business frames', () => {
  it('[D2] delivers 200/200 frames after a 2 ms subscription delay', async () => {
    /** Each side uses the same framing implementation as the public process channel. */
    const encoder = new TextEncoder()
    const frame = (value: string): Uint8Array => encodeRpcStreamFrame(encoder.encode(value))
    /** The accepted connection resolves before the endpoint subscribes. */
    let acceptConnection: (value: IAuthenticatedProcessChannel) => void = () => undefined
    const accepted = new Promise<IAuthenticatedProcessChannel>((resolve) => {
      acceptConnection = resolve
    })
    const listener = await listenProcessByteChannel({
      address: 'tcp://127.0.0.1:0',
      auth: { mode: 'required', verify: () => 'principal' },
      report: () => undefined,
      onConnection: async (pending) => {
        acceptConnection(
          await pending.accept({
            peerId: 'peer',
            offer: createNativeProcessOffer({ peer: { id: 'server', runtime: 'node' } }),
            report: () => undefined,
            ipc: { connectionId: 'early', sessionId: 'early', log: () => undefined }
          })
        )
      }
    })
    const socket = createConnection({
      host: '127.0.0.1',
      port: Number(new URL(listener.address).port)
    })
    socket.on('error', () => undefined)
    try {
      const decoder = createRpcStreamFrameDecoder({
        onFrame: () => {
          for (let index = 0; index < 200; index += 1) socket.write(frame(`frame-${index}`))
        },
        onError: () => undefined
      })
      socket.on('data', (chunk) => decoder.push(chunk))
      socket.once('connect', () =>
        socket.write(
          frame(
            createRpcHello(
              createNativeProcessOffer({
                peer: { id: 'client', runtime: 'node' },
                auth: 'token'
              })
            )
          )
        )
      )
      const connection = await accepted
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 2))
        const received: string[] = []
        connection.channel.transport.subscribe((message) => received.push(String(message.data)))
        await new Promise<void>((resolve) => setTimeout(resolve, 30))
        expect(received).toEqual(Array.from({ length: 200 }, (_, index) => `frame-${index}`))
      } finally {
        await connection.channel.close()
      }
    } finally {
      socket.destroy()
      await listener.close()
    }
  })
})

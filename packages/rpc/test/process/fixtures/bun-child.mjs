import { openProcessStdioChannel } from '../../../dist/process/adapters/bun-spawn.js'
import { createProcessTransport } from '../../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../dist/process/offer.js'

/** Bun's Node-compatible stdin/stdout carry the same framed channel contract. */
const opened = await openProcessStdioChannel({ bootstrap: 'stdin' })
const token = new TextDecoder().decode(opened.bootstrap)
const channel = await createProcessTransport(opened.channel, {
  role: 'responder',
  offer: createNativeProcessOffer({ peer: { id: 'bun-child', runtime: 'bun' } }),
  auth: {
    mode: 'required',
    verify: (auth) => {
      if (auth !== token) throw new Error('token mismatch')
    }
  },
  peerId: 'bun-parent',
  ipc: { connectionId: 'bun-child', sessionId: 'bun-child', log: () => undefined },
  report: () => undefined
})
channel.transport.subscribe(({ data }) => {
  void channel.transport.send(data)
})

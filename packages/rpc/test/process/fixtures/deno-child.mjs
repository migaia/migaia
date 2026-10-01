import { openProcessStdioChannel } from '../../../dist/process/adapters/deno-command.js'
import { createProcessTransport } from '../../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../dist/process/offer.js'

/** A Deno child consumes native stdio streams and a framed bootstrap. */
const opened = await openProcessStdioChannel({ bootstrap: 'stdin' })
const token = new TextDecoder().decode(opened.bootstrap)
const channel = await createProcessTransport(opened.channel, {
  role: 'responder',
  offer: createNativeProcessOffer({ peer: { id: 'deno-child', runtime: 'deno' } }),
  auth: {
    mode: 'required',
    verify: (auth) => {
      if (auth !== token) throw new Error('token mismatch')
    }
  },
  peerId: 'deno-parent',
  ipc: { connectionId: 'deno-child', sessionId: 'deno-child', log: () => undefined },
  report: () => undefined
})
channel.transport.subscribe(({ data }) => {
  void channel.transport.send(data)
})

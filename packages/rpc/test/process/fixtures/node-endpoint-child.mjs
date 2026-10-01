import { openProcessStdioChannel } from '../../../dist/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../dist/process/offer.js'
import { createEndpoint } from '../../../dist/core/index.js'
import { codec } from '../../../dist/core/middleware/codec.js'
import { framer } from '../../../dist/core/middleware/framer.js'
import { connect } from '../../../dist/core/middleware/connect.js'
import { abort } from '../../../dist/core/middleware/abort.js'

/** A real child endpoint serves the same middleware pipeline as its parent. */
const opened = await openProcessStdioChannel({ bootstrap: 'stdin' })
const token = new TextDecoder().decode(opened.bootstrap)
/** A paused stdin needs a live handle so the test child does not exit early. */
let pauseKeeper
/** A test-only signal resumes a deliberately paused physical stdin reader. */
process.on('SIGUSR1', () => {
  clearInterval(pauseKeeper)
  process.stdin.resume()
})
const channel = await createProcessTransport(opened.channel, {
  role: 'responder',
  offer: createNativeProcessOffer({ peer: { id: 'child', runtime: 'node' } }),
  auth: {
    mode: 'required',
    verify: (auth) => {
      if (auth !== token) throw new Error('token mismatch')
    }
  },
  peerId: 'parent',
  ipc: { connectionId: 'child', sessionId: 'child', log: () => undefined },
  report: () => undefined
})
const endpoint = await createEndpoint({
  id: 'child',
  transport: channel.transport,
  features: channel.features,
  provider: {
    echo: (context) => context.success(context.data),
    pause: (context) => {
      process.stdin.pause()
      pauseKeeper = setInterval(() => undefined, 1_000)
      return context.success('paused')
    },
    wait: (context) =>
      new Promise((resolve) => {
        context.signal.addEventListener('abort', () => resolve(context.success('cancelled')), {
          once: true
        })
      })
  },
  middlewares: [
    codec(channel.pipeline.codec),
    framer(channel.pipeline.framer),
    abort(),
    connect({ transport: channel.transport })
  ]
})
channel.transport.onTransportError?.(() => {
  void endpoint.dispose().then(() => process.exit(0))
})

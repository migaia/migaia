import { openProcessStdioChannel } from '@migaia/rpc-plugin-process/adapters/node-child-process'
import { createProcessTransport } from '../../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../../rpc-plugin-process/dist/process/offer.js'
import { createFullEndpoint as createEndpoint } from '../../../../rpc-host/dist/core/full.js'
import { codec } from '../../../../rpc-host/dist/core/index.js'
import { framer } from '../../../../rpc-host/dist/core/index.js'
import { connect } from '../../../../rpc-host/dist/core/index.js'
import { abort } from '../../../../rpc-host/dist/core/index.js'

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

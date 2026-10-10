import { parentPort, workerData } from 'node:worker_threads'
import * as threads from '../../../dist/threads/index.js'
import { createComposedEndpoint } from '../../../dist/core/composed.js'
import { createCanonicalChunkFeature } from '../../../dist/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../../dist/core/features/outbound.js'
import { createProviderFeature } from '../../../dist/core/features/provider.js'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { messageFramerV1 } from '../../../dist/contract/framing/index.js'
import { connect } from '../../../dist/core/middleware/connect.js'

/** The future public factory branch never turns a missing export/import into a RED failure. */
let initialized
if (typeof threads.createThreadPeer === 'function') {
  initialized = threads.createThreadPeer({
    provide: {
      /** Await the same actual factory result rather than guessing bootstrap readiness. */
      probe: async (value) => {
        const peer = await initialized
        return { value, self: peer.self, parent: await peer.request('parentEcho') }
      },
      /** Echo binary stream items through the default public Worker owner without transfer. */
      values: async function* (value) {
        yield value
      }
    },
    report: (error) => process.stderr.write(`${error?.code ?? 'fixture-error'}\n`)
  })
} else {
  /** The current real launcher/bootstrap/endpoint path must complete and execute ordinary business. */
  const bootstrap = threads.readThreadBootstrap(workerData)
  const channel = threads.createNodeThreadChannel(parentPort, 'automatic-parent', {
    scheduler: (await import('@migaia/utils/scheduler')).systemScheduler
  })
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  initialized = createComposedEndpoint(
    {
      id: bootstrap.peerId,
      transport: channel.transport,
      codec: identityCodecV1,
      framer: messageFramerV1,
      middlewares: [connect({ transport: channel.transport })],
      provider: {
        probe: (context) =>
          context.success({
            value: context.data,
            self: null,
            parent: workerData.runtimeApi?.parent?.instanceId ?? 'legacy-unavailable'
          })
      }
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-provider': createProviderFeature(outbound)
    }
  )
}
await initialized

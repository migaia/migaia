import { parentPort, workerData } from 'node:worker_threads'
import * as threads from '@migaia/rpc-threads'
import { createComposedEndpoint } from '@migaia/rpc-core/composed'
import { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'
import { createOutboundFeature } from '@migaia/rpc-core/features/outbound'
import { createProviderFeature } from '@migaia/rpc-core/features/provider'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import { messageFramerV1 } from '@migaia/rpc-contract/framing'
import { connect } from '@migaia/rpc-core'

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
      codec: identityCodec,
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

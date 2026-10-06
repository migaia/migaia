import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { openProcessStdioChannel } from '../../../dist/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../dist/process/offer.js'
import { serveProcessSessions } from '../../../dist/process/plugin/serve.js'
import { createProcessResilience } from '../../../dist/process/resilience/index.js'
import { serveRemotePlugin } from '../../../dist/remote/serve-plugin.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createComposedEndpoint } from '../../../dist/core/composed.js'
import { createCanonicalChunkFeature } from '../../../dist/core/features/canonical-chunk.js'
import { createControlFeature } from '../../../dist/core/features/control.js'
import { createDiscoveryFeature } from '../../../dist/core/features/discovery.js'
import { createOutboundFeature } from '../../../dist/core/features/outbound.js'
import { createProviderFeature } from '../../../dist/core/features/provider.js'
import { createStreamFeature } from '../../../dist/core/features/stream.js'
import { codec } from '../../../dist/core/middleware/codec.js'
import { framer } from '../../../dist/core/middleware/framer.js'
import { abort } from '../../../dist/core/middleware/abort.js'
import { connect } from '../../../dist/core/middleware/connect.js'
import { ping } from '../../../dist/core/middleware/ping.js'

/** The real child serves one installed feature through its process-plugin facade. */
const contract = {
  schemaVersion: 1,
  plugin: 'p',
  features: {
    f: {
      methods: {
        request: { mode: 'request', idempotent: false },
        generator: { mode: 'generator', idempotent: false }
      }
    }
  }
}
const host = new PluginHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
await host.use(
  definePlugin({
    name: 'p',
    features: {
      f: defineFeature(() => ({
        request: (value) => `${process.env.RPC_VALUE ?? 'child'}:${value}`,
        generator: function* (value) {
          yield `${value}:1`
          yield `${value}:2`
        }
      }))
    },
    install: () => ({})
  })
)

/** One stream owner composes with the same authenticated channel as requests. */
function streamRoots() {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  const discovery = createDiscoveryFeature(outbound)
  const control = createControlFeature(outbound, discovery)
  const provider = createProviderFeature(outbound)
  return {
    'first-party-chunk': chunk,
    'first-party-outbound': outbound,
    'first-party-discovery': discovery,
    'first-party-control': control,
    'first-party-provider': provider,
    'first-party-stream': createStreamFeature(outbound, provider)
  }
}

/** Reports keep the original native text while bootstrap bytes remain private. */
const report = (error) => process.stderr.write(`${String(error)}\n`)
/** The original session governor is owned by this process service, not its borrowed target Host. */
const resilience = createProcessResilience({ scheduler: systemScheduler, report })
/** Bootstrap bytes only select the authenticated responder verifier on the original byte ingress. */
const ingress = {
  kind: 'child',
  channelKind: 'byte',
  openRaw: async () => {
    const opened = await openProcessStdioChannel({ bootstrap: 'stdin' })
    return { raw: opened.channel, bootstrap: opened.bootstrap }
  },
  createVerifier: (bootstrap) => {
    const expected = new TextDecoder().decode(bootstrap)
    return (actual) => {
      if (actual !== expected) throw new Error('authentication rejected')
    }
  },
  establish: (raw, options) =>
    createProcessTransport(raw, {
      role: options.role,
      offer: createNativeProcessOffer({ peer: { id: 'child', runtime: 'node' }, stream: true }),
      auth: { mode: 'required', verify: options.verify },
      peerId: 'parent',
      scheduler: options.scheduler,
      ipc: { ...options.session, log: () => undefined },
      signal: options.signal,
      report: () => undefined
    }),
  parentLoss: { exit: (code) => process.exit(code) }
}
/** The original canonical roots remain the sole endpoint and stream owners. */
const endpointFactory = async (channel) => {
  const endpoint = await createComposedEndpoint(
    {
      id: 'child',
      transport: channel.transport,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        ping()
      ]
    },
    {
      ...streamRoots(),
      'channel-ipc-log': channel.features[0],
      'channel-ipc-gate': channel.features[1]
    }
  )
  return { endpoint, stream: endpoint.stream }
}
await serveProcessSessions(
  ingress,
  endpointFactory,
  ({ endpoint, identity }) =>
    serveRemotePlugin({
      host,
      contract,
      endpoint,
      report,
      invocationContext: (context) => Object.freeze({ session: identity, signal: context.signal })
    }),
  resilience,
  report,
  undefined,
  systemScheduler,
  { release: () => resilience.close() }
)

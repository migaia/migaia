import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'
import { createProcessTransport } from '@migaia/rpc-process'
import { createNativeProcessOffer } from '@migaia/rpc-process'
import { serveProcessSessions } from '../../../../rpc-process/dist/process/plugin/serve.js'
import { createProcessResilience } from '@migaia/rpc-process'
import { serveRemotePlugin } from '@migaia/rpc-core/remote'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createComposedEndpoint } from '@migaia/rpc-core/composed'
import { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'
import { createControlFeature } from '@migaia/rpc-core/features/control'
import { createDiscoveryFeature } from '@migaia/rpc-core/features/discovery'
import { createOutboundFeature } from '@migaia/rpc-core/features/outbound'
import { createProviderFeature } from '@migaia/rpc-core/features/provider'
import { createStreamFeature } from '@migaia/rpc-core/stream'
import { codec } from '@migaia/rpc-core'
import { framer } from '@migaia/rpc-core'
import { abort } from '@migaia/rpc-core'
import { connect } from '@migaia/rpc-core'
import { ping } from '@migaia/rpc-core'

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

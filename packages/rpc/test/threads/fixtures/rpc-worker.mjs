import { parentPort, workerData as bootstrap } from 'node:worker_threads'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createNodeThreadChannel,
  createServeThreadPlugin,
  createServeThreadHost,
  readThreadBootstrap
} from '../../../dist/threads/index.js'
import { createComposedEndpoint } from '../../../dist/core/composed.js'
import { createCanonicalChunkFeature } from '../../../dist/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../../dist/core/features/outbound.js'
import { createProviderFeature } from '../../../dist/core/features/provider.js'
import { createStreamFeature } from '../../../dist/core/features/stream.js'
import { createControlFeature } from '../../../dist/core/features/control.js'
import { createDiscoveryFeature } from '../../../dist/core/features/discovery.js'
import { abort } from '../../../dist/core/middleware/abort.js'
import { codec } from '../../../dist/core/middleware/codec.js'
import { framer } from '../../../dist/core/middleware/framer.js'
import { connect } from '../../../dist/core/middleware/connect.js'
import { ping } from '../../../dist/core/middleware/ping.js'

/** The private launcher wrapper provides endpoint addressing and preserves the original data. */
const { peerId, data: workerData } = readThreadBootstrap(bootstrap)

/** The first generation can deliberately die after its request has been received. */
function request(value) {
  if (workerData.crash && workerData.generation === 1) {
    setTimeout(() => process.exit(1), workerData.crashDelay ?? 1)
    return new Promise(() => undefined)
  }
  return value
}
/** This Host remains caller-owned by the serve facade. */
const host = new PluginHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
/** Definitions stay local even in Host catalog mode. */
const target = definePlugin({
  name: 'p',
  features: {
    f: defineFeature(() => ({
      read: request,
      write: request,
      hold: () => new Promise(() => undefined),
      bad: () => () => undefined,
      stream: function* (value) {
        yield value
        yield value
      },
      notify: () => undefined
    }))
  },
  install: () => ({})
})
if (!workerData.hostMode) await host.use(target)
/** Node data bypasses the RPC message channel entirely. */
const channel = createNodeThreadChannel(parentPort, 'client', { scheduler: systemScheduler })
/** Every feature is installed in one endpoint construction batch. */
async function endpointFactory(channel) {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  const provider = createProviderFeature(outbound)
  const discovery = createDiscoveryFeature(outbound)
  const endpoint = await createComposedEndpoint(
    {
      id: peerId,
      transport: channel.transport,
      scheduler: channel.scheduler,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport, discoveryMode: 'manual' }),
        ...(workerData.noPing ? [] : [ping()])
      ]
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-provider': provider,
      'first-party-discovery': discovery,
      'first-party-control': createControlFeature(outbound, discovery),
      'first-party-stream': createStreamFeature(outbound, provider)
    }
  )
  return { endpoint, stream: endpoint.stream }
}
/** Diagnostics use raw stderr so subprocess failures remain observable. */
const report = (error) => process.stderr.write(`${error?.stack ?? String(error)}\n`)
if (workerData.hostMode)
  await createServeThreadHost({
    host,
    catalog: { p: workerData.contract },
    resolvePlugin: () => target,
    channel,
    endpointFactory,
    report
  })
else
  await createServeThreadPlugin({
    host,
    contract: workerData.contract,
    channel,
    endpointFactory,
    report
  })

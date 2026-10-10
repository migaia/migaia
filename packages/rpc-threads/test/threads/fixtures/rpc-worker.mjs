import { workerData as bootstrap } from 'node:worker_threads'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { createThreadPlugin, readThreadBootstrap } from '@migaia/rpc-threads'
import { createComposedEndpoint } from '@migaia/rpc-core/composed'
import { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'
import { createOutboundFeature } from '@migaia/rpc-core/features/outbound'
import { createProviderFeature } from '@migaia/rpc-core/features/provider'
import { createOneWayFeature } from '@migaia/rpc-core/features/one-way'
import { createStreamFeature } from '@migaia/rpc-core/stream'
import { createControlFeature } from '@migaia/rpc-core/features/control'
import { createDiscoveryFeature } from '@migaia/rpc-core/features/discovery'
import { abort } from '@migaia/rpc-core'
import { codec } from '@migaia/rpc-core'
import { framer } from '@migaia/rpc-core'
import { connect } from '@migaia/rpc-core'
import { ping } from '@migaia/rpc-core'

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
/** Every feature is installed in one endpoint construction batch. */
async function endpointFactory(channel) {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  const provider = createProviderFeature(outbound)
  const discovery = createDiscoveryFeature(outbound)
  const endpoint = await createComposedEndpoint(
    {
      id: peerId,
      targetIds: [channel.peerId],
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
      'first-party-one-way': createOneWayFeature(outbound),
      'first-party-discovery': discovery,
      'first-party-control': createControlFeature(outbound, discovery),
      'first-party-stream': createStreamFeature(outbound, provider)
    }
  )
  return { endpoint, oneWay: endpoint, stream: endpoint.stream }
}
/** Diagnostics use raw stderr so subprocess failures remain observable. */
const report = (error) => process.stderr.write(`${error?.stack ?? String(error)}\n`)
/** Both directions install the same public Plugin; Host control stays explicitly catalog guarded. */
await host.use(
  createThreadPlugin({
    name: 'parent',
    expose: workerData.hostMode ? ['host', 'p'] : ['p'],
    ...(workerData.hostMode
      ? {
          host,
          catalog: { p: workerData.contract },
          resolvePlugin: () => target
        }
      : {}),
    contract: workerData.contract,
    endpointFactory,
    report
  })
)

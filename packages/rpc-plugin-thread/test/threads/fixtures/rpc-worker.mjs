import { workerData as bootstrap } from 'node:worker_threads'
import { createSyncLifecycleScope } from '@migaia/lifecycle'
import { UtilsAbortError } from '@migaia/utils/error'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { readThreadBootstrap } from '../../../dist/threads/bootstrap.js'
import { createThreadPeer } from '../../protocol.ts'
import { getThreadMessageAdapter } from '../../../dist/threads/adapter.js'
import { assembleAdapterPlugin } from '../../../../rpc-host/dist/runtime-adapter/definition.js'
import { RuntimePluginKey } from '@migaia/rpc-host/plugin'
import { createComposedEndpoint } from '../../../../rpc-host/dist/core/composed.js'
import { createCanonicalChunkFeature } from '@migaia/rpc-host/stream'
import { createOutboundFeature } from '../../../../rpc-host/dist/core/features/outbound.js'
import { createProviderFeature } from '../../../../rpc-host/dist/core/features/provider.js'
import { createOneWayFeature } from '../../../../rpc-host/dist/core/features/one-way.js'
import { createStreamFeature } from '@migaia/rpc-host/stream'
import { createControlFeature } from '../../../../rpc-host/dist/core/features/control.js'
import { createDiscoveryFeature } from '../../../../rpc-host/dist/core/features/discovery.js'
import { abort } from '../../../../rpc-host/dist/core/middleware/abort.js'
import { codec } from '../../../../rpc-host/dist/core/middleware/codec.js'
import { framer } from '../../../../rpc-host/dist/core/middleware/framer.js'
import { connect } from '../../../../rpc-host/dist/core/middleware/connect.js'
import { ping } from '../../../../rpc-host/dist/core/middleware/ping.js'

/** The private launcher wrapper provides endpoint addressing and preserves the original data. */
const { peerId, data: workerData } = readThreadBootstrap(bootstrap)

/**
 * Returns normal fixture data, crashes the selected generation, or rejects with two real package
 * errors.
 *
 * @param {unknown} value Portable business value received through the public request path.
 * @returns {unknown} The original value, or a pending Promise until the deliberate crash.
 * @throws {UtilsAbortError} Source-domain mode wraps the lifecycle admission failure as its cause.
 */
function request(value) {
  if (workerData.sourceDomainFailure) {
    /** A real closed lifecycle owner creates the inner registered package error. */
    const scope = createSyncLifecycleScope()
    scope.dispose()
    try {
      scope.own('already-disposed', { syncSafe: true, force: () => undefined })
    } catch (cause) {
      throw new UtilsAbortError(cause)
    }
  }
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
/** The existing low-level Worker fixture assembles its private Peer through the canonical owner. */
const slotFamily = Object.freeze({})
/** Both directions preserve catalog guarding and the original endpoint factory injection. */
await host.use(
  assembleAdapterPlugin(
    getThreadMessageAdapter(),
    {
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
    },
    {
      key: RuntimePluginKey.thread,
      acquire: (integration, create) =>
        integration.acquireSharedSlot(RuntimePluginKey.thread, slotFamily, create)
    },
    (options) => createThreadPeer(options)
  )
)

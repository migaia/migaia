import { parentPort, workerData } from 'node:worker_threads'
import { systemScheduler } from '@migaia/utils/scheduler'
import { bindNativeReplayTransport } from '../../core/internal/native-replay.js'
import { createRuntimePeer, type IRuntimePeerOptions } from '../../remote/runtime-api/peer.js'
import { createThreadSourcePeer, type IRuntimeThreadPeerOptions } from '../runtime-peer.js'
import { readThreadRuntimeBootstrap, intersectThreadCapabilities } from '../bootstrap.js'
import { createNodeThreadBootstrapHandoff } from '../receive-handoff.js'
import { createNodeThreadChannel } from '../channel.js'
import { ThreadBootstrap, THREAD_RUNTIME_API_VERSION } from '../constants.js'
// Importing the canonical adapter registers provenance for the exact parentPort lazily.
import './node.js'

/** Only a genuine parentPort and complete library bootstrap supply an automatic Worker source. */
export function createThreadPeer(options: IRuntimeThreadPeerOptions) {
  if (!parentPort)
    return typeof options.spawn === 'object'
      ? createThreadSourcePeer(options)
      : createRuntimePeer(options as IRuntimePeerOptions)
  /** Native object identity is independent of every business/bootstrap field. */
  const native = parentPort
  /** Bootstrap reader retains the original fingerprint and safe launch name. */
  const bootstrap = readThreadRuntimeBootstrap(workerData)
  return createRuntimePeer(options as IRuntimePeerOptions, {
    self: bootstrap.self,
    async source(context) {
      /** Cold capture attaches before ACK can cause the parent to send its directory. */
      const handoff = createNodeThreadBootstrapHandoff(native)
      try {
        /** The child offers only its own actual roots, independently of the parent metadata. */
        native.postMessage({
          kind: ThreadBootstrap.runtimeAcknowledged,
          version: THREAD_RUNTIME_API_VERSION,
          capabilities: context.capabilities
        })
        /** The wrapper transfers subscriptions while provenance stays on the exact native port. */
        const channel = createNodeThreadChannel(
          handoff.port,
          bootstrap.parent.instanceId,
          {
            scheduler: systemScheduler,
            capabilities: intersectThreadCapabilities(context.capabilities, bootstrap.capabilities)
          },
          handoff
        )
        bindNativeReplayTransport(native, channel.transport)
        return channel
      } catch (error) {
        handoff.close()
        throw error
      }
    }
  })
}

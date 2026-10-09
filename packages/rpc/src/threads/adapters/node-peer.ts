import {
  readRuntimePreparationContext,
  withRuntimePreparationContext
} from '../../remote/runtime-api/launch-context.js'
import { RpcError, RpcCoreErrorCode } from '../../core/errors.js'
import { RuntimeApiErrorText } from '../../remote/runtime-api/constants.js'
import { readRuntimeDefaultTimeout } from '../../remote/runtime-api/timeout.js'
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
  readRuntimeDefaultTimeout(options)
  if (!parentPort)
    return typeof options.spawn === 'object'
      ? createThreadSourcePeer(options)
      : createRuntimePeer(options as IRuntimePeerOptions)
  /** Native object identity is independent of every business/bootstrap field. */
  const native = parentPort
  /** Bootstrap reader retains the original fingerprint and safe launch name. */
  const bootstrap = readThreadRuntimeBootstrap(workerData)
  /** The actual cold handoff is assigned by the existing connect operation before ACK. */
  const resources = {
    generation: bootstrap.generation,
    bootstrap: undefined as ReturnType<typeof createNodeThreadBootstrapHandoff> | undefined
  }
  /** Ordinary native options keep the exact original Host preparation context. */
  const peerOptions: IRuntimePeerOptions = {
    ...(options as IRuntimePeerOptions),
    // Keep explicit connect as a competing source for the original canonical rejection.
    listen: options.listen ?? options.connect,
    self: options.self ?? bootstrap.self,
    connect: async (context) => {
      if (
        options.self &&
        (options.self.name !== bootstrap.self.name ||
          options.self.instanceId !== bootstrap.self.instanceId)
      )
        throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.identityInvalid)
      /** Cold capture attaches before ACK can cause the parent to send its directory. */
      const handoff = createNodeThreadBootstrapHandoff(native)
      resources.bootstrap = handoff
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
  }
  return withRuntimePreparationContext(
    peerOptions,
    readRuntimePreparationContext(options) ?? {},
    () => createRuntimePeer(peerOptions, resources)
  )
}

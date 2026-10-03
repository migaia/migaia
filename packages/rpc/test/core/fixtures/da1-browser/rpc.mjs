import { createEndpoint, connect, abort } from '@migaia/rpc/core'
import { identityCodecV1 } from '@migaia/serialize/codecs/identity'
import { messageFramer as messageFramerV1 } from '@migaia/rpc/contract/framing/v1'
import { createWebWorkerTransport } from '@migaia/rpc/browser/adapters/web-worker'
import { BrowserBenchText } from './text.mjs'

/**
 * Compose the actual static Worker adapter, keeping all protocol and lifecycle ownership in RPC.
 *
 * @param {object} port Actual Worker or DedicatedWorkerGlobalScope.
 * @param {string} id This deployment endpoint.
 * @param {string} peerId The jointly deployed endpoint.
 * @param {object} classification Existing provider-rejection observations.
 * @returns {Promise<object>} Public endpoint with explicit sampling-only replay capacity.
 */
export async function endpointFor(port, id, peerId, classification) {
  /** The canonical factory alone establishes the static batch agreement. */
  const transport = createWebWorkerTransport(port, { peerId })
  return createEndpoint({
    id,
    targetIds: [peerId],
    transport,
    codec: identityCodecV1,
    framer: messageFramerV1,
    middlewares: [abort(), connect({ transport })],
    providerLimits: {
      maxReplayEntriesPerPeer: 1200,
      onRejected: (event) =>
        classification.rejections.push({
          ...event,
          verifiedPeerKey: '[REDACTED]',
          source: '@migaia/rpc/core',
          code: 'OVERLOADED',
          name: null,
          message: BrowserBenchText.rejected,
          classificationSource: 'existing onRejected; name not supplied'
        })
    }
  })
}

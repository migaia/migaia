import { createCanonicalChunkFeature } from '../../dist/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../dist/core/features/outbound.js'
import { createProviderFeature } from '../../dist/core/features/provider.js'
import {
  createStreamFeature,
  type IRpcStreamCapabilityPort
} from '../../dist/core/features/stream.js'

/** Select one canonical chunk, outbound, provider and optional stream owner per endpoint. */
export function streamRoots(capability?: IRpcStreamCapabilityPort) {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  const provider = createProviderFeature(outbound)
  const stream = createStreamFeature(outbound, provider, { capability })
  return {
    'first-party-chunk': chunk,
    'first-party-outbound': outbound,
    'first-party-provider': provider,
    'first-party-stream': stream
  }
}

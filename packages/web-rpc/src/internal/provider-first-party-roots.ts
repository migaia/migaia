import { createCanonicalChunkFeature } from '../features/canonical-chunk.js'
import { createOutboundFeature } from '../features/outbound.js'
import { createProviderFeature } from '../features/provider.js'
import { registerFirstPartyPublicRoots, type IWebRpcFirstPartyRoots } from './first-party-roots.js'

/** Explicit declaration shape keeps opaque PluginHost feature brands out of public `.d.ts` output. */
type IProviderFirstPartyRoots = IWebRpcFirstPartyRoots<
  Readonly<{
    readonly 'first-party-chunk': ReturnType<typeof createCanonicalChunkFeature>
    readonly 'first-party-outbound': ReturnType<typeof createOutboundFeature>
    readonly 'first-party-provider': ReturnType<typeof createProviderFeature>
  }>,
  'first-party-provider' | 'first-party-outbound'
>

/** Builds provider's native security closure without retaining discovery or control ownership. */
export function createProviderFirstPartyRoots(): IProviderFirstPartyRoots {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  return registerFirstPartyPublicRoots(
    Object.freeze({
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-provider': createProviderFeature(outbound)
    }),
    ['first-party-provider', 'first-party-outbound'] as const
  )
}

import { createCanonicalChunkFeature } from '../features/canonical-chunk.js'
import { createOutboundFeature } from '../features/outbound.js'
import { registerFirstPartyPublicRoots, type IWebRpcFirstPartyRoots } from './first-party-roots.js'

/** Explicit declaration shape keeps opaque PluginHost feature brands out of public `.d.ts` output. */
type IClientFirstPartyRoots = IWebRpcFirstPartyRoots<
  Readonly<{
    readonly 'first-party-chunk': ReturnType<typeof createCanonicalChunkFeature>
    readonly 'first-party-outbound': ReturnType<typeof createOutboundFeature>
  }>,
  'first-party-outbound'
>

/** Builds the client-only native closure without retaining provider or discovery owners. */
export function createClientFirstPartyRoots(): IClientFirstPartyRoots {
  const chunk = createCanonicalChunkFeature()
  return registerFirstPartyPublicRoots(
    Object.freeze({
      'first-party-chunk': chunk,
      'first-party-outbound': createOutboundFeature(chunk)
    }),
    ['first-party-outbound'] as const
  )
}

import { createComposedEndpoint } from '../composed.js'
import { createCanonicalChunkFeature } from '../features/canonical-chunk.js'
import { createOutboundFeature, type IOutboundSurface } from '../features/outbound.js'
import { createProviderFeature, type IProviderRegistrationSurface } from '../features/provider.js'
import { createOneWayFeature, type IOneWaySurface } from '../features/one-way.js'
import {
  createStreamFeature,
  type IRpcStreamRuntime,
  type IRpcStreamCapabilityPort
} from '../features/stream.js'
import type { IRpcFactoryConfig } from '../typing.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'

/** Reject an unavailable runtime operation at its canonical capability/error owner. */
export function rejectRuntimeApiCapability(): never {
  throw new RpcError(RpcCoreErrorCode.capabilityUnsupported, RpcCoreErrorText.capabilityUnsupported)
}

/** The internal symmetric preset exposes only its existing canonical owner surfaces. */
export type IRuntimeApiEndpoint = IOutboundSurface &
  IProviderRegistrationSurface &
  IOneWaySurface &
  Readonly<{
    stream: IRpcStreamRuntime
    dispose(): Promise<void>
  }>

/**
 * Assemble a known two-party runtime channel without discovery traffic. Provider, one-way and
 * stream all depend on the same outbound/security closure; no owner or protocol is duplicated.
 */
export function createRuntimeApiEndpoint(
  config: IRpcFactoryConfig,
  capability: IRpcStreamCapabilityPort
): Promise<IRuntimeApiEndpoint> {
  /** The canonical chunk dependency remains the sole framing/reassembly owner. */
  const chunk = createCanonicalChunkFeature()
  /** Request, response, notify and stream share one sender and inbound identity owner. */
  const outbound = createOutboundFeature(chunk)
  /** Stream and scalar routes remain in the original provider namespace/registry. */
  const provider = createProviderFeature(outbound)
  /** Channel Features join the same explicit root batch rather than the user Feature tuple overload. */
  const { features, ...options } = config
  return createComposedEndpoint(options, {
    'first-party-chunk': chunk,
    'first-party-outbound': outbound,
    'first-party-provider': provider,
    'first-party-one-way': createOneWayFeature(outbound),
    'first-party-stream': createStreamFeature(outbound, provider, { capability }),
    ...Object.fromEntries((features ?? []).map((feature, index) => [`channel-${index}`, feature]))
  }) as Promise<IRuntimeApiEndpoint>
}

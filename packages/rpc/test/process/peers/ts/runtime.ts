import { createComposedEndpoint } from '@migaia/rpc/core/composed'
import { abort, codec, connect, framer, ping, type IRpcEndpoint } from '@migaia/rpc/core'
import { createCanonicalChunkFeature, createStreamFeature } from '@migaia/rpc/core/stream'
import { createOutboundFeature } from '@migaia/rpc/core/features/outbound'
import { createProviderFeature } from '@migaia/rpc/core/features/provider'
import { createDiscoveryFeature } from '@migaia/rpc/core/features/discovery'
import { createControlFeature } from '@migaia/rpc/core/features/control'
import { createOneWayFeature } from '@migaia/rpc/core/features/one-way'
import type { IRemoteChannel, IRemoteServeEndpoint } from '@migaia/rpc/remote'
import type { IRpcStreamCapabilityPort } from '@migaia/rpc/core/stream'

/** Build a graph entirely from public factories; contract and resource ownership stay in production. */
export function streamRoots(capability?: IRpcStreamCapabilityPort) {
  /** One shared chunk owner feeds both outbound and provider paths. */
  const chunk = createCanonicalChunkFeature()
  /** The same outbound token is reused throughout this graph. */
  const outbound = createOutboundFeature(chunk)
  /** Provider registrations share outbound identity and cancellation. */
  const provider = createProviderFeature(outbound)
  /** Optional stream execution remains owned by the package implementation. */
  const stream = createStreamFeature(outbound, provider, { capability })
  return {
    'first-party-chunk': chunk,
    'first-party-outbound': outbound,
    'first-party-provider': provider,
    'first-party-stream': stream
  }
}

/** Compose the negotiated channel without recreating a codec, framer or control protocol. */
export async function endpointFor(
  channel: IRemoteChannel,
  id: string,
  providerLimits?: import('@migaia/rpc/core').IRpcProviderLimits
): Promise<IRemoteServeEndpoint> {
  /** Core stream and request paths share the same token graph. */
  const roots = streamRoots({ supports: () => channel.agreement.capabilities.includes('stream@1') })
  /** Discovery and control are public package factories using this outbound owner. */
  const discovery = createDiscoveryFeature(roots['first-party-outbound'])
  /** IPC features are supplied by the authenticated channel, never guessed locally. */
  const endpoint = await createComposedEndpoint(
    {
      id,
      scheduler: channel.scheduler,
      transport: channel.transport,
      targetIds: [channel.peerId],
      ...(providerLimits === undefined ? {} : { providerLimits }),
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        ping()
      ]
    },
    {
      ...roots,
      'first-party-discovery': discovery,
      'first-party-control': createControlFeature(roots['first-party-outbound'], discovery),
      'first-party-one-way': createOneWayFeature(roots['first-party-outbound']),
      ...Object.fromEntries(channel.features.map((feature, index) => [`channel-${index}`, feature]))
    }
  )
  return {
    endpoint: endpoint as unknown as IRpcEndpoint,
    stream: endpoint.stream,
    oneWay: endpoint
  }
}

/** Compose only request/notification owners for the bridge's published initiator profile. */
export async function bridgeEndpointFor(
  channel: IRemoteChannel,
  id: string
): Promise<IRemoteServeEndpoint> {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  const endpoint = await createComposedEndpoint(
    {
      id,
      transport: channel.transport,
      scheduler: channel.scheduler,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport })
      ]
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-one-way': createOneWayFeature(outbound),
      ...Object.fromEntries(channel.features.map((feature, index) => [`channel-${index}`, feature]))
    }
  )
  return { endpoint: endpoint as unknown as IRpcEndpoint, oneWay: endpoint }
}

import { createComposedEndpoint } from '@migaia/rpc-core/composed'
import { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'
import { createOutboundFeature } from '@migaia/rpc-core/features/outbound'
import { createOneWayFeature } from '@migaia/rpc-core/features/one-way'
import { abort } from '@migaia/rpc-core'
import { codec } from '@migaia/rpc-core'
import { framer } from '@migaia/rpc-core'
import { connect } from '@migaia/rpc-core'
import { uuid } from '@migaia/rpc-core'
import type { IRpcEndpoint, IRpcPlugin, IRpcConnectConfig } from '@migaia/rpc-core'
import type { IRemoteChannel } from '@migaia/rpc-core/remote'
import type { IOneWaySurface } from '@migaia/rpc-core/features/one-way'
import type { IRpcFeature } from '@migaia/rpc-core'

/** Unknown user middleware forces the original public pipeline without mutating a descriptor. */
export const stringFallbackMiddleware: IRpcPlugin = Object.freeze({
  name: 'i21-string-fallback',
  metadata: {
    claims: {
      routes: [],
      provides: [],
      consumes: [],
      publicKeys: [],
      exposedKeys: [],
      activator: false
    }
  },
  install: () => ({ extension: {}, ports: {} })
})

/** Fixed IDs make every business wire frame reproducible across the pre/post implementation runs. */
export async function objectFixtureEndpoint(
  channel: IRemoteChannel,
  options: Readonly<{
    fallback?: boolean
    connect?: IRpcConnectConfig
    middlewares?: readonly IRpcPlugin[]
    features?: readonly [] | readonly [IRpcFeature]
  }> = {}
): Promise<IRpcEndpoint & IOneWaySurface> {
  /** One canonical closure is shared by all explicit first-party roots. */
  const chunk = createCanonicalChunkFeature()
  /** The native outbound owner remains responsible for lifecycle, correlation and cancellation. */
  const outbound = createOutboundFeature(chunk)
  /** Each endpoint generates the same independent sequence for golden comparisons. */
  let nextId = 0
  /** Only public constructors assemble either the private default or its public fallback. */
  const endpoint = await createComposedEndpoint(
    {
      id: 'client',
      transport: channel.transport,
      scheduler: channel.scheduler,
      replay: { maxEntries: 10001 },
      wallClock: { timestamp: () => 123 },
      ...(options.features === undefined ? {} : { features: options.features }),
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport, ...options.connect }),
        uuid({ generate: () => `i21-${nextId++}` }),
        ...(options.fallback ? [stringFallbackMiddleware] : []),
        ...(options.middlewares ?? [])
      ]
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-one-way': createOneWayFeature(outbound),
      ...Object.fromEntries(channel.features.map((feature, index) => [`channel-${index}`, feature]))
    }
  )
  return endpoint as unknown as IRpcEndpoint & IOneWaySurface
}

/** Build a legal deep data graph; super-limit graphs belong to the separate rejection cases. */
export function objectDeepValue(depth: number): unknown {
  let value: unknown = null
  for (let index = 0; index < depth; index++) value = { nested: value }
  return value
}

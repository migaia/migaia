import { createComposedEndpoint, type IWebRpcEndpointModule } from '@migaia/web-rpc/core'
import { createProviderEndpoint } from '@migaia/web-rpc/provider'
import { chunk } from '@migaia/web-rpc/features/chunk'
import { discovery } from '@migaia/web-rpc/features/discovery'
import { provider } from '@migaia/web-rpc/features/provider'
import { createFullEndpoint } from '@migaia/web-rpc/full'
import { connect, createEndpoint, type IWebRpcPlugin } from '@migaia/web-rpc'
import { buildCapabilityTopology, type ITopologyNode } from '@migaia/capability/graph/topology'

type ICustomSurface = {
  custom(): string
}

/** Provides the smallest configuration accepted by packed type consumers. */
function config(id: string) {
  return { id, transport: undefined as never, middlewares: [connect()] as const }
}

async function verifyPackedContracts(): Promise<void> {
  const topologyNodes: ITopologyNode[] = [{ id: 'packed-topology', dependencies: [], ordinal: 0 }]
  void buildCapabilityTopology(
    topologyNodes,
    () => {
      throw new Error('unexpected unknown provider')
    },
    () => {
      throw new Error('unexpected cycle')
    },
    () => {
      throw new Error('unexpected invalid topology')
    }
  )

  const full = await createFullEndpoint(config('packed-full-types'))
  void full.connect
  void full.discovery
  void full.provide('echo', (context) => context.success(context.data)).connect
  void full.provide('echo', (context) => context.success(context.data)).discovery

  const root = await createEndpoint(config('packed-root-types'))
  void root.provide('echo', (context) => context.success(context.data)).connect
  void root.provide('echo', (context) => context.success(context.data)).discovery

  // @ts-expect-error removed context middleware objects are not native public plugins
  const legacyPlugin: IWebRpcPlugin = { name: 'legacy', install() {} }
  void legacyPlugin

  const providerEndpoint = await createProviderEndpoint(config('packed-provider-types'))
  // @ts-expect-error slim provider roots do not expose discovery
  void providerEndpoint.discovery
  // @ts-expect-error slim provider roots do not expose connect
  void providerEndpoint.connect

  const chunkOnly = await createComposedEndpoint(config('packed-chunk-types'), [chunk()] as const)
  // @ts-expect-error chunk roots do not expose implicit outbound methods
  void chunkOnly.send

  const custom = {} as IWebRpcEndpointModule<ICustomSurface>
  const grown = await createComposedEndpoint(config('packed-custom-types'), [custom] as const)
  void grown.custom()

  const publicTuple = await createComposedEndpoint(config('packed-public-tuple-types'), [
    provider(),
    discovery()
  ] as const)
  void publicTuple.send
  void publicTuple.connect
  void publicTuple.discovery

  const discoveryOnly = await createComposedEndpoint(config('packed-discovery-only-types'), [
    discovery()
  ] as const)
  // @ts-expect-error discovery roots do not inherit outbound methods from dependencies
  void discoveryOnly.send
}

void verifyPackedContracts

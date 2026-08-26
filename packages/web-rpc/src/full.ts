import {
  createComposedEndpoint,
  type IWebRpcComposedModuleSurface,
  type IWebRpcEndpointModule,
  type IWebRpcKernelSurface
} from './core.js'
import { provider, type IProviderSurface } from './features/provider.js'
import { discovery, type IDiscoverySurface } from './features/discovery.js'
import { control } from './features/control.js'
import { chunk } from './features/chunk.js'
import type {
  IFactoryPingCapability,
  IFactoryDiscoveryMode,
  IWebRpcEndpoint,
  IWebRpcPingEndpointSurface,
  IWebRpcFactoryConfig,
  IWebRpcPlugin
} from './typing.js'

type IFullModuleTuple = readonly [
  IWebRpcEndpointModule<IProviderSurface>,
  IWebRpcEndpointModule<IDiscoverySurface>,
  IWebRpcEndpointModule<object>,
  IWebRpcEndpointModule<object>
]

/** Full surface narrows discovery controls from the configured native plugin tuple. */
type IFullEndpointSurface<
  TTargetId extends string,
  TMode extends 'automatic' | 'manual',
  TPing extends boolean
> = Omit<
  IWebRpcKernelSurface & IWebRpcComposedModuleSurface<IFullModuleTuple>,
  'connect' | 'discovery'
> &
  Pick<IWebRpcEndpoint<TTargetId, TMode>, 'connect' | 'discovery'> &
  IWebRpcPingEndpointSurface<TPing>

/**
 * Creates the complete endpoint through one canonical kernel and attachment closure. The `ping`/
 * `pingAll` surface remains conditional on the selected `TMiddlewares` tuple, matching the legacy
 * factory's middleware-derived capability typing (`WRC-C-D31`); the runtime `ping()` gate lives in
 * `WebRpcControlAttachment` and throws `MIDDLEWARE_MISSING` when the type says the capability is
 * absent, so the type and the runtime observable contract stay in agreement.
 */
export function createFullEndpoint<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcPlugin[] = readonly IWebRpcPlugin[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares>
): Promise<
  IFullEndpointSurface<
    TTargetId,
    IFactoryDiscoveryMode<TMiddlewares>,
    IFactoryPingCapability<TMiddlewares>
  >
>
export function createFullEndpoint(
  config: IWebRpcFactoryConfig
): Promise<IWebRpcKernelSurface & IWebRpcComposedModuleSurface<IFullModuleTuple>>
export function createFullEndpoint(
  config: IWebRpcFactoryConfig
): Promise<IWebRpcKernelSurface & IWebRpcComposedModuleSurface<IFullModuleTuple>> {
  return createComposedEndpoint(config, [provider(), discovery(), control(), chunk()] as const)
}

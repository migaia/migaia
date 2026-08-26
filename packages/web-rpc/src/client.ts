import { createComposedEndpoint } from './core.js'
import { outbound } from './features/outbound.js'
import type { IWebRpcCoreConfig, IWebRpcKernelSurface } from './core.js'
import type { IOutboundSurface } from './features/outbound.js'

/** Creates client preset using the statically selected outbound feature. */
export function createClientEndpoint(
  config: IWebRpcCoreConfig
): Promise<IWebRpcKernelSurface & IOutboundSurface> {
  return createComposedEndpoint(config, [outbound()])
}

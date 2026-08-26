import { createComposedEndpoint } from './core.js'
import { provider } from './features/provider.js'
import type { IWebRpcCoreConfig, IWebRpcKernelSurface } from './core.js'
import type { IProviderSurface } from './features/provider.js'

/** Creates one provider runtime whose token includes the inseparable outbound closure. */
export function createProviderEndpoint(
  config: IWebRpcCoreConfig
): Promise<IWebRpcKernelSurface & IProviderSurface> {
  return createComposedEndpoint(config, [provider()])
}

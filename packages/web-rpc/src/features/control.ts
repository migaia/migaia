import {
  defineEndpointModule,
  EndpointModuleKey,
  withEndpointModuleOwner
} from '../internal/endpoint-modules.js'
import { WebRpcControlAttachment } from '../internal/control-attachment.js'
import type {
  IWebRpcDiscoveryResolverPort,
  IWebRpcOutboundOperationsPort,
  IWebRpcTimePort,
  IWebRpcVariationCoordinatorPort
} from '../internal/plugin-shared-keys.js'
import { WebRpcSharedKey } from '../internal/plugin-shared-keys.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcCoreConfig, IWebRpcKernelSurface } from '../core.js'
import type { IWebRpcEndpoint } from '../typing.js'
import { discovery } from './discovery.js'
import { outbound } from './outbound.js'

/** Optional control methods present when corresponding control middleware is installed. */
export type IControlSurface = IWebRpcKernelSurface &
  Partial<Pick<IWebRpcEndpoint, 'ping' | 'pingAll'>>

/** Static control feature token. */
const controlModule = defineEndpointModule<IWebRpcCoreConfig, IControlSurface>(
  EndpointModuleKey.control,
  async ({ kernel, prepared, getShared }) => {
    const outboundOperations = getShared(WebRpcSharedKey.outboundOperations) as
      | IWebRpcOutboundOperationsPort
      | undefined
    const discoveryResolver = getShared(WebRpcSharedKey.discoveryResolver) as
      | IWebRpcDiscoveryResolverPort
      | undefined
    const time = getShared(WebRpcSharedKey.time) as IWebRpcTimePort | undefined
    const variationCoordinator = getShared(WebRpcSharedKey.variationCoordinator) as
      | IWebRpcVariationCoordinatorPort
      | undefined
    if (!outboundOperations || !discoveryResolver || !time || !variationCoordinator)
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        WebRpcErrorText.endpointModuleDependencyMissing
      )
    const attachment = new WebRpcControlAttachment(
      kernel,
      Object.freeze({ outboundOperations, discoveryResolver, time, variationCoordinator }),
      prepared
    )
    return withEndpointModuleOwner(attachment.surface(), attachment)
  },
  [outbound(), discovery()],
  [],
  {
    consumes: ['variation-coordinator'],
    publicKeys: ['ping', 'pingAll'],
    sharedProvides: [WebRpcSharedKey.candidatePing],
    sharedConsumes: [
      WebRpcSharedKey.outboundOperations,
      WebRpcSharedKey.discoveryResolver,
      WebRpcSharedKey.time,
      WebRpcSharedKey.variationCoordinator
    ]
  }
)
export function control() {
  return controlModule
}

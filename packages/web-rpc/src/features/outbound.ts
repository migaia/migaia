import {
  defineEndpointModule,
  EndpointModuleKey,
  withEndpointModuleActivator,
  withEndpointModuleOwner
} from '../internal/endpoint-modules.js'
import { WebRpcOutboundAttachment } from '../internal/outbound-attachment.js'
import { registerEndpointDebugSnapshot } from '../internal/test-observer.js'
import type { IWebRpcEndpoint } from '../typing.js'
import type { IWebRpcCoreConfig, IWebRpcKernelSurface } from '../core.js'
import {
  WebRpcSharedKey,
  type IWebRpcDiscoveryResolverPort
} from '../internal/plugin-shared-keys.js'

/**
 * Static outbound feature token; outbound behavior remains owned by the canonical endpoint
 * pipeline.
 */
export type IOutboundSurface = Pick<
  IWebRpcEndpoint,
  'send' | 'sendAll' | 'dispatch' | 'dispatchAll'
>

const outboundModule = defineEndpointModule<IWebRpcCoreConfig, IOutboundSurface>(
  EndpointModuleKey.outbound,
  async ({ kernel, prepared, getShared }) => {
    const attachment = new WebRpcOutboundAttachment(
      kernel,
      prepared,
      () => getShared(WebRpcSharedKey.discoveryResolver) as IWebRpcDiscoveryResolverPort | undefined
    )
    let surface: IWebRpcKernelSurface & IOutboundSurface
    surface = {
      on: (event: string, listener: Parameters<IWebRpcEndpoint['on']>[1]) =>
        attachment.on(event, listener),
      hooks: attachment.hooks,
      dispose: () => attachment.dispose(),
      send: <T>(...args: Parameters<IWebRpcEndpoint['send']>) => attachment.send<T>(...args),
      sendAll: <T>(...args: Parameters<IWebRpcEndpoint['sendAll']>) =>
        attachment.sendAll<T>(...args),
      dispatch: (...args: Parameters<IWebRpcEndpoint['dispatch']>) => attachment.dispatch(...args),
      dispatchAll: (...args: Parameters<IWebRpcEndpoint['dispatchAll']>) =>
        attachment.dispatchAll(...args)
    }
    registerEndpointDebugSnapshot(surface, () => attachment.debugSnapshot())
    return Object.freeze(
      withEndpointModuleOwner(
        withEndpointModuleActivator(surface, () => attachment.activate()),
        attachment
      )
    )
  },
  [],
  [],
  {
    routes: ['response', 'variation'],
    provides: ['inbound-identity', 'variation-coordinator'],
    publicKeys: ['send', 'sendAll', 'dispatch', 'dispatchAll'],
    sharedProvides: [
      WebRpcSharedKey.inboundIdentity,
      WebRpcSharedKey.variationCoordinator,
      WebRpcSharedKey.outboundOperations
    ],
    activator: false
  }
)
export function outbound() {
  return outboundModule
}

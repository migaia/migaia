import {
  defineEndpointModule,
  EndpointModuleKey,
  withEndpointModuleOwner
} from '../internal/endpoint-modules.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import { WebRpcSharedKey } from '../internal/plugin-shared-keys.js'
import type {
  IWebRpcInboundIdentityPort,
  IWebRpcOutboundOperationsPort,
  IWebRpcVariationCoordinatorPort
} from '../internal/plugin-shared-keys.js'
import { WebRpcProviderAttachment } from '../internal/provider-attachment.js'
import {
  recordProviderResultDisposal,
  registerEndpointDebugSnapshot
} from '../internal/test-observer.js'
import { registerNativeProviderModule } from '../internal/provider-claim-authority.js'
import { outbound } from './outbound.js'
import type { IOutboundSurface } from './outbound.js'
import type { IWebRpcProvider } from '../typing.js'
import type { IWebRpcCoreConfig, IWebRpcEndpointModule } from '../core.js'

/** Provider preset surface includes selected outbound projection plus provider registration. */
export type IProviderSurface = IOutboundSurface & {
  dispose(): Promise<void>
  provide(method: string, provider: IWebRpcProvider): IProviderSurface
}

/** Narrow installation result; the composed root supplies the selected outbound projection. */
type IProviderInstallationSurface = {
  readonly dispose: () => Promise<void>
  readonly provide: (method: string, provider: IWebRpcProvider) => IProviderInstallationSurface
}

/** Static provider feature token; one owner installs provider and outbound security closure. */
const providerModule = defineEndpointModule<
  IWebRpcCoreConfig,
  IProviderInstallationSurface,
  IProviderSurface
>(
  EndpointModuleKey.provider,
  async ({ kernel, prepared, getShared }) => {
    const outboundOperations = getShared(WebRpcSharedKey.outboundOperations) as
      | IWebRpcOutboundOperationsPort
      | undefined
    const inboundIdentity = getShared(WebRpcSharedKey.inboundIdentity) as
      | IWebRpcInboundIdentityPort
      | undefined
    const variationCoordinator = getShared(WebRpcSharedKey.variationCoordinator) as
      | IWebRpcVariationCoordinatorPort
      | undefined
    if (!outboundOperations || !inboundIdentity || !variationCoordinator)
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        WebRpcErrorText.endpointModuleDependencyMissing
      )
    const providerAttachment = new WebRpcProviderAttachment(
      kernel,
      { outboundOperations, inboundIdentity, variationCoordinator },
      prepared
    )
    let surface: IProviderInstallationSurface
    surface = {
      dispose: async () => {
        providerAttachment.dispose()
        recordProviderResultDisposal(kernel, surface)
      },
      provide: (method: string, value: IWebRpcProvider) => {
        providerAttachment.provide(method, value)
        return surface
      }
    }
    registerEndpointDebugSnapshot(surface, () => providerAttachment.debugSnapshot())
    return Object.freeze(withEndpointModuleOwner(surface, providerAttachment))
  },
  [outbound()],
  [],
  {
    routes: ['request'],
    consumes: ['inbound-identity', 'variation-coordinator'],
    publicKeys: ['provide'],
    exposedKeys: ['provide'],
    sharedProvides: [WebRpcSharedKey.providerCancellation],
    sharedConsumes: [
      WebRpcSharedKey.outboundOperations,
      WebRpcSharedKey.inboundIdentity,
      WebRpcSharedKey.variationCoordinator
    ]
  },
  ['send', 'sendAll', 'dispatch', 'dispatchAll', 'provide']
)

registerNativeProviderModule(providerModule)

export function provider(): IWebRpcEndpointModule<IProviderInstallationSurface, IProviderSurface> {
  return providerModule
}

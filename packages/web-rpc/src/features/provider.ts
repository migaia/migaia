import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import { WebRpcSharedKey } from '../internal/plugin-shared-keys.js'
import { WebRpcProviderAttachment } from '../internal/provider-attachment.js'
import { registerEndpointDebugSnapshot } from '../internal/test-observer.js'
import type { IOutboundSurface } from './outbound.js'
import type { IWebRpcEventListener, IWebRpcProvider } from '../typing.js'
import type { IWebRpcFeature } from '../feature.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import { defineRpcFeature } from '../internal/define-rpc-feature.js'
import type {
  IOutboundCapability,
  IProviderCapability,
  IProviderInstallation
} from '../internal/feature-contract.js'

/** Provider preset surface includes selected outbound projection plus provider registration. */
export type IProviderSurface = IOutboundSurface & {
  on(event: string, listener: IWebRpcEventListener): () => void
  dispose(): Promise<void>
  provide(method: string, provider: IWebRpcProvider): IProviderSurface
}

/** Native projection owns only provider registration; composition contributes outbound separately. */
export type IProviderRegistrationSurface = Readonly<{
  readonly provide: (method: string, provider: IWebRpcProvider) => IProviderRegistrationSurface
  readonly on: (event: string, listener: IWebRpcEventListener) => () => void
}>

/** Native provider Feature retains the request security closure under the construction scope. */
export const createProviderFeature = (
  outboundCapability: IWebRpcFeature<IOutboundCapability>
): IWebRpcFeature<
  IProviderCapability,
  { readonly outbound: IWebRpcFeature<IOutboundCapability> },
  IEndpointCapabilitiesFeatureExpose
> =>
  defineRpcFeature<
    IProviderCapability,
    { readonly outbound: IWebRpcFeature<IOutboundCapability> },
    IEndpointCapabilitiesFeatureExpose
  >(
    {
      publicKeys: ['provide'],
      claims: {
        routes: ['request'],
        provides: [],
        consumes: ['inbound-identity', 'variation-coordinator'],
        publicKeys: ['provide'],
        exposedKeys: ['provide'],
        activator: false
      }
    },
    (core, dependencies) => {
      let attachment: WebRpcProviderAttachment | undefined
      let installation: IProviderInstallation | undefined
      const prepare = (
        scope: import('../typing.js').IWebRpcPluginInstallScope
      ): IProviderInstallation => {
        if (installation) return installation
        const outbound = dependencies.outbound.prepare(scope)
        attachment = new WebRpcProviderAttachment(
          core.featureExpose.getKernel(),
          {
            outboundOperations: outbound.outboundOperations,
            inboundIdentity: outbound.inboundIdentity,
            variationCoordinator: outbound.variationCoordinator
          },
          core.featureExpose.getPrepared()
        )
        scope.own(attachment, () => attachment!.dispose())
        const provider = attachment
        const publicSurface: IProviderRegistrationSurface & {
          readonly on: (event: string, listener: IWebRpcEventListener) => () => void
        } = Object.freeze({
          provide: (method: string, value: IWebRpcProvider) => {
            provider.provide(method, value)
            return publicSurface
          },
          on: (event: string, listener: IWebRpcEventListener) => provider.on(event, listener)
        })
        registerEndpointDebugSnapshot(publicSurface, () => attachment!.debugSnapshot())
        const preparedInstallation: IProviderInstallation = Object.freeze({ public: publicSurface })
        installation = preparedInstallation
        return preparedInstallation
      }
      const shared = (): Readonly<Record<PropertyKey, unknown>> => {
        if (!attachment)
          throw new WebRpcError(
            WebRpcErrorCode.invalidConfig,
            WebRpcErrorText.endpointModuleDependencyMissing
          )
        return Object.freeze({
          [WebRpcSharedKey.providerCancellation]: Object.freeze({
            abort: (id: string) => attachment!.abort(id)
          })
        })
      }
      return Object.freeze({ prepare, shared })
    },
    { outbound: outboundCapability }
  )

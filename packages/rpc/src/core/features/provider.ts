import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'
import { RpcProviderAttachment } from '../internal/provider-attachment.js'
import { registerEndpointDebugSnapshot } from '../internal/test-observer.js'
import type { IOutboundSurface } from './outbound.js'
import type { IRpcEventListener, IRpcProvider } from '../typing.js'
import type { IRpcFeature } from '../feature.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import { defineRpcFeature } from '../internal/define-rpc-feature.js'
import type {
  IOutboundCapability,
  IProviderCapability,
  IProviderInstallation
} from '../internal/feature-contract.js'

/** Provider preset surface includes selected outbound projection plus provider registration. */
export type IProviderSurface = IOutboundSurface & {
  on(event: string, listener: IRpcEventListener): () => void
  dispose(): Promise<void>
  provide(method: string, provider: IRpcProvider): IProviderSurface
}

/** Native projection owns only provider registration; composition contributes outbound separately. */
export type IProviderRegistrationSurface = Readonly<{
  readonly provide: (method: string, provider: IRpcProvider) => IProviderRegistrationSurface
  readonly on: (event: string, listener: IRpcEventListener) => () => void
}>

/** Native provider Feature retains the request security closure under the construction scope. */
export const createProviderFeature = (
  outboundCapability: IRpcFeature<IOutboundCapability>
): IRpcFeature<
  IProviderCapability,
  { readonly outbound: IRpcFeature<IOutboundCapability> },
  IEndpointCapabilitiesFeatureExpose
> =>
  defineRpcFeature<
    IProviderCapability,
    { readonly outbound: IRpcFeature<IOutboundCapability> },
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
      let attachment: RpcProviderAttachment | undefined
      let installation: IProviderInstallation | undefined
      const prepare = (
        scope: import('../typing.js').IRpcPluginInstallScope
      ): IProviderInstallation => {
        if (installation) return installation
        const outbound = dependencies.outbound.prepare(scope)
        attachment = new RpcProviderAttachment(
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
          readonly on: (event: string, listener: IRpcEventListener) => () => void
        } = Object.freeze({
          provide: (method: string, value: IRpcProvider) => {
            provider.provide(method, value)
            return publicSurface
          },
          on: (event: string, listener: IRpcEventListener) => provider.on(event, listener)
        })
        registerEndpointDebugSnapshot(publicSurface, () => attachment!.debugSnapshot())
        const preparedInstallation: IProviderInstallation = Object.freeze({
          public: publicSurface,
          registerStream: (method, handler) => provider.provideStream(method, handler)
        })
        installation = preparedInstallation
        return preparedInstallation
      }
      const ports = (): Readonly<Record<PropertyKey, unknown>> => {
        if (!attachment)
          throw new RpcError(
            RpcCoreErrorCode.invalidConfig,
            RpcCoreErrorText.endpointModuleDependencyMissing
          )
        return Object.freeze({
          [RpcPortName.providerCancellation]: Object.freeze({
            abort: (id: string) => attachment!.abort(id)
          })
        })
      }
      return Object.freeze({ prepare, ports })
    },
    { outbound: outboundCapability }
  )

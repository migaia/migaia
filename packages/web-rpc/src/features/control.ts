import { WebRpcControlAttachment } from '../internal/control-attachment.js'
import type { IWebRpcCandidatePingPort } from '../internal/plugin-shared-keys.js'
import { WebRpcPortName } from '../internal/plugin-shared-keys.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcEndpoint } from '../typing.js'
import type { IWebRpcFeature } from '../feature.js'
import type {
  IControlCapability,
  IControlInstallation,
  IDiscoveryCapability,
  IOutboundCapability
} from '../internal/feature-contract.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import { defineRpcFeature } from '../internal/define-rpc-feature.js'
import { WebRpcControlRole, WebRpcControlRoleSchema } from '../internal/plugin-contract.js'

/** Optional control methods present when corresponding control middleware is installed. */
export type IControlSurface = Partial<Pick<IWebRpcEndpoint, 'ping' | 'pingAll'>>

/** Native control capability prepared after outbound and discovery have established their ports. */
export const createControlFeature = (
  outboundCapability: IWebRpcFeature<IOutboundCapability>,
  discoveryCapability: IWebRpcFeature<IDiscoveryCapability>
): IWebRpcFeature<
  IControlCapability,
  {
    readonly outbound: IWebRpcFeature<IOutboundCapability>
    readonly discovery: IWebRpcFeature<IDiscoveryCapability>
  },
  IEndpointCapabilitiesFeatureExpose
> =>
  defineRpcFeature<
    IControlCapability,
    {
      readonly outbound: IWebRpcFeature<IOutboundCapability>
      readonly discovery: IWebRpcFeature<IDiscoveryCapability>
    },
    IEndpointCapabilitiesFeatureExpose
  >(
    {
      publicKeys: ['ping', 'pingAll'],
      claims: {
        routes: [],
        provides: [],
        consumes: ['variation-coordinator'],
        publicKeys: ['ping', 'pingAll'],
        exposedKeys: [],
        activator: false
      },
      sharedConsumes: WebRpcControlRoleSchema[WebRpcControlRole.control].sharedConsumes
    },
    (core, dependencies) => {
      let installation: IControlInstallation | undefined
      let candidatePing: IWebRpcCandidatePingPort | undefined
      const prepare = (
        scope: import('../typing.js').IWebRpcPluginInstallScope
      ): IControlInstallation => {
        if (installation) return installation
        const outbound = dependencies.outbound.prepare(scope)
        const discovery = dependencies.discovery.prepare(scope)
        const attachment = new WebRpcControlAttachment(
          core.featureExpose.getKernel(),
          Object.freeze({
            outboundOperations: outbound.outboundOperations,
            discoveryResolver: discovery.resolver,
            time: core.featureExpose.getTime(),
            variationCoordinator: outbound.variationCoordinator
          }),
          core.featureExpose.getPrepared()
        )
        scope.own(attachment, () => attachment.dispose())
        const surface = attachment.surface()
        candidatePing = Object.freeze({
          ping: (candidate, options) =>
            surface.ping(candidate.targetId, candidate.receiverId, options)
        })
        const preparedInstallation: IControlInstallation = Object.freeze({ public: surface })
        installation = preparedInstallation
        return preparedInstallation
      }
      const ports = (): Readonly<Record<PropertyKey, unknown>> => {
        if (!candidatePing)
          throw new WebRpcError(
            WebRpcErrorCode.invalidConfig,
            WebRpcErrorText.endpointModuleDependencyMissing
          )
        return Object.freeze({ [WebRpcPortName.candidatePing]: candidatePing })
      }
      return Object.freeze({ prepare, ports })
    },
    { outbound: outboundCapability, discovery: discoveryCapability }
  )

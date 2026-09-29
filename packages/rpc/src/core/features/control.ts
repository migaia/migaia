import { RpcControlAttachment } from '../internal/control-attachment.js'
import type { IRpcCandidatePingPort } from '../internal/plugin-shared-keys.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcEndpoint } from '../typing.js'
import type { IRpcFeature } from '../feature.js'
import type {
  IControlCapability,
  IControlInstallation,
  IDiscoveryCapability,
  IOutboundCapability
} from '../internal/feature-contract.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import { defineRpcFeature } from '../internal/define-rpc-feature.js'
import { RpcControlRole, RpcControlRoleSchema } from '../internal/plugin-contract.js'

/** Optional control methods present when corresponding control middleware is installed. */
export type IControlSurface = Partial<Pick<IRpcEndpoint, 'ping' | 'pingAll' | 'announceClose'>>

/** Native control capability prepared after outbound and discovery have established their ports. */
export const createControlFeature = (
  outboundCapability: IRpcFeature<IOutboundCapability>,
  discoveryCapability: IRpcFeature<IDiscoveryCapability>
): IRpcFeature<
  IControlCapability,
  {
    readonly outbound: IRpcFeature<IOutboundCapability>
    readonly discovery: IRpcFeature<IDiscoveryCapability>
  },
  IEndpointCapabilitiesFeatureExpose
> =>
  defineRpcFeature<
    IControlCapability,
    {
      readonly outbound: IRpcFeature<IOutboundCapability>
      readonly discovery: IRpcFeature<IDiscoveryCapability>
    },
    IEndpointCapabilitiesFeatureExpose
  >(
    {
      publicKeys: ['ping', 'pingAll', 'announceClose'],
      claims: {
        routes: [],
        provides: [],
        consumes: ['variation-coordinator'],
        publicKeys: ['ping', 'pingAll', 'announceClose'],
        exposedKeys: [],
        activator: false
      },
      sharedConsumes: RpcControlRoleSchema[RpcControlRole.control].sharedConsumes
    },
    (core, dependencies) => {
      let installation: IControlInstallation | undefined
      let candidatePing: IRpcCandidatePingPort | undefined
      const prepare = (
        scope: import('../typing.js').IRpcPluginInstallScope
      ): IControlInstallation => {
        if (installation) return installation
        const outbound = dependencies.outbound.prepare(scope)
        const discovery = dependencies.discovery.prepare(scope)
        const attachment = new RpcControlAttachment(
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
          throw new RpcError(
            RpcCoreErrorCode.invalidConfig,
            RpcCoreErrorText.endpointModuleDependencyMissing
          )
        return Object.freeze({ [RpcPortName.candidatePing]: candidatePing })
      }
      return Object.freeze({ prepare, ports })
    },
    { outbound: outboundCapability, discovery: discoveryCapability }
  )

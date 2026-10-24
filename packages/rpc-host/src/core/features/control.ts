import type { IFeatureCore } from '@migaia/plugin-host'
import { createRpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcControlAttachment } from '../internal/control-attachment.js'
import type { IRpcCandidatePingPort } from '../internal/plugin-shared-keys.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'

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

/** Own one native control Feature's preparation and port publication. */
class ControlFeatureInstallation {
  /** This exact native Feature core lends canonical endpoint capabilities during preparation. */
  #core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>
  /** Dependency outputs are the original native registration outputs, never copied assemblies. */
  #dependencies: {
    readonly outbound: IOutboundCapability
    readonly discovery: IDiscoveryCapability
  }
  /** The first prepared installation is returned by identity on every later call. */
  #installation: IControlInstallation | undefined
  /** The original candidate ping port is published only after native control preparation. */
  #candidatePing: IRpcCandidatePingPort | undefined
  /** The frozen capability keeps the original own methods and detached-call behavior. */
  readonly value: IControlCapability
  /** Capture the receiving native registration before any attachment resources are acquired. */
  constructor(
    core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>,
    dependencies: {
      readonly outbound: IOutboundCapability
      readonly discovery: IDiscoveryCapability
    }
  ) {
    this.#core = core
    this.#dependencies = dependencies
    this.value = Object.freeze({ prepare: this.#prepare, ports: this.#ports })
  }
  /** Prepare the original canonical attachment once under the actual native installation scope. */
  #prepare = (scope: import('../typing.js').IRpcPluginInstallScope): IControlInstallation => {
    if (this.#installation) return this.#installation
    /** Prepare the canonical outbound dependency before publishing any dependent surface. */
    const outbound = this.#dependencies.outbound.prepare(scope)
    /** Prepare the canonical discovery dependency in the same installation scope. */
    const discovery = this.#dependencies.discovery.prepare(scope)
    /** The selected control attachment owns its route and native lifecycle resources. */
    const attachment = new RpcControlAttachment(
      this.#core.featureExpose.getKernel(),
      Object.freeze({
        outboundOperations: outbound.outboundOperations,
        discoveryResolver: discovery.resolver,
        time: this.#core.featureExpose.getTime(),
        variationCoordinator: outbound.variationCoordinator
      }),
      this.#core.featureExpose.getPrepared()
    )
    scope.own(attachment, () => attachment.dispose())
    const surface = attachment.surface()
    this.#candidatePing = Object.freeze({
      ping: (candidate, options) => surface.ping(candidate.targetId, candidate.receiverId, options)
    })
    const preparedInstallation: IControlInstallation = Object.freeze({ public: surface })
    this.#installation = preparedInstallation
    return preparedInstallation
  }
  /** Publish only ports whose original native preparation has completed. */
  #ports = (): Readonly<Record<PropertyKey, unknown>> => {
    if (!this.#candidatePing)
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.endpointModuleDependencyMissing
      )
    return Object.freeze({ [RpcPortName.candidatePing]: this.#candidatePing })
  }
}

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
    (core, dependencies) => new ControlFeatureInstallation(core, dependencies).value,
    { outbound: outboundCapability, discovery: discoveryCapability }
  )

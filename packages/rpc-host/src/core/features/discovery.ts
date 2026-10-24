import type { IFeatureCore } from '@migaia/plugin-host'
import { createRpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcDiscoveryAttachment } from '../internal/discovery-attachment.js'

import { RpcCoreErrorText } from '../error-text.js'
import {
  registerCanonicalReceiver,
  RpcPortName,
  type IRpcDiscoveryResolverPort
} from '../internal/plugin-shared-keys.js'
import type { IRpcEndpoint } from '../typing.js'
import type { IRpcFeature } from '../feature.js'
import type {
  IDiscoveryCapability,
  IDiscoveryInstallation,
  IOutboundCapability
} from '../internal/feature-contract.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import { defineRpcFeature } from '../internal/define-rpc-feature.js'
import {
  readDiscoveryCleanupFaults,
  readSelectedFramerChunks,
  registerEndpointDebugSnapshot,
  type IRpcEndpointDebugSnapshot
} from '../internal/test-observer.js'

/** Public discovery controls contributed by the selected discovery token. */
export type IDiscoverySurface = Pick<IRpcEndpoint, 'connect' | 'discovery'>

/** Own one native discovery Feature's preparation and port publication. */
class DiscoveryFeatureInstallation {
  /** This exact native Feature core lends canonical endpoint capabilities during preparation. */
  #core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>
  /** Dependency outputs are the original native registration outputs, never copied assemblies. */
  #dependencies: { readonly outbound: IOutboundCapability }
  /** The first prepared installation is returned by identity on every later call. */
  #installation: IDiscoverySurface | undefined
  /** All public and port projections share the same prepared native installation. */
  #preparedInstallation: IDiscoveryInstallation | undefined
  /** The canonical attachment alone owns this installation's runtime resources. */
  #attachment: RpcDiscoveryAttachment | undefined
  /** Discovery connects the original receiver resolver without a second directory. */
  #resolver: IRpcDiscoveryResolverPort | undefined
  /** The frozen capability keeps the original own methods and detached-call behavior. */
  readonly value: IDiscoveryCapability
  /** Capture the receiving native registration before any attachment resources are acquired. */
  constructor(
    core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>,
    dependencies: { readonly outbound: IOutboundCapability }
  ) {
    this.#core = core
    this.#dependencies = dependencies
    this.value = Object.freeze({ prepare: this.#prepare, ports: this.#ports })
  }
  /** Prepare the original canonical attachment once under the actual native installation scope. */
  #prepare = (scope: import('../typing.js').IRpcPluginInstallScope): IDiscoveryInstallation => {
    if (this.#preparedInstallation) return this.#preparedInstallation
    /** Prepare the canonical outbound dependency before publishing any dependent surface. */
    const outbound = this.#dependencies.outbound.prepare(scope)
    /** Read the original endpoint preparation before constructing this attachment. */
    const prepared = this.#core.featureExpose.getPrepared()
    /** Use the existing kernel as the sole resource and lifecycle owner. */
    const kernel = this.#core.featureExpose.getKernel()
    this.#attachment = new RpcDiscoveryAttachment(kernel, prepared, {
      inboundIdentity: outbound.inboundIdentity,
      outboundOperations: outbound.outboundOperations,
      time: this.#core.featureExpose.getTime(),
      candidatePing: (candidate, options) => {
        /** Reuse the selected outbound ping port rather than creating another discovery path. */
        const candidatePing = this.#core.featureExpose.getCandidatePing()
        if (!candidatePing)
          throw createRpcError(
            RpcCoreErrorCode.middlewareMissing,
            RpcCoreErrorText.endpointModuleDependencyMissing
          )
        return candidatePing.ping(candidate, options)
      }
    })
    /** Freeze the original capability projection while retaining its attachment owner. */
    const surface = Object.freeze({
      dispose: () => this.#attachment!.dispose(readDiscoveryCleanupFaults(surface)),
      connect: this.#attachment.controls,
      discovery: this.#attachment.controls
    })
    scope.own(surface, () => surface.dispose())
    this.#resolver = Object.freeze({
      resolve: (id: string, receiverId?: string) =>
        this.#attachment!.resolveReceiver(id, receiverId)
    })
    registerCanonicalReceiver(this.#resolver, (id, receiverId) =>
      this.#attachment!.selectReceiver(id, receiverId)
    )
    this.#dependencies.outbound.connectResolver(this.#resolver)
    this.#installation = surface
    const publicSurface = Object.freeze({
      connect: surface.connect,
      discovery: surface.discovery
    })
    registerEndpointDebugSnapshot(
      publicSurface,
      () =>
        ({
          phase: kernel.state === 'disposed' ? 'disposed' : 'active',
          pending: 0,
          pingPending: 0,
          activeControllers: 0,
          chunks: readSelectedFramerChunks(prepared.options.components!),
          providers: 0,
          events: 0,
          hooks: 0,
          resources: kernel.resources.size,
          owners: kernel.ownerKeys,
          discovery: this.#attachment!.debugSnapshot()
        }) satisfies IRpcEndpointDebugSnapshot
    )
    this.#preparedInstallation = Object.freeze({
      public: publicSurface,
      resolver: this.#resolver,
      cleanupTarget: surface
    })
    return this.#preparedInstallation
  }
  /** Publish only ports whose original native preparation has completed. */
  #ports = (): Readonly<Record<PropertyKey, unknown>> => {
    if (!this.#installation)
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.endpointModuleDependencyMissing
      )
    return Object.freeze({
      [RpcPortName.discoveryResolver]: this.#resolver!
    })
  }
}

/** Native discovery factory; creation is deferred to the capability Plugin installation scope. */
export const createDiscoveryFeature = (
  outboundCapability: IRpcFeature<IOutboundCapability>
): IRpcFeature<
  IDiscoveryCapability,
  { readonly outbound: IRpcFeature<IOutboundCapability> },
  IEndpointCapabilitiesFeatureExpose
> =>
  defineRpcFeature<
    IDiscoveryCapability,
    { readonly outbound: IRpcFeature<IOutboundCapability> },
    IEndpointCapabilitiesFeatureExpose
  >(
    {
      publicKeys: ['connect', 'discovery'],
      claims: {
        routes: ['discovery'],
        provides: ['discovery-resolver'],
        consumes: ['inbound-identity'],
        publicKeys: ['connect', 'discovery'],
        exposedKeys: [],
        activator: false
      }
    },
    (core, dependencies) => new DiscoveryFeatureInstallation(core, dependencies).value,
    { outbound: outboundCapability }
  )

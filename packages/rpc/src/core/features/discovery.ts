import { RpcDiscoveryAttachment } from '../internal/discovery-attachment.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'
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

/** Native discovery factory; creation is deferred to the capability Plugin installation scope. */
export const createDiscoveryFeature = (
  outboundCapability: IRpcFeature<IOutboundCapability>
): IRpcFeature<
  IDiscoveryCapability,
  { readonly outbound: IRpcFeature<IOutboundCapability> },
  IEndpointCapabilitiesFeatureExpose
> =>
  (() => {
    const feature = defineRpcFeature<
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
      (core, dependencies) => {
        let installation: IDiscoverySurface | undefined
        let preparedInstallation: IDiscoveryInstallation | undefined
        let attachment: RpcDiscoveryAttachment | undefined
        const prepare = (
          scope: import('../typing.js').IRpcPluginInstallScope
        ): IDiscoveryInstallation => {
          if (preparedInstallation) return preparedInstallation
          const outbound = dependencies.outbound.prepare(scope)
          const prepared = core.featureExpose.getPrepared()
          const kernel = core.featureExpose.getKernel()
          attachment = new RpcDiscoveryAttachment(kernel, prepared, {
            inboundIdentity: outbound.inboundIdentity,
            outboundOperations: outbound.outboundOperations,
            time: core.featureExpose.getTime(),
            candidatePing: (candidate, options) => {
              const candidatePing = core.featureExpose.getCandidatePing()
              if (!candidatePing)
                throw new RpcError(
                  RpcCoreErrorCode.middlewareMissing,
                  RpcCoreErrorText.endpointModuleDependencyMissing
                )
              return candidatePing.ping(candidate, options)
            }
          })
          const surface = Object.freeze({
            dispose: () => attachment!.dispose(readDiscoveryCleanupFaults(surface)),
            connect: attachment.controls,
            discovery: attachment.controls
          })
          scope.own(surface, () => surface.dispose())
          dependencies.outbound.connectResolver({
            resolve: (id: string, receiverId?: string) =>
              attachment!.resolveReceiver(id, receiverId)
          })
          installation = surface
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
                discovery: attachment!.debugSnapshot()
              }) satisfies IRpcEndpointDebugSnapshot
          )
          preparedInstallation = Object.freeze({
            public: publicSurface,
            resolver: Object.freeze({
              resolve: (id: string, receiverId?: string) =>
                attachment!.resolveReceiver(id, receiverId)
            }),
            cleanupTarget: surface
          })
          return preparedInstallation
        }
        const ports = (): Readonly<Record<PropertyKey, unknown>> => {
          if (!installation)
            throw new RpcError(
              RpcCoreErrorCode.invalidConfig,
              RpcCoreErrorText.endpointModuleDependencyMissing
            )
          return Object.freeze({
            [RpcPortName.discoveryResolver]: Object.freeze({
              resolve: (id: string, receiverId?: string) =>
                attachment!.resolveReceiver(id, receiverId)
            })
          })
        }
        return Object.freeze({ prepare, ports })
      },
      { outbound: outboundCapability }
    )
    return feature
  })()

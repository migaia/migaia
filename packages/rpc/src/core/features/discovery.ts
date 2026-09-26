import { WebRpcDiscoveryAttachment } from '../internal/discovery-attachment.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import { WebRpcPortName } from '../internal/plugin-shared-keys.js'
import type { IWebRpcEndpoint } from '../typing.js'
import type { IWebRpcFeature } from '../feature.js'
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
  type IWebRpcEndpointDebugSnapshot
} from '../internal/test-observer.js'

/** Public discovery controls contributed by the selected discovery token. */
export type IDiscoverySurface = Pick<IWebRpcEndpoint, 'connect' | 'discovery'>

/** Native discovery factory; creation is deferred to the capability Plugin installation scope. */
export const createDiscoveryFeature = (
  outboundCapability: IWebRpcFeature<IOutboundCapability>
): IWebRpcFeature<
  IDiscoveryCapability,
  { readonly outbound: IWebRpcFeature<IOutboundCapability> },
  IEndpointCapabilitiesFeatureExpose
> =>
  (() => {
    const feature = defineRpcFeature<
      IDiscoveryCapability,
      { readonly outbound: IWebRpcFeature<IOutboundCapability> },
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
        let attachment: WebRpcDiscoveryAttachment | undefined
        const prepare = (
          scope: import('../typing.js').IWebRpcPluginInstallScope
        ): IDiscoveryInstallation => {
          if (preparedInstallation) return preparedInstallation
          const outbound = dependencies.outbound.prepare(scope)
          const prepared = core.featureExpose.getPrepared()
          const kernel = core.featureExpose.getKernel()
          attachment = new WebRpcDiscoveryAttachment(kernel, prepared, {
            inboundIdentity: outbound.inboundIdentity,
            outboundOperations: outbound.outboundOperations,
            time: core.featureExpose.getTime(),
            candidatePing: (candidate, options) => {
              const candidatePing = core.featureExpose.getCandidatePing()
              if (!candidatePing)
                throw new WebRpcError(
                  WebRpcErrorCode.middlewareMissing,
                  WebRpcErrorText.endpointModuleDependencyMissing
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
            resolve: (id: string) => attachment!.resolveReceiver(id)
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
              }) satisfies IWebRpcEndpointDebugSnapshot
          )
          preparedInstallation = Object.freeze({
            public: publicSurface,
            resolver: Object.freeze({ resolve: (id: string) => attachment!.resolveReceiver(id) }),
            cleanupTarget: surface
          })
          return preparedInstallation
        }
        const ports = (): Readonly<Record<PropertyKey, unknown>> => {
          if (!installation)
            throw new WebRpcError(
              WebRpcErrorCode.invalidConfig,
              WebRpcErrorText.endpointModuleDependencyMissing
            )
          return Object.freeze({
            [WebRpcPortName.discoveryResolver]: Object.freeze({
              resolve: (id: string) => attachment!.resolveReceiver(id)
            })
          })
        }
        return Object.freeze({ prepare, ports })
      },
      { outbound: outboundCapability }
    )
    return feature
  })()

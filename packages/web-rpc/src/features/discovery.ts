import {
  defineEndpointModule,
  EndpointModuleKey,
  withEndpointModuleOwner
} from '../internal/endpoint-modules.js'
import { WebRpcDiscoveryAttachment } from '../internal/discovery-attachment.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import {
  WebRpcSharedKey,
  type IWebRpcCandidatePingPort,
  type IWebRpcInboundIdentityPort,
  type IWebRpcOutboundOperationsPort,
  type IWebRpcTimePort
} from '../internal/plugin-shared-keys.js'
import type { IWebRpcCoreConfig } from '../core.js'
import type { IWebRpcEndpoint } from '../typing.js'
import { outbound } from './outbound.js'
import {
  readDiscoveryCleanupFaults,
  readSelectedFramerChunks,
  registerEndpointDebugSnapshot,
  type IWebRpcEndpointDebugSnapshot
} from '../internal/test-observer.js'

/** Public discovery controls contributed by the selected discovery token. */
export type IDiscoverySurface = Pick<IWebRpcEndpoint, 'connect' | 'discovery'>

/** Installed discovery owner surface retained privately until the composed root is projected. */
type IDiscoveryInstallationSurface = IDiscoverySurface & { readonly dispose: () => void }

/** Static discovery feature token. */
const discoveryModule = defineEndpointModule<
  IWebRpcCoreConfig,
  IDiscoveryInstallationSurface,
  IDiscoverySurface
>(
  EndpointModuleKey.discovery,
  async ({ kernel, prepared, getShared }) => {
    const inboundIdentity = getShared(WebRpcSharedKey.inboundIdentity) as
      | IWebRpcInboundIdentityPort
      | undefined
    const outboundOperations = getShared(WebRpcSharedKey.outboundOperations) as
      | IWebRpcOutboundOperationsPort
      | undefined
    const time = getShared(WebRpcSharedKey.time) as IWebRpcTimePort | undefined
    if (!inboundIdentity || !outboundOperations || !time)
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        WebRpcErrorText.endpointModuleDependencyMissing
      )
    const attachment = new WebRpcDiscoveryAttachment(kernel, prepared, {
      inboundIdentity,
      outboundOperations,
      time,
      candidatePing: (candidate, options) => {
        const candidatePing = getShared(WebRpcSharedKey.candidatePing) as
          | IWebRpcCandidatePingPort
          | undefined
        if (!candidatePing)
          throw new WebRpcError(
            WebRpcErrorCode.middlewareMissing,
            WebRpcErrorText.endpointModuleDependencyMissing
          )
        return candidatePing.ping(candidate, options)
      }
    })
    const surface = {
      dispose: () => attachment.dispose(readDiscoveryCleanupFaults(surface)),
      connect: attachment.controls,
      discovery: attachment.controls
    }
    registerEndpointDebugSnapshot(
      surface,
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
          discovery: attachment.debugSnapshot()
        }) satisfies IWebRpcEndpointDebugSnapshot
    )
    return Object.freeze(withEndpointModuleOwner(surface, attachment))
  },
  [outbound()],
  [],
  {
    routes: ['discovery'],
    consumes: ['inbound-identity'],
    publicKeys: ['connect', 'discovery'],
    sharedProvides: [WebRpcSharedKey.discoveryResolver],
    sharedConsumes: [
      WebRpcSharedKey.inboundIdentity,
      WebRpcSharedKey.outboundOperations,
      WebRpcSharedKey.time
    ],
    sharedOptionalConsumes: [WebRpcSharedKey.candidatePing]
  }
)
export function discovery() {
  return discoveryModule
}
